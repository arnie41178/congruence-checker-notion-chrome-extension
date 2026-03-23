/**
 * Multi-Version Fingerprint Stability Analysis
 *
 * Clusters semantic fingerprints across N pipeline runs and reports how
 * consistently each issue appears. Each cluster anchors on the earliest
 * version's entry so matching doesn't drift as versions accumulate.
 *
 * Matching uses the same combined score as compare-fingerprints.ts:
 *   0.25 × fingerprint token Jaccard
 *   0.75 × summary text Jaccard  (slash-split, plural-normalized, stopwords)
 *   + 0.10 domain bonus, +0.15 subject bonus (≥0.70 Jaccard), +0.10 defect bonus
 *
 * Usage:
 *   cd apps/api && pnpm phase4:compare-multi                     # auto-detect latest 5 versions
 *   cd apps/api && pnpm phase4:compare-multi --latest 10         # auto-detect latest N
 *   cd apps/api && pnpm phase4:compare-multi --versions v020,v021,v022,v023,v024
 *   cd apps/api && pnpm phase4:compare-multi --threshold 0.55    # override similarity threshold
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";

const DEV_DIR = join(process.cwd(), ".dev");
const DEFAULT_THRESHOLD = 0.55;
const DEFAULT_LATEST = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

interface FingerprintEntry {
  id: string;
  summary: string;
  fingerprint: string;
}

interface FingerprintsFile {
  version: string;
  generatedAt: string;
  fingerprints: FingerprintEntry[];
}

/** A cluster groups the same real-world issue across multiple versions. */
interface Cluster {
  /** The anchor entry (from the earliest version) used for all matching. */
  anchor: FingerprintEntry;
  /** Map of version → the matched entry in that version. */
  versions: Map<string, FingerprintEntry>;
  /** Average pairwise combined score for all members vs the anchor. */
  avgScore: number;
}

// ── CLI arg helpers ───────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

// ── Similarity helpers (shared with compare-fingerprints.ts) ─────────────────

const SUMMARY_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to",
  "is", "are", "be", "by", "at", "as", "its", "from", "that", "this",
  "when", "how", "what", "which", "where", "via", "per",
]);

function tokenizeFp(fingerprint: string): Set<string> {
  return new Set(fingerprint.split(/[.\-]/));
}

function tokenizeSummary(summary: string): Set<string> {
  return new Set(
    summary.toLowerCase().split(/[\s/]+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
      .filter((w) => w.length > 1 && !SUMMARY_STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

function segmentBonuses(fp1: string, fp2: string): number {
  const s1 = fp1.split(".");
  const s2 = fp2.split(".");
  const domainBonus  = s1[0] === s2[0] ? 0.10 : 0;
  const defectBonus  = s1[s1.length - 1] === s2[s2.length - 1] ? 0.10 : 0;
  const subj1 = new Set((s1[1] ?? "").split("-").filter(Boolean));
  const subj2 = new Set((s2[1] ?? "").split("-").filter(Boolean));
  const subjectBonus = jaccard(subj1, subj2) >= 0.70 ? 0.15 : 0;
  return domainBonus + subjectBonus + defectBonus;
}

function combinedScore(e1: FingerprintEntry, e2: FingerprintEntry): number {
  const fpScore      = jaccard(tokenizeFp(e1.fingerprint), tokenizeFp(e2.fingerprint));
  const summaryScore = jaccard(tokenizeSummary(e1.summary), tokenizeSummary(e2.summary));
  return Math.min(1, 0.25 * fpScore + 0.75 * summaryScore + segmentBonuses(e1.fingerprint, e2.fingerprint));
}

// ── Version detection ─────────────────────────────────────────────────────────

async function detectVersions(latest: number): Promise<string[]> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^p4-v\d+$/.test(e))
    .map((e) => e.replace("p4-", ""))
    .sort();
  if (versions.length < 2) {
    console.error("[compare-multi] ERROR: Need at least 2 p4-vNNN folders. Run pnpm phase4:fingerprint on multiple versions first.");
    process.exit(1);
  }
  return versions.slice(-latest);
}

async function loadFingerprints(version: string): Promise<FingerprintsFile> {
  const path = join(DEV_DIR, `p4-${version}`, "fingerprints.json");
  try {
    return JSON.parse(await readFile(path, "utf-8")) as FingerprintsFile;
  } catch {
    console.error(`[compare-multi] ERROR: Could not read fingerprints for version ${version} at ${path}`);
    console.error(`[compare-multi]        Run: pnpm phase4:fingerprint --req-version ${version}`);
    process.exit(1);
  }
}

// ── Multi-version clustering ──────────────────────────────────────────────────

/**
 * Build issue clusters across all versions.
 *
 * Strategy: iterate versions in order. For each entry, find the best-scoring
 * existing cluster (matched against its anchor) above threshold. If none found,
 * start a new cluster. Each cluster accepts at most one entry per version
 * (greedy best-match within each version).
 */
function buildClusters(
  versionedEntries: { version: string; entry: FingerprintEntry }[],
  threshold: number,
): Cluster[] {
  const clusters: Cluster[] = [];

  // Process one version at a time, greedily assigning each entry to a cluster
  const versions = [...new Set(versionedEntries.map((e) => e.version))];

  for (const version of versions) {
    const entries = versionedEntries.filter((e) => e.version === version).map((e) => e.entry);

    // Score every entry against every cluster's anchor (that doesn't already have this version)
    const candidates: { entryIdx: number; clusterIdx: number; score: number }[] = [];
    for (let ei = 0; ei < entries.length; ei++) {
      for (let ci = 0; ci < clusters.length; ci++) {
        if (clusters[ci].versions.has(version)) continue; // version slot taken
        const score = combinedScore(entries[ei], clusters[ci].anchor);
        if (score >= threshold) candidates.push({ entryIdx: ei, clusterIdx: ci, score });
      }
    }

    // Greedy assignment — highest score first, each entry and cluster slot used once
    candidates.sort((a, b) => b.score - a.score);
    const usedEntries = new Set<number>();
    const usedClusters = new Set<number>();

    for (const { entryIdx, clusterIdx, score } of candidates) {
      if (usedEntries.has(entryIdx) || usedClusters.has(clusterIdx)) continue;
      usedEntries.add(entryIdx);
      usedClusters.add(clusterIdx);
      const cluster = clusters[clusterIdx];
      cluster.versions.set(version, entries[entryIdx]);
      // Running average of match scores vs anchor
      const n = cluster.versions.size;
      cluster.avgScore = cluster.avgScore + (score - cluster.avgScore) / n;
    }

    // Unmatched entries → new clusters
    for (let ei = 0; ei < entries.length; ei++) {
      if (usedEntries.has(ei)) continue;
      clusters.push({
        anchor: entries[ei],
        versions: new Map([[version, entries[ei]]]),
        avgScore: 1.0, // anchor matches itself perfectly
      });
    }
  }

  return clusters;
}

// ── Display helpers ───────────────────────────────────────────────────────────

function banner(label: string) {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"─".repeat(70)}`);
}

function pct(score: number) {
  return `${Math.round(score * 100)}%`;
}

function stabilityBar(present: number, total: number): string {
  const filled = Math.round((present / total) * 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + "]";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const thresholdArg = getArg("--threshold");
  const threshold = thresholdArg ? parseFloat(thresholdArg) : DEFAULT_THRESHOLD;

  const latestArg = getArg("--latest");
  const versionsArg = getArg("--versions");

  let versions: string[];
  if (versionsArg) {
    versions = versionsArg.split(",").map((v) => v.trim()).filter(Boolean);
    if (versions.length < 2) {
      console.error("[compare-multi] ERROR: --versions requires at least 2 comma-separated version labels.");
      process.exit(1);
    }
  } else {
    const n = latestArg ? parseInt(latestArg, 10) : DEFAULT_LATEST;
    versions = await detectVersions(isNaN(n) || n < 2 ? DEFAULT_LATEST : n);
    console.log(`[compare-multi] Auto-detected ${versions.length} versions: ${versions.join(" → ")}`);
  }

  console.log(`[compare-multi] Similarity threshold: ${pct(threshold)}`);

  // Load all fingerprint files
  const files = await Promise.all(versions.map((v) => loadFingerprints(v)));

  // Flatten to (version, entry) pairs, preserving version order
  const versionedEntries = files.flatMap((f) =>
    f.fingerprints.map((entry) => ({ version: f.version, entry })),
  );

  const totalEntries = files.reduce((n, f) => n + f.fingerprints.length, 0);
  const clusters = buildClusters(versionedEntries, threshold);

  // Sort clusters: most stable first, then by anchor fingerprint
  clusters.sort((a, b) => {
    const diff = b.versions.size - a.versions.size;
    return diff !== 0 ? diff : a.anchor.fingerprint.localeCompare(b.anchor.fingerprint);
  });

  const N = versions.length;
  const fullStable   = clusters.filter((c) => c.versions.size === N).length;
  const mostStable   = clusters.filter((c) => c.versions.size >= Math.ceil(N * 0.7) && c.versions.size < N).length;
  const unstable     = clusters.filter((c) => c.versions.size < Math.ceil(N * 0.5)).length;
  const partStable   = clusters.length - fullStable - mostStable - unstable;

  // Overall stability: weighted by presence across versions
  const totalPresence = clusters.reduce((sum, c) => sum + c.versions.size, 0);
  const maxPresence = clusters.length * N;
  const overallStability = maxPresence === 0 ? 100 : Math.round((totalPresence / maxPresence) * 100);

  // Consensus score: fraction of clusters present in every version
  const consensusScore = clusters.length === 0 ? 100 : Math.round((fullStable / clusters.length) * 100);

  banner(`Multi-Version Stability Report  (${N} versions)`);
  console.log(`  Versions:     ${versions.join("  →  ")}`);
  console.log(`  Threshold:    ${pct(threshold)}`);
  console.log(`  Total entries loaded:  ${totalEntries}  (across all versions)`);
  console.log(`  Unique issue clusters: ${clusters.length}`);
  console.log(``);
  console.log(`  Fully stable    (${N}/${N}):           ${fullStable}`);
  console.log(`  Mostly stable   (≥${Math.ceil(N * 0.7)}/${N}):          ${mostStable}`);
  console.log(`  Partial         (${Math.ceil(N * 0.5)}–${Math.ceil(N * 0.7) - 1}/${N}):        ${partStable}`);
  console.log(`  Unstable        (<${Math.ceil(N * 0.5)}/${N}):           ${unstable}`);
  console.log(``);
  console.log(`  Overall stability score:   ${overallStability}%  (avg presence across clusters)`);
  console.log(`  Consensus score:           ${consensusScore}%  (issues in every version)`);

  banner("Issue Clusters  (sorted by stability)");

  for (const cluster of clusters) {
    const present = cluster.versions.size;
    const bar = stabilityBar(present, N);
    const presentVersions = versions.filter((v) => cluster.versions.has(v));
    const missingVersions = versions.filter((v) => !cluster.versions.has(v));

    const presenceLabel = present === N ? "ALL" : `${present}/${N}`;
    console.log(`\n  ${bar}  ${presenceLabel}  ${cluster.anchor.fingerprint}`);
    console.log(`         ${cluster.anchor.summary}`);

    if (present < N) {
      console.log(`         Present in:  ${presentVersions.join("  ")}`);
      console.log(`         Missing in:  ${missingVersions.join("  ")}`);
    }

    // Show fingerprint drift if the cluster has variant fingerprints
    const uniqueFps = new Set(
      [...cluster.versions.values()].map((e) => e.fingerprint),
    );
    if (uniqueFps.size > 1) {
      console.log(`         Fingerprint variants across versions:`);
      for (const [ver, entry] of cluster.versions) {
        if (entry.fingerprint !== cluster.anchor.fingerprint) {
          console.log(`           ${ver}: ${entry.fingerprint}`);
        }
      }
    }
  }

  console.log(`\n${"─".repeat(70)}\n`);
}

main().catch((err) => {
  console.error("[compare-multi] Fatal:", err);
  process.exit(1);
});
