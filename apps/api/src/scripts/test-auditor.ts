/**
 * Prompt iteration script for prd-auditor.md
 *
 * Stage 1 (entity extraction) and Stage 2 (repo index) are computed ONCE
 * and cached to .dev/cached-inputs.json. Only Stage 3 (the auditor) runs
 * on every iteration, so prompt changes are fast to test.
 *
 * Setup (one-time):
 *   1. Paste your PRD text into  apps/api/.dev/prd.md
 *   2. Ensure  npx gitnexus analyze  has been run from the repo root
 *   3. Run once to build cache:  pnpm test:auditor
 *
 * Iterate on prd-auditor.md:
 *   pnpm test:auditor          ← uses cached entities + repo index
 *   pnpm test:auditor --fresh  ← forces rebuild of cache
 */

import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { anthropic, MODEL } from "../lib/anthropic.js";
import { buildRepoIndex } from "../services/repo-indexer.js";
import { buildGraphContextFromExistingIndex } from "../services/graph-context.js";
import { runPrdAudit, auditReportToIssues, scorecardFromReport } from "../services/prd-auditor.service.js";
import {
  PRD_EXTRACTION_SYSTEM,
  buildPrdExtractionPrompt,
  type PrdEntities,
} from "../prompts/prd-extraction.prompt.js";
import type { RepoContext, RepoFile } from "@alucify/shared-types";
import type { RepoIndex } from "../services/repo-indexer.js";

const DEV_DIR     = join(process.cwd(), ".dev");
const PRD_PATH    = join(DEV_DIR, "prd.md");
const CACHE_PATH  = join(DEV_DIR, "cached-inputs.json");
const REPO_ROOT   = join(process.cwd(), "../..");
const FORCE_FRESH = process.argv.includes("--fresh");

interface CachedInputs {
  prdEntities: PrdEntities;
  repoIndex: RepoIndex;
}

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

// ── Stage 1: entity extraction ────────────────────────────────────────────────

async function extractPrdEntities(prdText: string, graphContext: string | null): Promise<PrdEntities> {
  const empty: PrdEntities = { entities: [], apiEndpoints: [], userFlows: [], techRequirements: [], integrations: [] };
  if (prdText.trim().length < 50) return empty;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: PRD_EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: buildPrdExtractionPrompt(prdText, graphContext) }],
    });
    const raw = res.content[0].type === "text" ? res.content[0].text : "{}";
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(cleaned) as PrdEntities;
  } catch (err) {
    console.warn("[Stage 1] Entity extraction failed, using empty entities:", err);
    return empty;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load PRD text (always fresh — it's what you're iterating on too)
  let prdText: string;
  try {
    prdText = await readFile(PRD_PATH, "utf-8");
    console.log(`[Setup]   PRD loaded: ${prdText.length} chars`);
  } catch {
    console.error(`[test-auditor] No PRD found. Create  apps/api/.dev/prd.md  with your PRD text.\n`);
    process.exit(1);
  }

  // Load graph context from .gitnexus (fast — no Claude call)
  const graphContext = await buildGraphContextFromExistingIndex(REPO_ROOT);
  console.log(graphContext
    ? `[Setup]   Graph context: ${graphContext.length} chars`
    : `[Setup]   No .gitnexus index found — run  npx gitnexus analyze  from repo root`
  );

  // Load or build cached inputs (entities + repo index)
  let cached: CachedInputs | null = null;
  if (!FORCE_FRESH) {
    try {
      cached = JSON.parse(await readFile(CACHE_PATH, "utf-8")) as CachedInputs;
      console.log(`[Setup]   Cached inputs loaded from ${CACHE_PATH}`);
      console.log(`          (run with --fresh to rebuild)\n`);
    } catch {
      console.log(`[Setup]   No cache found — will build it now (one-time)\n`);
    }
  } else {
    console.log(`[Setup]   --fresh flag: rebuilding cache\n`);
  }

  if (!cached) {
    // Stage 1: entity extraction
    console.log("[Stage 1] Extracting PRD entities via Claude...");
    const t1 = Date.now();
    const prdEntities = await extractPrdEntities(prdText, graphContext);
    console.log(`[Stage 1] Done in ${((Date.now() - t1) / 1000).toFixed(1)}s — entities=${prdEntities.entities.length} endpoints=${prdEntities.apiEndpoints.length}\n`);

    // Stage 2: repo index from local files
    console.log(`[Stage 2] Scanning local repo files...`);
    const t2 = Date.now();
    const repoFiles = await scanRepoFiles(REPO_ROOT);
    const repoCtx: RepoContext = {
      name: "local",
      files: repoFiles,
      meta: { totalFiles: repoFiles.length, totalChars: repoFiles.reduce((s, f) => s + f.content.length, 0) },
    };
    const repoIndex = buildRepoIndex(repoCtx);
    console.log(`[Stage 2] Done in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${repoFiles.length} files, ${repoIndex.routes.length} routes\n`);

    // Save cache
    cached = { prdEntities, repoIndex };
    await writeFile(CACHE_PATH, JSON.stringify(cached, null, 2));
    console.log(`[Setup]   Cache saved to ${CACHE_PATH}\n`);
  }

  // Stage 3: run the auditor (always fresh — this is what you're iterating on)
  console.log("[Stage 3] Running prd-auditor...");
  const t3 = Date.now();
  const report = await runPrdAudit(prdText, cached.prdEntities, cached.repoIndex, graphContext);
  const elapsed = ((Date.now() - t3) / 1000).toFixed(1);

  const reportPath = join(DEV_DIR, "last-report.md");
  await writeFile(reportPath, report);
  console.log(`\n[Stage 3] Report saved to ${reportPath}`);

  console.log("\n" + "=".repeat(60));
  console.log("FULL REPORT");
  console.log("=".repeat(60));
  console.log(report);
  console.log("=".repeat(60));

  const scorecard = scorecardFromReport(report);
  if (scorecard) {
    console.log(`\n✅ Scorecard: ${scorecard.overallScore}/10 — ${scorecard.overallSummary}`);
  } else {
    console.log("\n❌ No scorecard block found. Last 500 chars:\n" + report.slice(-500));
  }

  const issues = auditReportToIssues(report);
  console.log(`\n📋 ${issues.length} issues  (auditor: ${elapsed}s)\n`);
  issues.forEach((issue, idx) => {
    const diffs = issue.diffs?.length ? ` [${issue.diffs.length} diff(s)]` : "";
    console.log(`  ${String(idx + 1).padStart(2)}. [${issue.impact.toUpperCase().padEnd(8)}] ${issue.summary}${diffs}`);
  });
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
