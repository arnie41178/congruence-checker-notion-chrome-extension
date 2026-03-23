/**
 * Phase 2 — Run Audit from Existing Files
 *
 * Runs the claude CLI audit for one or all requirements using pre-existing
 * (or custom) system-prompt.md and user-message files.
 *
 * Useful for:
 *   - Re-running a single audit after editing its user-message file
 *   - Testing a different system prompt without re-running phase2:prep
 *   - Iterating on prompt engineering without regenerating all files
 *
 * Usage:
 *   pnpm phase2:audit --req-version v023 --req-id R001
 *   pnpm phase2:audit --req-version v023                        # all requirements
 *   pnpm phase2:audit --req-version v023 --req-id R001 --system-prompt /path/to/custom-system.md
 *   pnpm phase2:audit --req-version v023 --req-id R001 --user-message /path/to/custom-user.md
 *   pnpm phase2:audit --p2-dir /abs/path/to/p2-folder --req-id R001
 */

import { spawnSync } from "child_process";
import { readFile, writeFile, readdir } from "fs/promises";
import { join, resolve } from "path";

const DEV_DIR = join(process.cwd(), ".dev");
const MODEL_AUDIT = "claude-haiku-4-5-20251001";

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const REQ_VERSION   = getArg("--req-version");
const REQ_ID        = getArg("--req-id");
const SYSTEM_PROMPT = getArg("--system-prompt");
const USER_MESSAGE  = getArg("--user-message");
const P2_DIR_ARG    = getArg("--p2-dir");

// ── Version / folder detection ────────────────────────────────────────────────

async function resolveP2Dir(): Promise<{ p2Dir: string; version: string }> {
  if (P2_DIR_ARG) {
    const p2Dir = resolve(process.cwd(), P2_DIR_ARG);
    const version = p2Dir.replace(/.*p2-/, "");
    return { p2Dir, version };
  }

  if (REQ_VERSION) {
    return { p2Dir: join(DEV_DIR, `p2-${REQ_VERSION}`), version: REQ_VERSION };
  }

  // Auto-detect latest p2-vNNN folder
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries.filter((e) => /^p2-v\d+$/.test(e)).sort();
  if (versions.length === 0) {
    console.error("[Phase 2 Audit] ERROR: No p2-vNNN folders found. Run pnpm phase2:prep first.");
    process.exit(1);
  }
  const latest = versions[versions.length - 1];
  const version = latest.replace("p2-", "");
  console.log(`[Phase 2 Audit] Auto-detected version: ${version}`);
  return { p2Dir: join(DEV_DIR, latest), version };
}

// ── Requirement ID discovery ──────────────────────────────────────────────────

async function discoverReqIds(p2Dir: string): Promise<string[]> {
  const entries = await readdir(p2Dir).catch(() => [] as string[]);
  return entries
    .filter((f) => /^R\d+-user-message\.md$/.test(f))
    .map((f) => f.replace("-user-message.md", ""))
    .sort();
}

// ── Run one audit ─────────────────────────────────────────────────────────────

function runAudit(
  systemPromptPath: string,
  userMessagePath: string,
  auditOutputPath: string,
  reqId: string,
  version: string,
) {
  // Build a minimal run-instructions string inlined as the claude prompt.
  // Claude reads the two files and writes the audit block to the output path.
  const prompt =
    `Read the system prompt at ${systemPromptPath} — apply it exactly.\n` +
    `Then read the user message at ${userMessagePath}.\n` +
    `Produce the structured audit block as instructed by the system prompt.\n` +
    `Use your Write tool to save the result to ${auditOutputPath} — do NOT print it to stdout.`;

  console.log(`[Phase 2 Audit] Running ${reqId}...`);
  const result = spawnSync(
    "claude",
    ["--print", "--dangerously-skip-permissions", "--model", MODEL_AUDIT, prompt],
    { stdio: "inherit", encoding: "utf-8" },
  );

  if (result.status !== 0) {
    console.error(`[Phase 2 Audit] ERROR: claude exited with code ${result.status} for ${reqId}`);
    return false;
  }
  console.log(`[Phase 2 Audit] ✓ ${reqId} → ${auditOutputPath}`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { p2Dir, version } = await resolveP2Dir();

  // Resolve system prompt
  const systemPromptPath = SYSTEM_PROMPT
    ? resolve(process.cwd(), SYSTEM_PROMPT)
    : join(p2Dir, "system-prompt.md");

  // Verify system prompt exists
  try {
    await readFile(systemPromptPath, "utf-8");
  } catch {
    console.error(`[Phase 2 Audit] ERROR: system-prompt not found at ${systemPromptPath}`);
    console.error(`[Phase 2 Audit]        Run pnpm phase2:prep first, or pass --system-prompt <file>`);
    process.exit(1);
  }

  // Determine which requirements to audit
  const allIds = await discoverReqIds(p2Dir);
  if (allIds.length === 0) {
    console.error(`[Phase 2 Audit] ERROR: No user-message files found in ${p2Dir}`);
    console.error(`[Phase 2 Audit]        Run pnpm phase2:prep first.`);
    process.exit(1);
  }

  const targetIds = REQ_ID ? [REQ_ID] : allIds;

  if (REQ_ID && !allIds.includes(REQ_ID)) {
    console.error(`[Phase 2 Audit] ERROR: --req-id "${REQ_ID}" not found. Available: ${allIds.join(", ")}`);
    process.exit(1);
  }

  console.log(`[Phase 2 Audit] Version: ${version} | ${targetIds.length} requirement(s) to audit`);
  console.log(`[Phase 2 Audit] System prompt: ${systemPromptPath}`);
  if (USER_MESSAGE) console.log(`[Phase 2 Audit] User message override: ${USER_MESSAGE}`);
  console.log(``);

  let passed = 0;
  let failed = 0;

  for (const reqId of targetIds) {
    const userMessagePath = USER_MESSAGE
      ? resolve(process.cwd(), USER_MESSAGE)
      : join(p2Dir, `${reqId}-user-message.md`);

    const auditOutputPath = join(p2Dir, `${reqId}-audit.md`);

    const ok = runAudit(systemPromptPath, userMessagePath, auditOutputPath, reqId, version);
    if (ok) passed++; else failed++;
  }

  console.log(`\n[Phase 2 Audit] Done — ${passed} succeeded, ${failed} failed`);
  if (passed > 0) {
    console.log(`[Phase 2 Audit] Run Phase 3 to parse results:`);
    console.log(`  pnpm phase3:parse --req-version ${version}`);
  }
}

main().catch((err) => {
  console.error("[Phase 2 Audit] Fatal:", err);
  process.exit(1);
});
