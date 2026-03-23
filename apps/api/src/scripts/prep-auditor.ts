/**
 * Prepares auditor inputs without any API calls.
 * Outputs two files into .dev/:
 *   system-prompt.md  — current prd-auditor.md content
 *   user-message.md   — formatted PRD + repo index + graph context
 *
 * Then run the audit in Claude Code CLI (no API key needed):
 *   claude "Read apps/api/.dev/system-prompt.md as your instructions,
 *           then audit apps/api/.dev/user-message.md and output the full report"
 *
 * Usage:
 *   cd apps/api && pnpm prep:auditor
 *   (re-run with --fresh to rebuild repo index cache)
 */

import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { buildRepoIndex } from "../services/repo-indexer.js";
import { buildGraphContextFromExistingIndex } from "../services/graph-context.js";
import { buildAuditUserMessage, loadAgentSystemPrompt } from "../services/prd-auditor.service.js";
import type { RepoContext, RepoFile } from "@alucify/shared-types";
import type { RepoIndex } from "../services/repo-indexer.js";
import type { PrdEntities } from "../prompts/prd-extraction.prompt.js";

const DEV_DIR    = join(process.cwd(), ".dev");
const PRD_PATH   = join(DEV_DIR, "prd.md");
const CACHE_PATH = join(DEV_DIR, "cached-inputs.json");
const REPO_ROOT  = join(process.cwd(), "../..");
const FORCE_FRESH = process.argv.includes("--fresh");

// ── File scanner ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".turbo", ".next", ".nuxt",
  "coverage", ".cache", "build", ".dev", ".gitnexus",
]);
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rs",
  ".json", ".yaml", ".yml", ".md", ".toml",
]);
const MAX_FILES = 300;
const MAX_FILE_BYTES = 50_000;

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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. PRD text
  let prdText: string;
  try {
    prdText = await readFile(PRD_PATH, "utf-8");
    console.log(`[prep] PRD loaded: ${prdText.length} chars`);
  } catch {
    console.error(`[prep] No PRD found. Create  apps/api/.dev/prd.md  with your PRD text.\n`);
    process.exit(1);
  }

  // 2. Graph context from .gitnexus (no API)
  console.log("[prep] Loading graph context from .gitnexus...");
  const graphContext = await buildGraphContextFromExistingIndex(REPO_ROOT);
  console.log(graphContext
    ? `[prep] Graph context: ${graphContext.length} chars`
    : `[prep] No .gitnexus index — run  npx gitnexus analyze  from repo root`
  );

  // 3. Repo index — load from cache or build fresh (no API)
  let repoIndex: RepoIndex;
  let prdEntities: PrdEntities = { entities: [], apiEndpoints: [], userFlows: [], techRequirements: [], integrations: [] };

  if (!FORCE_FRESH) {
    try {
      const cached = JSON.parse(await readFile(CACHE_PATH, "utf-8")) as { prdEntities: PrdEntities; repoIndex: RepoIndex };
      repoIndex = cached.repoIndex;
      prdEntities = cached.prdEntities;
      console.log(`[prep] Repo index loaded from cache (--fresh to rebuild)`);
    } catch {
      console.log("[prep] No cache — scanning repo files...");
      repoIndex = await buildIndex();
    }
  } else {
    console.log("[prep] --fresh: rebuilding repo index...");
    repoIndex = await buildIndex();
  }

  async function buildIndex(): Promise<RepoIndex> {
    const files = await scanRepoFiles(REPO_ROOT);
    const ctx: RepoContext = {
      name: "local", files,
      meta: { totalFiles: files.length, totalChars: files.reduce((s, f) => s + f.content.length, 0) },
    };
    const idx = buildRepoIndex(ctx);
    await writeFile(CACHE_PATH, JSON.stringify({ prdEntities, repoIndex: idx }, null, 2));
    console.log(`[prep] Repo index built: ${files.length} files, ${idx.routes.length} routes — cached`);
    return idx;
  }

  // 4. Format inputs using the same function the real pipeline uses
  const systemPrompt = await loadAgentSystemPrompt();
  const userMessage = buildAuditUserMessage(prdText, prdEntities, repoIndex, graphContext);

  // 5. Write output files
  await writeFile(join(DEV_DIR, "system-prompt.md"), systemPrompt);
  await writeFile(join(DEV_DIR, "user-message.md"), userMessage);

  console.log(`\n[prep] Done. Files written to apps/api/.dev/`);
  console.log(`         system-prompt.md  (${systemPrompt.length} chars)`);
  console.log(`         user-message.md   (${userMessage.length} chars)`);
  console.log(`\nNow run in Claude Code CLI:`);
  console.log(`  claude "Use apps/api/.dev/system-prompt.md as your system instructions, then audit apps/api/.dev/user-message.md and output the full report"`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
