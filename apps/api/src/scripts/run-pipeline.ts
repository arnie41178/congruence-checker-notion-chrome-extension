/**
 * Full Pipeline — Phase 1 → Phase 2 → Phase 3
 *
 * Runs the complete PRD audit pipeline end-to-end, or a single phase.
 *
 * Usage:
 *   pnpm pipeline                        # run all phases (1 extraction run)
 *   pnpm pipeline --runs 3               # Phase 1 runs 3× with consensus merge
 *   pnpm pipeline --fresh                # rebuild repo index in Phase 2
 *
 *   pnpm pipeline --phase 1              # Phase 1 only (1 run)
 *   pnpm pipeline --phase 1 --runs 3    # Phase 1 only, 3 extraction runs
 *   pnpm pipeline --phase 2              # Phase 2 only (uses latest requirements)
 *   pnpm pipeline --phase 2 --fresh      # Phase 2 only, rebuild repo index
 *   pnpm pipeline --phase 3              # Phase 3 only (re-parse latest audits)
 *
 *   pnpm pipeline --repo-root /path/to/other/repo   # audit a different codebase
 *   pnpm pipeline --prd .dev/prd-github-integration.md  # use a specific PRD file
 */

import { spawnSync } from "child_process";
import { readFile, writeFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import type { PrdRequirements } from "@alucify/shared-types";

const FRESH = process.argv.includes("--fresh");

const PRD_ARG = (() => {
  const idx = process.argv.indexOf("--prd");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const REPO_ROOT_ARG = (() => {
  const idx = process.argv.indexOf("--repo-root");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const REQ_ID_ARG = (() => {
  const idx = process.argv.indexOf("--req-id");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const PHASE = (() => {
  const idx = process.argv.indexOf("--phase");
  if (idx === -1) return null; // null = run all phases
  const n = parseInt(process.argv[idx + 1], 10);
  if (![1, 2, 3, 4].includes(n)) {
    console.error("[Pipeline] --phase must be 1, 2, 3, or 4");
    process.exit(1);
  }
  return n;
})();

const RUNS = (() => {
  const idx = process.argv.indexOf("--runs");
  if (idx !== -1) {
    const n = parseInt(process.argv[idx + 1], 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }
  // Fall back to env var, then default to 5
  const envRuns = parseInt(process.env.PIPELINE_CONSENSUS_RUNS ?? "5", 10);
  return isNaN(envRuns) || envRuns < 1 ? 5 : envRuns;
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function banner(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"─".repeat(60)}`);
}

/** Run a shell command, stream stderr live, capture stdout. Exits on failure. */
function runCapture(cmd: string): string {
  const result = spawnSync(cmd, {
    shell: true,
    encoding: "utf-8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    console.error(`\n[Pipeline] ERROR: command failed (exit ${result.status})\n  ${cmd}`);
    process.exit(1);
  }
  return result.stdout ?? "";
}

/** Run a shell command with all I/O streamed live. Exits on failure. */
function runLive(cmd: string) {
  const result = spawnSync(cmd, {
    shell: true,
    encoding: "utf-8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\n[Pipeline] ERROR: command failed (exit ${result.status})\n  ${cmd}`);
    process.exit(1);
  }
}

/** Extract the `claude ...` command from prep script output.
 *  Both phases wrap it between ====...==== separator lines. */
function extractClaudeCommand(output: string, phase: string): string {
  const SEP = "=".repeat(60);
  const sections = output.split(SEP);
  const block = sections.find((s) => s.trim().startsWith("claude "));
  if (!block) {
    console.error(`[Pipeline] ERROR: Could not find claude command in ${phase} output.`);
    process.exit(1);
  }
  return block.trim();
}

// ── Phase runners ─────────────────────────────────────────────────────────────

function runPhase1() {
  const phase1PrepCmd = RUNS > 1 ? `pnpm phase1:prep --runs ${RUNS}` : "pnpm phase1:prep";
  banner(`Phase 1 — Requirement Extraction (${RUNS} run${RUNS > 1 ? "s" : ""})`);
  const phase1Out = runCapture(phase1PrepCmd);

  if (RUNS === 1) {
    const claudeCmd = extractClaudeCommand(phase1Out, "Phase 1");
    banner("Phase 1 — Running Claude Opus");
    runLive(claudeCmd);
  } else {
    const SEP = "=".repeat(60);
    const blocks = phase1Out.split(SEP).map((s) => s.trim()).filter((s) => s.startsWith("claude "));
    if (blocks.length !== RUNS) {
      console.error(`[Pipeline] ERROR: Expected ${RUNS} claude commands from phase1:prep, got ${blocks.length}`);
      process.exit(1);
    }
    for (let i = 0; i < RUNS; i++) {
      banner(`Phase 1 — Claude Opus run ${i + 1} of ${RUNS}`);
      runLive(blocks[i]);
    }
    banner("Phase 1 — Consensus merge");
    runLive("pnpm phase1:consensus");
  }
}

function runPhase2() {
  // Step 1: Prep — generate user-message files and system prompt
  banner("Phase 2 — Requirement Audit (prep)");
  const phase2PrepCmd = [
    "pnpm phase2:prep",
    FRESH ? "--fresh" : "",
    REPO_ROOT_ARG ? `--repo-root ${REPO_ROOT_ARG}` : "",
    REQ_ID_ARG ? `--req-id ${REQ_ID_ARG}` : "",
  ].filter(Boolean).join(" ");
  runLive(phase2PrepCmd);

  // Step 2: Run — one isolated Claude session per requirement
  banner("Phase 2 — Running Claude Haiku (isolated session per requirement)");
  const phase2RunCmd = [
    "pnpm phase2:run",
    REQ_ID_ARG ? `--req-id ${REQ_ID_ARG}` : "",
  ].filter(Boolean).join(" ");
  runLive(phase2RunCmd);
}

function runPhase3() {
  banner("Phase 3 — Parsing Audit Results");
  runLive("pnpm phase3:parse");
}

function runPhase4() {
  banner("Phase 4 — Semantic Fingerprinting");
  runLive("pnpm phase4:fingerprint");
}

// ── Print final requirements list ─────────────────────────────────────────────

async function printRequirements() {
  const DEV_DIR = join(process.cwd(), ".dev");
  const latestPath = join(DEV_DIR, "p1-requirements-latest.json");
  try {
    const data = JSON.parse(await readFile(latestPath, "utf-8")) as PrdRequirements;
    const PRIORITY_LABEL: Record<string, string> = {
      "must-have": "MUST", "should-have": "SHOULD", "nice-to-have": "NICE",
    };
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  Approved Requirements (${data.requirements.length})`);
    console.log(`${"─".repeat(60)}`);
    for (const req of data.requirements) {
      const pri = PRIORITY_LABEL[req.priority] ?? req.priority;
      const type = req.type.padEnd(15);
      console.log(`  ${req.id}  [${pri}] [${type}]  ${req.title}`);
    }
    console.log(`${"─".repeat(60)}`);
  } catch {
    // requirements file not available — skip silently
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Copy PRD file to .dev/prd.md if --prd was specified
  if (PRD_ARG) {
    const DEV_DIR = join(process.cwd(), ".dev");
    const srcPath = resolve(process.cwd(), PRD_ARG);
    const destPath = join(DEV_DIR, "prd.md");
    try {
      const content = await readFile(srcPath, "utf-8");
      await writeFile(destPath, content, "utf-8");
      console.log(`[Pipeline] PRD loaded from: ${srcPath}`);
    } catch {
      console.error(`[Pipeline] ERROR: Could not read PRD file: ${srcPath}`);
      process.exit(1);
    }
  }

  if (PHASE !== null) {
    console.log(`[Pipeline] Running Phase ${PHASE} only...`);
    if (PHASE === 1) runPhase1();
    if (PHASE === 2) runPhase2();
    if (PHASE === 3) runPhase3();
    if (PHASE === 4) runPhase4();
  } else {
    console.log("[Pipeline] Starting full PRD audit pipeline...");
    runPhase1();
    runPhase2();
    runPhase3();
    runPhase4();
  }

  // Always print the approved requirements list at the end
  if (RUNS > 1 || PHASE === 1 || PHASE === null) {
    await printRequirements();
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(PHASE !== null ? `  Phase ${PHASE} complete.` : "  Pipeline complete.");
  console.log(`${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("[Pipeline] Fatal error:", err);
  process.exit(1);
});
