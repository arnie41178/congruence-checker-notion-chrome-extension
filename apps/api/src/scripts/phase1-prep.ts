/**
 * Phase 1 — Requirement Extraction (prep)
 *
 * Reads .dev/prd.md and writes prompt files + prints the Claude CLI command(s).
 *
 * Output structure (version-specific folder):
 *   .dev/p1-vNNN/
 *     system-prompt.md
 *     user-message.md
 *     requirements.json         ← single-run output
 *     requirements-run1.json    ← multi-run outputs
 *     requirements-run2.json
 *     ...
 *   .dev/p1-requirements-latest.json  ← top-level pointer (read by phase2)
 *
 * Usage:
 *   cd apps/api && pnpm phase1:prep
 *   cd apps/api && pnpm phase1:prep --runs 3
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import {
  REQUIREMENT_EXTRACTION_SYSTEM,
  buildRequirementExtractionPrompt,
  MODEL_EXTRACTION,
} from "../prompts/requirement-extraction.prompt.js";

const DEV_DIR  = join(process.cwd(), ".dev");
const PRD_PATH = join(DEV_DIR, "prd.md");

const RUNS = (() => {
  const idx = process.argv.indexOf("--runs");
  if (idx === -1) return 1;
  const n = parseInt(process.argv[idx + 1], 10);
  if (isNaN(n) || n < 1) { console.error("[Phase 1] --runs must be a positive integer"); process.exit(1); }
  return n;
})();

// ── Version detection ─────────────────────────────────────────────────────────

async function nextVersion(): Promise<number> {
  let entries: string[] = [];
  try { entries = await readdir(DEV_DIR); } catch { return 1; }
  const versions = entries.flatMap((f) => {
    // New folder format: p1-vNNN
    const folderMatch = f.match(/^p1-v(\d+)$/);
    if (folderMatch) return [parseInt(folderMatch[1], 10)];
    // Old flat-file format: p1-requirements-vNNN.json
    const fileMatch = f.match(/^p1-requirements-v(\d+)\.json$/);
    if (fileMatch) return [parseInt(fileMatch[1], 10)];
    return [];
  });
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load PRD
  let prdText: string;
  try {
    prdText = await readFile(PRD_PATH, "utf-8");
    console.log(`[Phase 1] PRD loaded: ${prdText.length} chars`);
  } catch {
    console.error(`[Phase 1] ERROR: No PRD found.\n           Create apps/api/.dev/prd.md with your PRD text first.\n`);
    process.exit(1);
  }

  if (prdText.trim().length < 50) {
    console.error(`[Phase 1] ERROR: prd.md is too short (${prdText.trim().length} chars). Paste a real PRD.`);
    process.exit(1);
  }

  // 2. Determine next version and create folder
  const version = await nextVersion();
  const versionTag = `v${pad(version)}`;
  const versionDir = join(DEV_DIR, `p1-${versionTag}`);
  await mkdir(versionDir, { recursive: true });

  console.log(`[Phase 1] Next version: ${versionTag}`);
  console.log(`[Phase 1] Output folder: apps/api/.dev/p1-${versionTag}/`);

  // 3. Build prompt files
  const systemPrompt = REQUIREMENT_EXTRACTION_SYSTEM;
  const userMessage  = buildRequirementExtractionPrompt(prdText);

  // 4. Write prompt files into version folder
  await writeFile(join(versionDir, "system-prompt.md"), systemPrompt);
  await writeFile(join(versionDir, "user-message.md"),  userMessage);

  console.log(`[Phase 1] Prompt files written:`);
  console.log(`            apps/api/.dev/p1-${versionTag}/system-prompt.md  (${systemPrompt.length} chars)`);
  console.log(`            apps/api/.dev/p1-${versionTag}/user-message.md   (${userMessage.length} chars)`);
  console.log(`\n[Phase 1] Model for extraction: ${MODEL_EXTRACTION}\n`);

  // 5. Build and print Claude CLI command(s)
  const buildCommand = (outputFiles: string[]) => [
    `claude --print --dangerously-skip-permissions --model claude-opus-4-6 "`,
    `Use the contents of apps/api/.dev/p1-${versionTag}/system-prompt.md as your system instructions.`,
    `Read apps/api/.dev/p1-${versionTag}/user-message.md and extract requirements from the PRD.`,
    ``,
    `Your output must be a valid JSON object matching this shape:`,
    `{`,
    `  \\"requirements\\": [`,
    `    { \\"id\\": \\"R001\\", \\"title\\": \\"...\\" , \\"description\\": \\"...\\", \\"type\\": \\"functional\\", \\"priority\\": \\"must-have\\" }`,
    `  ]`,
    `}`,
    ``,
    `Write the JSON to ${outputFiles.length > 1 ? "ALL of" : "BOTH of"} these files (identical content):`,
    ...outputFiles.map((f) => `  ${f}`),
    `"`,
  ].join("\n");

  if (RUNS === 1) {
    const reqFile    = `apps/api/.dev/p1-${versionTag}/requirements.json`;
    const latestFile = `apps/api/.dev/p1-requirements-latest.json`;
    const cmd = buildCommand([reqFile, latestFile]);
    console.log("=".repeat(60));
    console.log("Run this Claude CLI command:");
    console.log("=".repeat(60));
    console.log(cmd);
    console.log("=".repeat(60));
  } else {
    console.log(`[Phase 1] Multi-run mode: ${RUNS} independent extractions → consensus`);
    for (let i = 1; i <= RUNS; i++) {
      const runFile = `apps/api/.dev/p1-${versionTag}/requirements-run${i}.json`;
      const cmd = buildCommand([runFile]);
      console.log("=".repeat(60));
      console.log(`Run ${i} of ${RUNS}:`);
      console.log("=".repeat(60));
      console.log(cmd);
      console.log("=".repeat(60));
      console.log("");
    }
    console.log(`[Phase 1] After all ${RUNS} runs complete, merge with:`);
    console.log(`  pnpm phase1:consensus --req-version ${versionTag}`);
  }
}

main().catch((err) => {
  console.error("[Phase 1] Script failed:", err);
  process.exit(1);
});
