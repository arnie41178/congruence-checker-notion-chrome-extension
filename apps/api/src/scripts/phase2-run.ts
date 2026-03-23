/**
 * Phase 2 — Orchestrated Per-Requirement Audit
 *
 * Runs ONE Claude CLI process per requirement (not one big batch session).
 * Each process receives a fresh context containing:
 *   - The system prompt (from system-prompt.md)
 *   - The FULL requirements list (injected for scope/duplication awareness)
 *   - The specific requirement's user-message (repo index, etc.)
 *
 * This avoids context fatigue and cross-requirement anchoring from batch
 * processing, while still giving each audit full scope awareness so Claude
 * does not flag items as "missing" that are already covered by other requirements.
 *
 * Usage:
 *   cd apps/api && pnpm phase2:run                      # all reqs, latest version
 *   cd apps/api && pnpm phase2:run --req-version v027   # pin version
 *   cd apps/api && pnpm phase2:run --req-id R004        # single requirement
 */

import { spawnSync } from "child_process";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import type { PrdRequirements } from "@alucify/shared-types";

const DEV_DIR    = join(process.cwd(), ".dev");
const MODEL_AUDIT = "claude-haiku-4-5-20251001";

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const REQ_VERSION = getArg("--req-version");
const REQ_ID      = getArg("--req-id");

// ── Version detection ─────────────────────────────────────────────────────────

async function detectLatestP2Version(): Promise<string> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^p2-v\d+$/.test(e))
    .map((e) => e.replace("p2-", ""))
    .sort();
  if (versions.length === 0) {
    console.error("[Phase 2 Run] ERROR: No p2-vNNN folders found. Run pnpm phase2:prep first.");
    process.exit(1);
  }
  return versions[versions.length - 1];
}

// ── Requirement ID discovery ──────────────────────────────────────────────────

async function discoverReqIds(p2Dir: string): Promise<string[]> {
  const entries = await readdir(p2Dir).catch(() => [] as string[]);
  return entries
    .filter((f) => /^R\d+-user-message\.md$/.test(f))
    .map((f) => f.replace("-user-message.md", ""))
    .sort();
}

// ── Claude prompt builder ─────────────────────────────────────────────────────

function buildPrompt(
  systemPromptPath: string,
  userMessagePath: string,
  auditOutputPath: string,
  allRequirementsJson: string,
): string {
  return [
    `Read the system prompt at ${systemPromptPath} and apply it as your instructions.`,
    ``,
    `## Full Requirements Set (for scope awareness only)`,
    ``,
    `The complete list of requirements being audited in this PRD is provided below.`,
    `Use this ONLY to:`,
    `1. Identify whether THIS requirement duplicates another in scope or behavior.`,
    `2. Avoid flagging something as "missing" when it is already covered by a separate, dedicated requirement.`,
    ``,
    `Audit requirements independently. Do NOT reference what other requirements say in your output — each audit block must stand alone.`,
    ``,
    "```json",
    allRequirementsJson,
    "```",
    ``,
    `Now read the requirement and repository context at ${userMessagePath}.`,
    `Audit ONLY that single requirement following the system prompt instructions.`,
    `Use your Write tool to save the structured audit block to ${auditOutputPath} — do NOT print it to stdout.`,
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const version = REQ_VERSION ?? (await detectLatestP2Version());
  const p2Dir = join(DEV_DIR, `p2-${version}`);

  // Load system prompt
  const systemPromptPath = join(p2Dir, "system-prompt.md");
  try {
    await readFile(systemPromptPath, "utf-8");
  } catch {
    console.error(`[Phase 2 Run] ERROR: system-prompt.md not found in p2-${version}.`);
    console.error(`[Phase 2 Run]        Run pnpm phase2:prep first.`);
    process.exit(1);
  }

  // Load full requirements list for scope awareness
  const latestReqsPath = join(DEV_DIR, "p1-requirements-latest.json");
  let allRequirementsJson = "[]";
  try {
    const reqs = JSON.parse(await readFile(latestReqsPath, "utf-8")) as PrdRequirements;
    allRequirementsJson = JSON.stringify(
      { requirements: reqs.requirements.map(({ id, title, description, type, priority }) => ({ id, title, description, type, priority })) },
      null,
      2,
    );
  } catch {
    console.warn(`[Phase 2 Run] WARNING: Could not load p1-requirements-latest.json — scope context will be omitted.`);
  }

  // Discover which requirements to audit
  const allIds = await discoverReqIds(p2Dir);
  if (allIds.length === 0) {
    console.error(`[Phase 2 Run] ERROR: No user-message files found in p2-${version}.`);
    process.exit(1);
  }

  const targetIds = REQ_ID ? [REQ_ID] : allIds;

  if (REQ_ID && !allIds.includes(REQ_ID)) {
    console.error(`[Phase 2 Run] ERROR: --req-id "${REQ_ID}" not found. Available: ${allIds.join(", ")}`);
    process.exit(1);
  }

  console.log(`[Phase 2 Run] Version: ${version} | ${targetIds.length} requirement(s) — isolated session per requirement`);
  console.log(`[Phase 2 Run] Model: ${MODEL_AUDIT}`);
  console.log(`[Phase 2 Run] Requirements in scope context: ${JSON.parse(allRequirementsJson).requirements?.length ?? 0}\n`);

  let passed = 0;
  let failed = 0;

  for (const reqId of targetIds) {
    const userMessagePath = `apps/api/.dev/p2-${version}/${reqId}-user-message.md`;
    const auditOutputPath = `apps/api/.dev/p2-${version}/${reqId}-audit.md`;
    const sysPromptPath   = `apps/api/.dev/p2-${version}/system-prompt.md`;

    const prompt = buildPrompt(sysPromptPath, userMessagePath, auditOutputPath, allRequirementsJson);

    console.log(`[Phase 2 Run] Auditing ${reqId}...`);
    const result = spawnSync(
      "claude",
      ["--print", "--dangerously-skip-permissions", "--model", MODEL_AUDIT, prompt],
      { stdio: "inherit", encoding: "utf-8" },
    );

    if (result.status !== 0) {
      console.error(`[Phase 2 Run] ERROR: claude exited with code ${result.status} for ${reqId}`);
      failed++;
    } else {
      console.log(`[Phase 2 Run] ✓ ${reqId} written to ${auditOutputPath}`);
      passed++;
    }
  }

  console.log(`\n[Phase 2 Run] Done — ${passed} succeeded, ${failed} failed`);
  if (passed > 0) {
    console.log(`[Phase 2 Run] Run Phase 3 to parse results:`);
    console.log(`  pnpm phase3:parse --req-version ${version}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[Phase 2 Run] Fatal:", err);
  process.exit(1);
});
