/**
 * Phase 4 — Semantic Fingerprinting
 *
 * Reads the latest analysis-result.json from Phase 3 and generates a stable
 * semantic fingerprint for each flagged requirement using Claude Haiku.
 *
 * Fingerprint format: <domain>.<subject>.<aspect>.<defect>
 * Example: quota.rotation.trigger.missing
 *
 * The same underlying issue should produce the same fingerprint across runs
 * even if wording varies — enabling cross-run stability analysis.
 *
 * Usage:
 *   cd apps/api && pnpm phase4:fingerprint
 *   cd apps/api && pnpm phase4:fingerprint --req-version v026
 */

import { spawnSync } from "child_process";
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import type { AnalysisResult } from "@alucify/shared-types";

const DEV_DIR = join(process.cwd(), ".dev");
const MODEL = "claude-haiku-4-5-20251001";

const REQ_VERSION = (() => {
  const idx = process.argv.indexOf("--req-version");
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
})();

// ── Version detection ─────────────────────────────────────────────────────────

async function detectLatestP3Version(): Promise<string> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^p3-v\d+$/.test(e))
    .map((e) => e.replace("p3-", ""))
    .sort();
  if (versions.length === 0) {
    console.error("[Phase 4] ERROR: No p3-vNNN folders found. Run Phase 3 first.");
    process.exit(1);
  }
  return versions[versions.length - 1];
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a normalization engine that converts issue descriptions into stable semantic fingerprints.

Your goal is to produce a consistent, comparable identifier for each issue so that the same issue across multiple runs maps to the SAME fingerprint, even if wording differs.

---

## Input

You will receive a list of issues. Each issue may include:
- summary
- description
- suggestion

---

## Task

For each issue, generate a semantic fingerprint using this format:

<domain>.<subject>.<aspect>.<defect>

---

## Step-by-step process

1. Identify the DOMAIN (what area of the system this belongs to)
   Examples:
   - auth, repo, branch, error, session, quota, account, ui, validation

2. Identify the SUBJECT (the core entity or feature)
   Examples:
   - token, revocation, default-branch, repository, timeout, dropdown

3. Identify the ASPECT (what about the subject is problematic)
   Examples:
   - behavior, fallback, message, validation, persistence, selection, visibility

4. Identify the DEFECT TYPE (normalize to one of the following)
   - missing
   - ambiguous
   - conflict
   - duplicate
   - inconsistent

---

## Normalization Rules (CRITICAL)

You MUST normalize different phrasings into the same defect type:

- "not specified", "unspecified", "silent on", "TBD", "unclear"
  → missing

- "may be unclear", "not well defined"
  → ambiguous

- "conflicts with", "breaks existing", "contradicts"
  → conflict

- "repeats", "already exists"
  → duplicate

---

## Constraints

- DO NOT include requirement IDs (e.g. R001)
- DO NOT include file names or code references
- DO NOT include implementation details
- Use short, stable, generic terms
- Prefer hyphenated words for multi-word subjects (e.g. default-branch)
- Keep vocabulary consistent across issues

---

## Output format

Return ONLY JSON:

{
  "fingerprints": [
    {
      "summary": "<original issue summary>",
      "fingerprint": "<domain>.<subject>.<aspect>.<defect>"
    }
  ]
}

---

## Examples

Input:
"Missing fallback when main branch not present"

Output:
branch.default-branch.fallback.missing

---

Input:
"Token revocation behavior unclear"

Output:
auth.token-revocation.behavior.missing

---

Input:
"Timeout error message unspecified"

Output:
error.timeout.message.missing

---

## Important

If two issues describe the same underlying problem, they MUST produce the same fingerprint even if phrased differently.

Your goal is semantic consistency, not linguistic variation.`;

// ── User message builder ──────────────────────────────────────────────────────

function buildUserMessage(issues: AnalysisResult["issues"]): string {
  const lines: string[] = [
    "Below is the list of issues to fingerprint. For each issue, generate a semantic fingerprint as instructed.",
    "",
  ];
  for (const issue of issues) {
    lines.push(`---`);
    lines.push(`Summary: ${issue.summary}`);
    if (issue.description) lines.push(`Description: ${issue.description}`);
    if (issue.suggestion)  lines.push(`Suggestion: ${issue.suggestion}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const version = REQ_VERSION ?? (await detectLatestP3Version());
  const p3Dir = join(DEV_DIR, `p3-${version}`);
  const p4Dir = join(DEV_DIR, `p4-${version}`);

  console.log(`[Phase 4] Fingerprinting requirements from p3-${version}`);

  // Read analysis-result.json
  let result: AnalysisResult & { requirements?: AnalysisResult["issues"] };
  try {
    const raw = await readFile(join(p3Dir, "analysis-result.json"), "utf-8");
    result = JSON.parse(raw);
  } catch {
    console.error(`[Phase 4] ERROR: Could not read ${p3Dir}/analysis-result.json`);
    console.error(`[Phase 4]        Run Phase 3 first: pnpm phase3:parse`);
    process.exit(1);
  }

  // Support both field names: "issues" (current schema) and "requirements" (renamed schema)
  const issues = result.issues ?? result.requirements ?? [];

  if (issues.length === 0) {
    console.log(`[Phase 4] No flagged requirements to fingerprint — all congruent.`);
    return;
  }

  console.log(`[Phase 4] ${issues.length} requirement(s) to fingerprint`);

  // Create p4 folder and write prompt files
  await mkdir(p4Dir, { recursive: true });
  const systemPromptPath = join(p4Dir, "system-prompt.md");
  const userMessagePath  = join(p4Dir, "user-message.md");
  const outputPath       = join(p4Dir, "fingerprints.json");

  await writeFile(systemPromptPath, SYSTEM_PROMPT, "utf-8");
  await writeFile(userMessagePath, buildUserMessage(issues), "utf-8");

  // Build relative paths for the claude prompt
  const relSystemPrompt = `apps/api/.dev/p4-${version}/system-prompt.md`;
  const relUserMessage  = `apps/api/.dev/p4-${version}/user-message.md`;

  const claudePrompt =
    `Read the system prompt at ${relSystemPrompt} and apply it as your instructions. ` +
    `Then read the issues list at ${relUserMessage}. ` +
    `Return ONLY the JSON object with the fingerprints array — no preamble, no explanation.`;

  console.log(`[Phase 4] Running Claude Haiku...`);
  const result2 = spawnSync(
    "claude",
    ["--print", "--dangerously-skip-permissions", "--model", MODEL, claudePrompt],
    { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] },
  );

  if (result2.status !== 0) {
    console.error(`[Phase 4] ERROR: Claude exited with code ${result2.status}`);
    process.exit(1);
  }

  // Extract JSON from stdout — strip any markdown fences Claude may add
  const raw = result2.stdout ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[Phase 4] ERROR: Could not find JSON in Claude output.`);
    console.error(raw.slice(0, 500));
    process.exit(1);
  }

  let parsed: { fingerprints: { summary: string; fingerprint: string }[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.error(`[Phase 4] ERROR: Failed to parse Claude JSON output.`);
    process.exit(1);
  }

  // Match fingerprints back to requirement IDs by summary
  const summaryToId = new Map(issues.map((i) => [i.summary, i.id]));
  const fingerprints = parsed.fingerprints.map((f) => ({
    id: summaryToId.get(f.summary) ?? "unknown",
    summary: f.summary,
    fingerprint: f.fingerprint,
  }));

  const output = {
    version,
    generatedAt: new Date().toISOString(),
    fingerprints,
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n[Phase 4] ✓ Done — ${fingerprints.length} fingerprint(s) generated`);
  console.log(`[Phase 4]   Output: apps/api/.dev/p4-${version}/fingerprints.json`);
  console.log(`\n[Phase 4] Fingerprints:`);
  for (const f of fingerprints) {
    console.log(`  ${f.id.padEnd(6)}  ${f.fingerprint}`);
  }
}

main().catch((err) => {
  console.error("[Phase 4] Fatal:", err);
  process.exit(1);
});
