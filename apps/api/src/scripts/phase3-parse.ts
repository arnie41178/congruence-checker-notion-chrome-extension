/**
 * Phase 3 — Parse Audit Results
 *
 * Reads all RXXX-audit.md files from a Phase 2 output folder and produces
 * a valid AnalysisResult JSON compatible with the extension's Review Pane
 * (ResultsPanel → ScorecardPanel + SuggestionCard + DiffHunkView).
 *
 * Usage:
 *   cd apps/api && pnpm phase3:parse
 *   cd apps/api && pnpm phase3:parse --req-version v002   # pin version
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import type {
  Issue,
  IssueImpact,
  ReadinessBadge,
  DiffHunk,
  Scorecard,
  CategoryScore,
  AnalysisResult,
} from "@alucify/shared-types";

const DEV_DIR = join(process.cwd(), ".dev");

const REQ_VERSION = (() => {
  const idx = process.argv.indexOf("--req-version");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ── Version detection ─────────────────────────────────────────────────────────

async function detectLatestP2Version(): Promise<string> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^p2-v\d+$/.test(e))
    .map((e) => e.replace("p2-", ""))
    .sort();
  if (versions.length === 0) {
    console.error("[Phase 3] ERROR: No p2-vNNN folders found in .dev/. Run Phase 2 first.");
    process.exit(1);
  }
  return versions[versions.length - 1];
}

// ── Audit markdown parser ─────────────────────────────────────────────────────

type AuditStatus = "congruent" | "needs-clarification" | "conflicting";

interface ParsedAudit {
  id: string;
  title: string;
  status: AuditStatus;
  evidence: string;
  gap: string;
  suggestion: string;
  diffs: DiffHunk[];
}

function parseAuditFile(content: string): ParsedAudit | null {
  // Header: ### Requirement R001: Title
  const headerMatch = content.match(/^###\s+Requirement\s+(R\d+):\s+(.+)$/m);
  if (!headerMatch) return null;
  const id = headerMatch[1];
  const title = headerMatch[2].trim();

  // Status
  const statusMatch = content.match(/\*\*Status\*\*:\s*([\w-]+)/);
  const status = (statusMatch?.[1] ?? "implemented") as AuditStatus;

  // Evidence (multi-line, up to next ** field)
  const evidenceMatch = content.match(/\*\*Evidence\*\*:\s*([\s\S]+?)(?=\n\*\*|\n---|\n$)/);
  const evidence = evidenceMatch?.[1]?.trim() ?? "";

  // Gap (multi-line, up to next ** field)
  const gapMatch = content.match(/\*\*Gap\*\*:\s*([\s\S]+?)(?=\n\*\*|\n---|\n$)/);
  const gap = gapMatch?.[1]?.trim() ?? "";

  // Suggestion (multi-line, up to next ** field or end)
  const suggestionMatch = content.match(/\*\*Suggestion\*\*:\s*([\s\S]+?)(?=\n\*\*Diff\*\*|\n---|\n$)/);
  const suggestion = suggestionMatch?.[1]?.trim() ?? "";

  // Diffs: extract all >>> ... <<< blocks
  const diffs: DiffHunk[] = [];
  const diffBlockRegex = />>>\s*(.+?)\n([\s\S]+?)<<</g;
  let diffMatch: RegExpExecArray | null;
  while ((diffMatch = diffBlockRegex.exec(content)) !== null) {
    const sectionTitle = diffMatch[1].trim();
    const body = diffMatch[2];

    // Extract "- " lines (before) and "+ " lines (after)
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    for (const line of body.split("\n")) {
      if (line.startsWith("- ")) beforeLines.push(line.slice(2));
      else if (line.startsWith("+ ")) afterLines.push(line.slice(2));
    }

    const beforeText = beforeLines
      .join("\n")
      .trim()
      .replace(/^\[none\]$/, ""); // [none] = pure addition → empty string

    const afterText = afterLines.join("\n").trim();

    if (afterText) {
      diffs.push({ sectionTitle, before: beforeText, after: afterText });
    }
  }

  return { id, title, status, evidence, gap, suggestion, diffs };
}

// ── Issue builder ─────────────────────────────────────────────────────────────

const STATUS_IMPACT: Record<Exclude<AuditStatus, "congruent">, IssueImpact> = {
  conflicting:         "critical",
  "needs-clarification": "high",
};

function buildIssue(audit: ParsedAudit): Issue {
  const impact = STATUS_IMPACT[audit.status as Exclude<AuditStatus, "congruent">];
  return {
    id: audit.id,
    summary: audit.title,
    description: audit.gap || "See evidence for details.",
    impact,
    recommendation: audit.suggestion || "Clarify this requirement in the PRD.",
    evidence: audit.evidence || undefined,
    suggestion: audit.suggestion || undefined,
    diffs: audit.diffs.length > 0 ? audit.diffs : undefined,
    accepted: true,
  };
}

// ── Scorecard builder ─────────────────────────────────────────────────────────

const DIMENSION_PATTERNS: Record<keyof Scorecard["categories"], RegExp> = {
  terminology: /\bterminology\b/i,
  conflicts:   /\bconflict\b/i,
  duplication: /\bduplication\b|\bduplicate\b/i,
  missing:     /\bmissing\b/i,
};

function buildScorecard(audits: ParsedAudit[], total: number): Scorecard {
  const categories = {} as Scorecard["categories"];

  for (const [dim, pattern] of Object.entries(DIMENSION_PATTERNS) as [keyof Scorecard["categories"], RegExp][]) {
    const affected = audits.filter(
      (a) => a.status !== "congruent" && pattern.test(a.gap)
    );

    // Score: 10 when none affected, scales down proportionally
    const score = total === 0
      ? 10
      : Math.round((10 * (1 - affected.length / total)) * 10) / 10;

    // Summary: sentences from Gap lines that match this dimension
    const summaryParts: string[] = [];
    for (const a of affected) {
      const lines = a.gap.split("\n").filter((l) => pattern.test(l));
      summaryParts.push(...lines.map((l) => l.replace(/^[-\d.*\s]+/, "").trim()));
    }
    const summary = summaryParts.slice(0, 2).join(" ") ||
      (affected.length === 0
        ? "No requirements flagged in this category."
        : `${affected.length} requirement(s) have findings in this category.`);

    // Suggestions: top 2–3 suggestion sentences from affected requirements
    const suggestions = affected
      .map((a) => a.suggestion)
      .filter(Boolean)
      .slice(0, 3) as string[];

    categories[dim] = { score, summary, suggestions };
  }

  const scores = Object.values(categories).map((c) => c.score);
  const overallScore =
    Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;

  // Top priorities: suggestions from highest-impact non-congruent reqs
  const topPriorities = audits
    .filter((a) => a.status !== "congruent" && a.suggestion)
    .sort((a, b) => {
      const order: Record<AuditStatus, number> = { conflicting: 0, "needs-clarification": 1, congruent: 2 };
      return order[a.status] - order[b.status];
    })
    .map((a) => a.suggestion)
    .filter(Boolean)
    .slice(0, 3) as string[];

  const overallSummary =
    `${total} requirements audited. ` +
    `${audits.filter((a) => a.status === "congruent").length} congruent, ` +
    `${audits.filter((a) => a.status === "needs-clarification").length} need clarification, ` +
    `${audits.filter((a) => a.status === "conflicting").length} conflicting.`;

  return { overallScore, overallSummary, topPriorities, categories };
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function computeBadge(issues: Issue[]): ReadinessBadge {
  if (issues.some((i) => i.impact === "critical")) return "not-ready";
  if (issues.some((i) => i.impact === "high"))     return "needs-work";
  if (issues.some((i) => i.impact === "medium"))   return "mostly-ready";
  return "ready";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const reqVersion = REQ_VERSION ?? (await detectLatestP2Version());
  const p2Dir = join(DEV_DIR, `p2-${reqVersion}`);

  console.log(`[Phase 3] Parsing audit files from apps/api/.dev/p2-${reqVersion}/`);

  // Discover audit files
  const entries = await readdir(p2Dir).catch(() => [] as string[]);
  const auditFiles = entries
    .filter((f) => /^R\d+-audit\.md$/.test(f))
    .sort();

  if (auditFiles.length === 0) {
    console.error(`[Phase 3] ERROR: No audit files found in .dev/p2-${reqVersion}/`);
    console.error(`[Phase 3]        Run Phase 2 first: pnpm phase2:prep`);
    process.exit(1);
  }

  console.log(`[Phase 3] Found ${auditFiles.length} audit file(s)`);

  // Parse each audit file
  const audits: ParsedAudit[] = [];
  for (const filename of auditFiles) {
    const content = await readFile(join(p2Dir, filename), "utf-8");
    const parsed = parseAuditFile(content);
    if (!parsed) {
      console.warn(`[Phase 3] WARNING: Could not parse ${filename} — skipping`);
      continue;
    }
    audits.push(parsed);
    console.log(`[Phase 3]   ${parsed.id} → ${parsed.status}`);
  }

  // Build issues (skip congruent requirements — no action needed)
  const nonImplemented = audits.filter((a) => a.status !== "congruent");
  const issues: Issue[] = nonImplemented.map(buildIssue);

  // Compute scorecard and badge
  const scorecard = buildScorecard(audits, audits.length);
  const badge = computeBadge(issues);

  // Build AnalysisResult
  const result: AnalysisResult = {
    jobId: `phase3-${reqVersion}`,
    notionPageId: "",
    issueCount: issues.length,
    badge,
    issues,
    analyzedAt: new Date().toISOString(),
    scorecard,
  };

  // Write output
  const p3Dir = join(DEV_DIR, `p3-${reqVersion}`);
  await mkdir(p3Dir, { recursive: true });
  const outPath = join(p3Dir, "analysis-result.json");
  await writeFile(outPath, JSON.stringify(result, null, 2));

  // Summary
  const statusCounts = {
    congruent:           audits.filter((a) => a.status === "congruent").length,
    "needs-clarification": audits.filter((a) => a.status === "needs-clarification").length,
    conflicting:         audits.filter((a) => a.status === "conflicting").length,
  };

  console.log(`\n[Phase 3] ✓ Done`);
  console.log(`[Phase 3]   Parsed:              ${audits.length} requirements`);
  console.log(`[Phase 3]   congruent:           ${statusCounts.congruent}`);
  console.log(`[Phase 3]   needs-clarification: ${statusCounts["needs-clarification"]}`);
  console.log(`[Phase 3]   conflicting:         ${statusCounts.conflicting}`);
  console.log(`[Phase 3]   Requirements flagged: ${issues.length}`);
  console.log(`[Phase 3]   Badge:        ${badge}`);
  console.log(`[Phase 3]   Overall score: ${scorecard.overallScore}/10`);
  console.log(`[Phase 3]   Output:       apps/api/.dev/p3-${reqVersion}/analysis-result.json`);
}

main().catch((err) => {
  console.error("[Phase 3] Script failed:", err);
  process.exit(1);
});
