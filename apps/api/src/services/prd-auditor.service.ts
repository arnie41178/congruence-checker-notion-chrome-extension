import { readFile } from "fs/promises";
import { join } from "path";
import { anthropic, MODEL } from "../lib/anthropic.js";
import type { PrdEntities } from "../prompts/prd-extraction.prompt.js";
import type { RepoIndex } from "./repo-indexer.js";
import type { Issue } from "@alucify/shared-types";

// process.cwd() is apps/api/ when started via pnpm dev
const AGENT_FILE = join(process.cwd(), "src/agents/prd-auditor.md");

// Strip YAML frontmatter (--- ... ---) and return the body as the system prompt
async function loadAgentSystemPrompt(): Promise<string> {
  const raw = await readFile(AGENT_FILE, "utf-8");
  const match = raw.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

function buildAuditUserMessage(
  prdText: string,
  prdEntities: PrdEntities,
  repoIndex: RepoIndex
): string {
  const entitySummary = [
    `Entities: ${prdEntities.entities.join(", ") || "none"}`,
    `API Endpoints: ${prdEntities.apiEndpoints.join(", ") || "none"}`,
    `User Flows: ${prdEntities.userFlows.join(", ") || "none"}`,
    `Tech Requirements: ${prdEntities.techRequirements.join(", ") || "none"}`,
    `Integrations: ${prdEntities.integrations.join(", ") || "none"}`,
  ].join("\n");

  const repoSummary = buildRepoSummary(repoIndex);

  return `## PRD Text
${prdText.slice(0, 30_000)}

## Extracted PRD Entities
${entitySummary}

## Repository Index
${repoSummary}

Perform the PRD audit and return the full markdown audit report.`;
}

function buildRepoSummary(index: RepoIndex): string {
  const lines: string[] = [];
  lines.push(`File count: ${index.fileCount}`);
  lines.push(`\nFile tree:\n${index.fileTree.slice(0, 3000)}`);
  if (index.routes.length > 0) lines.push(`\nExisting API routes:\n${index.routes.join("\n")}`);
  if (index.models.length > 0) lines.push(`\nModel / schema files:\n${index.models.join("\n")}`);
  if (index.services.length > 0) lines.push(`\nService / controller files:\n${index.services.join("\n")}`);
  if (index.keyFileContents) lines.push(`\nKey file contents:\n${index.keyFileContents.slice(0, 6000)}`);
  return lines.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function runPrdAudit(
  prdText: string,
  prdEntities: PrdEntities,
  repoIndex: RepoIndex
): Promise<string> {
  const systemPrompt = await loadAgentSystemPrompt();
  const userMessage = buildAuditUserMessage(prdText, prdEntities, repoIndex);

  const MAX_RETRIES = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }, { timeout: 180_000 }); // 3-minute timeout per attempt
      return response.content[0].type === "text" ? response.content[0].text : "";
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Retry on 529 (overloaded) or 529-adjacent transient errors
      if (status === 529 || status === 503 || status === 502) {
        const delay = attempt * 5000; // 5s, 10s, 15s
        console.warn(`[prd-auditor] Attempt ${attempt} failed (${status}), retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err; // non-retryable
    }
  }

  throw lastErr;
}

// ── Map audit report → Issue[] ────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, Issue["impact"]> = {
  critical: "critical",
  major: "high",
  minor: "low",
};

const CATEGORY_AREA: Record<string, Issue["affectedArea"]> = {
  terminology: "other",
  conflict: "other",
  duplication: "other",
  missing: "other",
};

/**
 * Extract a single bold-labelled field from an issue block.
 * Matches: **Field**: value (up to next **Field**: or end of block)
 */
function extractField(block: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}\\*\\*:\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, "i");
  return block.match(re)?.[1]?.trim() ?? "";
}

/**
 * Parse the structured issue blocks emitted by prd-auditor.md and convert to Issue[].
 * Expected format per issue:
 *   ### Issue N
 *   **Title**: ...
 *   **Category**: ...
 *   **Severity**: Critical|Major|Minor
 *   **Description**: ...
 *   **Evidence**: ...
 *   **Risk**: ...
 *   **Resolution**: ...
 */
export function auditReportToIssues(markdownReport: string): Issue[] {
  const issues: Issue[] = [];

  // Split on "### Issue N" headings
  const blocks = markdownReport.split(/^### Issue \d+\s*$/m).slice(1);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    const title = extractField(block, "Title");
    if (!title) continue;

    const rawSeverity = extractField(block, "Severity").toLowerCase();
    const impact: Issue["impact"] = SEVERITY_MAP[rawSeverity] ?? "medium";

    const category = extractField(block, "Category").toLowerCase();
    const affectedArea: Issue["affectedArea"] = (CATEGORY_AREA[category] ?? "other") as Issue["affectedArea"];

    issues.push({
      id: `audit-${i + 1}`,
      summary: title.slice(0, 200),
      description: extractField(block, "Description").slice(0, 1000),
      impact,
      recommendation: extractField(block, "Resolution").slice(0, 1000),
      affectedArea,
      evidence: extractField(block, "Evidence").slice(0, 500) || undefined,
      risk: extractField(block, "Risk").slice(0, 500) || undefined,
    });
  }

  // Fallback: structured blocks not found — create a single summary issue
  if (issues.length === 0 && markdownReport.length > 100) {
    const statusMatch = markdownReport.match(/\*\*Status\*\*:\s*(.+)/);
    const status = statusMatch?.[1]?.trim() ?? "NEEDS REVIEW";
    issues.push({
      id: "audit-1",
      summary: `PRD Audit: ${status}`,
      description: markdownReport.slice(0, 1000),
      impact: status.includes("MAJOR") ? "high" : "medium",
      recommendation: "Review full audit report for detailed findings.",
      affectedArea: "other",
    });
  }

  return issues.slice(0, 30);
}
