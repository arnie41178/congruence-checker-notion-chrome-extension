/**
 * Phase 1 — Consensus Merge
 *
 * Reads all p1-requirements-vNNN-runM.json files for a given version,
 * matches requirements across runs by title similarity, and outputs only
 * requirements that appear in at least --min-runs M runs (default = all runs).
 *
 * Matching: Jaccard similarity on normalised title word sets (threshold ≥ 0.4).
 * For matched groups, the requirement with the longest description is kept.
 *
 * Usage:
 *   cd apps/api && pnpm phase1:consensus
 *   cd apps/api && pnpm phase1:consensus --req-version v003
 *   cd apps/api && pnpm phase1:consensus --req-version v003 --min-runs 2
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import type { Requirement, PrdRequirements } from "@alucify/shared-types";

const DEV_DIR = join(process.cwd(), ".dev");

const REQ_VERSION = (() => {
  const idx = process.argv.indexOf("--req-version");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const MIN_RUNS_ARG = (() => {
  const idx = process.argv.indexOf("--min-runs");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
})();

// ── Version detection ─────────────────────────────────────────────────────────

async function detectLatestRunVersion(): Promise<string> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  // Look for p1-vNNN folders that contain at least one run file
  const versions: string[] = [];
  for (const entry of entries) {
    const m = entry.match(/^p1-(v\d+)$/);
    if (!m) continue;
    const folderEntries = await readdir(join(DEV_DIR, entry)).catch(() => [] as string[]);
    if (folderEntries.some((f) => f.match(/^requirements-run\d+\.json$/))) {
      versions.push(m[1]);
    }
  }
  versions.sort();
  if (versions.length === 0) {
    console.error("[Phase 1 Consensus] ERROR: No run files found. Run phase1:prep --runs N first.");
    process.exit(1);
  }
  return versions[versions.length - 1];
}

// ── Title normalisation + Jaccard similarity ──────────────────────────────────

const STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "with", "for", "to", "by", "in", "on", "via", "using", "from"]);

function normalise(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Consensus matching ────────────────────────────────────────────────────────

interface RunRequirement extends Requirement {
  _run: number;
  _words: Set<string>;
}

function findBestMatch(target: RunRequirement, pool: RunRequirement[], threshold = 0.4): RunRequirement | null {
  let best: RunRequirement | null = null;
  let bestScore = threshold;
  for (const candidate of pool) {
    const score = jaccard(target._words, candidate._words);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function buildConsensus(allRuns: RunRequirement[][], minRuns: number): Requirement[] {
  const numRuns = allRuns.length;
  const used = new Set<RunRequirement>();
  const groups: RunRequirement[][] = [];

  // Anchor on run 1, find matches in other runs
  for (const anchor of allRuns[0]) {
    if (used.has(anchor)) continue;
    const group: RunRequirement[] = [anchor];
    used.add(anchor);

    for (let r = 1; r < numRuns; r++) {
      const pool = allRuns[r].filter((req) => !used.has(req));
      const match = findBestMatch(anchor, pool);
      if (match) {
        group.push(match);
        used.add(match);
      }
    }
    groups.push(group);
  }

  // Also check requirements in other runs not matched to any run-1 anchor
  for (let r = 1; r < numRuns; r++) {
    for (const req of allRuns[r]) {
      if (used.has(req)) continue;
      // Try matching against remaining runs
      const group: RunRequirement[] = [req];
      used.add(req);
      for (let r2 = 0; r2 < numRuns; r2++) {
        if (r2 === r) continue;
        const pool = allRuns[r2].filter((candidate) => !used.has(candidate));
        const match = findBestMatch(req, pool);
        if (match) {
          group.push(match);
          used.add(match);
        }
      }
      groups.push(group);
    }
  }

  // Keep groups that appear in enough runs
  const kept = groups.filter((g) => g.length >= minRuns);

  // For each kept group, pick the requirement with the longest description
  // Re-assign sequential IDs
  return kept
    .sort((a, b) => {
      // Sort by average run index to preserve original order roughly
      const avgA = a.reduce((s, r) => s + r._run, 0) / a.length;
      const avgB = b.reduce((s, r) => s + r._run, 0) / b.length;
      return avgA - avgB;
    })
    .map((group, i) => {
      const best = group.reduce((a, b) =>
        b.description.length > a.description.length ? b : a
      );
      const id = `R${String(i + 1).padStart(3, "0")}`;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _run, _words, ...clean } = best;
      return { ...clean, id };
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const version = REQ_VERSION ?? (await detectLatestRunVersion());

  // Discover run files inside the version folder
  const versionDir = join(DEV_DIR, `p1-${version}`);
  const entries = await readdir(versionDir).catch(() => [] as string[]);
  const runFiles = entries
    .filter((f) => f.match(/^requirements-run(\d+)\.json$/))
    .sort();

  if (runFiles.length < 2) {
    console.error(`[Phase 1 Consensus] ERROR: Need at least 2 run files in .dev/p1-${version}/, found ${runFiles.length}.`);
    process.exit(1);
  }

  // default = majority (strictly more than 50% of runs)
  const minRuns = MIN_RUNS_ARG ?? (Math.floor(runFiles.length / 2) + 1);
  console.log(`[Phase 1 Consensus] Version: ${version}`);
  console.log(`[Phase 1 Consensus] Run files: ${runFiles.join(", ")}`);
  console.log(`[Phase 1 Consensus] Minimum runs for inclusion: ${minRuns} of ${runFiles.length} (${MIN_RUNS_ARG ? "explicit" : ">50% majority"})`);

  // Load all run files from version folder
  const allRuns: RunRequirement[][] = [];
  for (let i = 0; i < runFiles.length; i++) {
    const raw = JSON.parse(await readFile(join(versionDir, runFiles[i]), "utf-8")) as PrdRequirements;
    const reqs: RunRequirement[] = raw.requirements.map((r) => ({
      ...r,
      _run: i,
      _words: normalise(r.title),
    }));
    allRuns.push(reqs);
    console.log(`[Phase 1 Consensus]   ${runFiles[i]}: ${reqs.length} requirements`);
  }

  // Build consensus
  const consensus = buildConsensus(allRuns, minRuns);

  // Write output
  const result: PrdRequirements = {
    version: parseInt(version.replace("v", ""), 10),
    extractedAt: new Date().toISOString(),
    requirements: consensus,
  };

  // Write consensus into version folder + update top-level latest pointer
  const versionedFile = `requirements.json`;
  const latestFile    = `p1-requirements-latest.json`;
  await writeFile(join(versionDir, versionedFile), JSON.stringify(result, null, 2));
  await writeFile(join(DEV_DIR, latestFile),        JSON.stringify(result, null, 2));

  // Summary
  const totalPerRun = allRuns.map((r) => r.length);
  console.log(`\n[Phase 1 Consensus] ✓ Done`);
  console.log(`[Phase 1 Consensus]   Requirements per run: ${totalPerRun.join(", ")}`);
  console.log(`[Phase 1 Consensus]   Consensus requirements kept: ${consensus.length}`);
  console.log(`[Phase 1 Consensus]   Dropped (appeared in < ${minRuns} runs): ${Math.max(...totalPerRun) - consensus.length}`);
  console.log(`[Phase 1 Consensus]   Output: apps/api/.dev/p1-${version}/${versionedFile}`);

  // Print consensus requirements list
  const PRIORITY_LABEL: Record<string, string> = {
    "must-have": "MUST", "should-have": "SHOULD", "nice-to-have": "NICE",
  };
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Consensus Requirements (${consensus.length})`);
  console.log(`${"─".repeat(60)}`);
  for (const req of consensus) {
    const pri = PRIORITY_LABEL[req.priority] ?? req.priority;
    const type = req.type.padEnd(15);
    console.log(`  ${req.id}  [${pri}] [${type}]  ${req.title}`);
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`\n[Phase 1 Consensus] Next step: pnpm phase2:prep`);
}

main().catch((err) => {
  console.error("[Phase 1 Consensus] Fatal error:", err);
  process.exit(1);
});
