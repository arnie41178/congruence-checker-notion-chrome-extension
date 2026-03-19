/**
 * Standalone test for buildGraphContextFromRepo.
 * Reads the actual repo source files from the project root and runs the full
 * gitnexus pipeline (git init → gitnexus analyze → ladybug query → summary).
 *
 * Run with:
 *   cd apps/api
 *   USE_GRAPH_CONTEXT=true pnpm tsx src/scripts/test-graph-context.ts
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { buildGraphContextFromRepo } from "../services/graph-context.js";
import type { RepoFile } from "@alucify/shared-types";

// ── Config ────────────────────────────────────────────────────────────────────

// Project root — two levels up from apps/api
const REPO_ROOT = join(process.cwd(), "../..");

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".gitnexus",
  ".next", "coverage", "__pycache__", ".venv", "venv",
]);

const INCLUDED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".json", ".yaml", ".yml", ".toml", ".md",
]);

const MAX_FILES = 200;
const MAX_CHARS = 300_000;

// ── File walker ───────────────────────────────────────────────────────────────

async function walkDir(dir: string, files: RepoFile[], root: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walkDir(join(dir, entry.name), files, root);
    } else {
      const ext = "." + entry.name.split(".").pop()!;
      if (!INCLUDED_EXTENSIONS.has(ext)) continue;
      if (files.length >= MAX_FILES) continue;
      const filePath = join(dir, entry.name);
      try {
        const content = await readFile(filePath, "utf-8");
        const totalChars = files.reduce((s, f) => s + f.content.length, 0);
        if (totalChars + content.length > MAX_CHARS) continue;
        files.push({ path: relative(root, filePath), content });
      } catch {
        // skip unreadable files
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading repo from: ${REPO_ROOT}`);

  const files: RepoFile[] = [];
  await walkDir(REPO_ROOT, files, REPO_ROOT);

  const totalChars = files.reduce((s, f) => s + f.content.length, 0);
  console.log(`Collected ${files.length} files, ${totalChars} chars`);

  const repo = {
    name: "test-repo",
    files,
    meta: { totalFiles: files.length, totalChars },
  };

  console.log("\nRunning buildGraphContextFromRepo...\n");
  const context = await buildGraphContextFromRepo(repo);

  if (!context) {
    console.error("❌ Graph context returned null — check logs above for errors.");
    process.exit(1);
  }

  console.log("\n✅ Graph context built successfully!\n");
  console.log(`Length: ${context.length} chars\n`);
  console.log("── Preview (first 2000 chars) ──────────────────────────────");
  console.log(context.slice(0, 2000));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
