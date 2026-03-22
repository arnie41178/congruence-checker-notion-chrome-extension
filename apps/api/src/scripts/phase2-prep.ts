/**
 * Phase 2 — Per-Requirement Audit (prep)
 *
 * Reads the requirements from Phase 1 and the codebase, then writes one
 * user-message file per requirement plus a shared system-prompt file.
 *
 * Versioning:
 *   Output files are namespaced by the requirements version, e.g.:
 *     .dev/p2-v002-R001-user-message.md
 *     .dev/p2-v002-R001-audit.md        ← written by Claude CLI
 *
 *   This means re-running Phase 2 with a new req version (v003) never
 *   overwrites audit files from a previous req version (v002).
 *
 * Usage:
 *   cd apps/api && pnpm phase2:prep
 *   cd apps/api && pnpm phase2:prep --fresh                          # rebuild repo index
 *   cd apps/api && pnpm phase2:prep --req-version v001               # pin req version
 *   cd apps/api && pnpm phase2:prep --repo-root /path/to/other/repo  # different codebase
 */

import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join, extname, relative } from "path";
import { buildRepoIndex } from "../services/repo-indexer.js";
import { buildGraphContextFromExistingIndex } from "../services/graph-context.js";
import type { Requirement, PrdRequirements } from "@alucify/shared-types";
import type { RepoContext, RepoFile } from "@alucify/shared-types";
import type { RepoIndex } from "../services/repo-indexer.js";

const DEV_DIR    = join(process.cwd(), ".dev");
const AGENT_FILE = join(process.cwd(), "src/agents/requirement-auditor.md");

const REPO_ROOT = (() => {
  const idx = process.argv.indexOf("--repo-root");
  if (idx !== -1) {
    const p = process.argv[idx + 1];
    if (!p) { console.error("[Phase 2] --repo-root requires a path argument"); process.exit(1); }
    return p;
  }
  return join(process.cwd(), "../..");  // default: current monorepo
})();

const REPO_IDX_CACHE = join(DEV_DIR, "repo-index.json");

const FORCE_FRESH   = process.argv.includes("--fresh");
const REQ_VERSION   = (() => {
  const idx = process.argv.indexOf("--req-version");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const REQ_ID        = (() => {
  const idx = process.argv.indexOf("--req-id");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const MODEL_AUDIT = "claude-haiku-4-5-20251001";

// ── File scanner (same as phase1-prep, scans local repo) ─────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".turbo", ".next", ".nuxt",
  "coverage", ".cache", "build", ".dev", ".gitnexus",
]);
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rs",
  ".json", ".yaml", ".yml", ".md", ".toml",
]);
const MAX_FILES       = 300;
const MAX_FILE_BYTES  = 50_000;

async function scanRepoFiles(root: string): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  async function walk(dir: string) {
    if (files.length >= MAX_FILES) return;
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(fullPath);
      } else if (s.isFile() && CODE_EXTS.has(extname(entry)) && s.size <= MAX_FILE_BYTES) {
        const content = await readFile(fullPath, "utf-8").catch(() => null);
        if (content) files.push({ path: relative(root, fullPath), content });
      }
    }
  }
  await walk(root);
  return files;
}

// ── Repo index: load from cache or build fresh ────────────────────────────────

async function loadOrBuildRepoIndex(): Promise<RepoIndex> {
  if (!FORCE_FRESH) {
    try {
      const cached = JSON.parse(await readFile(REPO_IDX_CACHE, "utf-8")) as RepoIndex;
      console.log(`[Phase 2] Repo index loaded from cache (--fresh to rebuild)`);
      return cached;
    } catch {
      console.log(`[Phase 2] No repo index cache found — building now...`);
    }
  } else {
    console.log(`[Phase 2] --fresh: rebuilding repo index...`);
  }

  const files = await scanRepoFiles(REPO_ROOT);
  const ctx: RepoContext = {
    name: "local",
    files,
    meta: { totalFiles: files.length, totalChars: files.reduce((s, f) => s + f.content.length, 0) },
  };
  const index = buildRepoIndex(ctx);
  await writeFile(REPO_IDX_CACHE, JSON.stringify(index, null, 2));
  console.log(`[Phase 2] Repo index built: ${files.length} files, ${index.routes.length} routes — cached to repo-index.json`);
  return index;
}

// ── Requirements: load latest or specific version ─────────────────────────────

async function loadRequirements(): Promise<{ data: PrdRequirements; version: string }> {
  if (REQ_VERSION) {
    const path = join(DEV_DIR, `p1-requirements-${REQ_VERSION}.json`);
    try {
      const data = JSON.parse(await readFile(path, "utf-8")) as PrdRequirements;
      console.log(`[Phase 2] Requirements loaded: ${REQ_VERSION} (${data.requirements.length} requirements)`);
      return { data, version: REQ_VERSION };
    } catch {
      console.error(`[Phase 2] ERROR: Could not load ${path}`);
      process.exit(1);
    }
  }

  // Auto-detect version from latest file
  const latestPath = join(DEV_DIR, "p1-requirements-latest.json");
  try {
    const data = JSON.parse(await readFile(latestPath, "utf-8")) as PrdRequirements;

    // Detect version tag by finding the latest p1-vNNN directory
    const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
    const versionDirs = entries
      .filter((f) => f.match(/^p1-v\d+$/))
      .sort();
    const version = versionDirs.length > 0
      ? versionDirs[versionDirs.length - 1].replace("p1-", "")
      : "v001";

    console.log(`[Phase 2] Requirements loaded: ${version} (${data.requirements.length} requirements)`);
    return { data, version };
  } catch {
    console.error(`[Phase 2] ERROR: No requirements file found.\n           Run Phase 1 first: pnpm phase1:prep`);
    process.exit(1);
  }
}

// ── Build user message for one requirement ────────────────────────────────────

function buildUserMessage(req: Requirement, index: RepoIndex, graphContext: string | null): string {
  const lines: string[] = [];

  lines.push(`## Requirement`);
  lines.push(`ID: ${req.id}`);
  lines.push(`Title: ${req.title}`);
  lines.push(`Type: ${req.type} | Priority: ${req.priority}`);
  lines.push(`Description: ${req.description}`);
  if (req.prd_excerpts && req.prd_excerpts.length > 0) {
    lines.push(`\n### PRD Excerpts`);
    req.prd_excerpts.forEach((excerpt, i) => lines.push(`${i + 1}. "${excerpt}"`));
  }
  lines.push(``);

  lines.push(`## Repository Index`);
  lines.push(`File count: ${index.fileCount}`);
  lines.push(`\nFile tree:\n${index.fileTree.slice(0, 3000)}`);
  if (index.routes.length > 0) lines.push(`\nExisting API routes:\n${index.routes.join("\n")}`);
  if (index.models.length > 0) lines.push(`\nModel / schema files:\n${index.models.join("\n")}`);
  if (index.services.length > 0) lines.push(`\nService / controller files:\n${index.services.join("\n")}`);
  if (index.keyFileContents) lines.push(`\nKey file contents:\n${index.keyFileContents.slice(0, 6000)}`);

  if (graphContext) {
    lines.push(`\n## Codebase Symbol Graph\n${graphContext}`);
  }

  lines.push(``);
  lines.push(`Audit the requirement above and return ONLY the structured block as instructed.`);

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load system prompt from agent file
  let rawAgent: string;
  try {
    rawAgent = await readFile(AGENT_FILE, "utf-8");
  } catch {
    console.error(`[Phase 2] ERROR: Agent file not found at ${AGENT_FILE}`);
    process.exit(1);
  }
  // Strip YAML frontmatter
  const systemPrompt = rawAgent.replace(/^---[\s\S]*?---\n/, "").trim();

  // 2. Load requirements
  const { data: reqData, version: reqVersion } = await loadRequirements();
  const requirements = reqData.requirements;

  // 3. Load repo index
  const repoIndex = await loadOrBuildRepoIndex();

  // 4. Load graph context (optional)
  const graphContext = await buildGraphContextFromExistingIndex(REPO_ROOT).catch(() => null);
  console.log(graphContext
    ? `[Phase 2] Graph context loaded: ${graphContext.length} chars`
    : `[Phase 2] No .gitnexus index found — graph context skipped`
  );

  // 5. Create version subfolder: .dev/p2-{reqVersion}/
  const versionDir = join(DEV_DIR, `p2-${reqVersion}`);
  await mkdir(versionDir, { recursive: true });
  console.log(`[Phase 2] Output folder: apps/api/.dev/p2-${reqVersion}/`);

  // 6. Write system prompt into the version folder
  await writeFile(join(versionDir, "system-prompt.md"), systemPrompt);

  // 7. Write one user-message file per requirement
  console.log(`\n[Phase 2] Writing user-message files for ${requirements.length} requirements...`);
  for (const req of requirements) {
    const userMessage = buildUserMessage(req, repoIndex, graphContext);
    await writeFile(join(versionDir, `${req.id}-user-message.md`), userMessage);
  }
  console.log(`[Phase 2] Done — ${requirements.length} user-message files written to apps/api/.dev/p2-${reqVersion}/`);
  console.log(`[Phase 2] Model for audit: ${MODEL_AUDIT}\n`);

  // 8. Determine which requirements to audit
  const allIds = requirements.map((r) => r.id);
  const targetIds = REQ_ID ? [REQ_ID] : allIds;

  if (REQ_ID && !allIds.includes(REQ_ID)) {
    console.error(`[Phase 2] ERROR: --req-id "${REQ_ID}" not found in requirements. Valid IDs: ${allIds.join(", ")}`);
    process.exit(1);
  }

  // 9. Build run-instructions.md
  const runInstructionsFilename = REQ_ID
    ? `run-instructions-${REQ_ID}.md`
    : `run-instructions.md`;
  const runInstructionsPath = join(versionDir, runInstructionsFilename);

  const allRequirementsJson = JSON.stringify(
    { requirements: requirements.map(({ id, title, description, type, priority }) => ({ id, title, description, type, priority })) },
    null,
    2
  );

  const loopInstructions = targetIds.map((id) =>
    `- Read \`apps/api/.dev/p2-${reqVersion}/${id}-user-message.md\` (contains the full requirement + repo index)\n` +
    `  Apply the system prompt instructions above to audit ONLY requirement ${id}.\n` +
    `  Use your Write tool to save the structured audit block to \`apps/api/.dev/p2-${reqVersion}/${id}-audit.md\` — do NOT print it to stdout.`
  ).join("\n");

  const runInstructions = [
    `# Phase 2 Audit Run Instructions`,
    ``,
    `## System Instructions`,
    ``,
    `Apply the following system instructions to every requirement audit below:`,
    ``,
    `---`,
    systemPrompt,
    `---`,
    ``,
    `## All Requirements (for context)`,
    ``,
    `The full requirement set is provided below for two purposes:`,
    `1. **Duplication detection** — use it to identify whether a requirement duplicates or overlaps with another requirement in scope, ownership, or behavior.`,
    `2. **Scope awareness** — use it to avoid flagging something as missing when it is clearly covered by a separate, dedicated requirement.`,
    ``,
    `Audit each requirement independently. Do NOT apply findings from one requirement onto another. Do NOT reference what "other requirements say" in your output — each audit block must stand alone.`,
    ``,
    "```json",
    allRequirementsJson,
    "```",
    ``,
    `## Audit Loop`,
    ``,
    `Audit each requirement listed below, one at a time, in order:`,
    ``,
    loopInstructions,
    ``,
    `## Completion`,
    ``,
    `After all audits are written, print: "Phase 2 complete — ${targetIds.length} requirement(s) audited."`,
  ].join("\n");

  await writeFile(runInstructionsPath, runInstructions);
  console.log(`[Phase 2] Run instructions written: apps/api/.dev/p2-${reqVersion}/${runInstructionsFilename}`);

  // 10. Print single claude CLI command
  const relRunInstructionsPath = `apps/api/.dev/p2-${reqVersion}/${runInstructionsFilename}`;

  console.log(`\n${"=".repeat(60)}`);
  if (REQ_ID) {
    console.log(`SINGLE REQUIREMENT AUDIT (${REQ_ID}):`);
  } else {
    console.log(`ALL REQUIREMENTS AUDIT (${allIds.length} requirements):`);
  }
  console.log("=".repeat(60));
  console.log(
    `claude --print --dangerously-skip-permissions --model ${MODEL_AUDIT} ` +
    `"Read ${relRunInstructionsPath} and follow the instructions exactly."`
  );
  console.log("=".repeat(60));

  if (!REQ_ID) {
    console.log(`\nTo audit a single requirement, re-run with:`);
    console.log(`  pnpm phase2:prep --req-id R001`);
  }
  console.log(`\nWhen done, run Phase 3 to parse all audit results:`);
  console.log(`  pnpm phase3:parse`);
  console.log(`  pnpm phase3:parse --req-version ${reqVersion}  # to target this version explicitly`);
}

main().catch((err) => {
  console.error("[Phase 2] Script failed:", err);
  process.exit(1);
});
