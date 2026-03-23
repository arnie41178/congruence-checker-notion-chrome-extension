/**
 * Compare Fingerprints — Cross-Run Stability Analysis
 *
 * Compares semantic fingerprints from two pipeline versions to measure
 * how stable the analysis results are across runs.
 *
 * Matching uses a combined score:
 *   0.25 × fingerprint token Jaccard  (split on "." and "-")
 *   0.75 × summary text Jaccard       (lowercased, slash-split, plural-normalized, stopwords removed)
 *   + 0.10 domain bonus               (first segment exact match)
 *   + 0.15 subject bonus              (second segment token Jaccard ≥ 0.70)
 *   + 0.10 defect bonus               (last segment exact match)
 *
 * Usage:
 *   cd apps/api && pnpm phase4:compare --v1 v026 --v2 v028
 *   cd apps/api && pnpm phase4:compare --v1 v026 --v2 v028 --threshold 0.55
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";

const DEV_DIR = join(process.cwd(), ".dev");
const DEFAULT_THRESHOLD = 0.55;

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

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const SUMMARY_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to",
  "is", "are", "be", "by", "at", "as", "its", "from", "that", "this",
  "when", "how", "what", "which", "where", "via", "per",
]);

// ── Similarity helpers ────────────────────────────────────────────────────────

function tokenizeFp(fingerprint: string): Set<string> {
  return new Set(fingerprint.split(/[.\-]/));
}

/** Split on whitespace and slashes, strip non-alpha, simple plural normalization */
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

/** Independent segment bonuses: domain +0.10, subject Jaccard ≥ 0.70 → +0.15, defect +0.10 */
function segmentBonuses(fp1: string, fp2: string): { domain: number; subject: number; defect: number } {
  const s1 = fp1.split(".");
  const s2 = fp2.split(".");
  const domainBonus  = s1[0] === s2[0] ? 0.10 : 0;
  const defectBonus  = s1[s1.length - 1] === s2[s2.length - 1] ? 0.10 : 0;
  // subject = second segment; tokenize on "-" for Jaccard
  const subj1 = new Set((s1[1] ?? "").split("-").filter(Boolean));
  const subj2 = new Set((s2[1] ?? "").split("-").filter(Boolean));
  const subjectBonus = jaccard(subj1, subj2) >= 0.70 ? 0.15 : 0;
  return { domain: domainBonus, subject: subjectBonus, defect: defectBonus };
}

function combinedScore(e1: FingerprintEntry, e2: FingerprintEntry): number {
  const fpScore      = jaccard(tokenizeFp(e1.fingerprint), tokenizeFp(e2.fingerprint));
  const summaryScore = jaccard(tokenizeSummary(e1.summary), tokenizeSummary(e2.summary));
  const { domain, subject, defect } = segmentBonuses(e1.fingerprint, e2.fingerprint);
  return Math.min(1, 0.25 * fpScore + 0.75 * summaryScore + domain + subject + defect);
}

// ── Greedy best-match: each v1 entry matched to at most one v2 entry ─────────

interface Match {
  v1: FingerprintEntry;
  v2: FingerprintEntry;
  score: number;
  exact: boolean;
}

function findMatches(
  list1: FingerprintEntry[],
  list2: FingerprintEntry[],
  threshold: number,
): { matches: Match[]; unmatched1: FingerprintEntry[]; unmatched2: FingerprintEntry[] } {
  // Score every v1×v2 pair
  const candidates: { i: number; j: number; score: number }[] = [];
  for (let i = 0; i < list1.length; i++) {
    for (let j = 0; j < list2.length; j++) {
      const score = combinedScore(list1[i], list2[j]);
      if (score >= threshold) candidates.push({ i, j, score });
    }
  }

  // Greedy assignment — highest scores first, each index used at most once
  candidates.sort((a, b) => b.score - a.score);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  const matches: Match[] = [];

  for (const { i, j, score } of candidates) {
    if (usedI.has(i) || usedJ.has(j)) continue;
    usedI.add(i);
    usedJ.add(j);
    matches.push({
      v1: list1[i],
      v2: list2[j],
      score,
      exact: list1[i].fingerprint === list2[j].fingerprint,
    });
  }

  const unmatched1 = list1.filter((_, i) => !usedI.has(i));
  const unmatched2 = list2.filter((_, j) => !usedJ.has(j));

  return { matches, unmatched1, unmatched2 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function detectLatestTwoVersions(): Promise<[string, string]> {
  const entries = await readdir(DEV_DIR).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^p4-v\d+$/.test(e))
    .map((e) => e.replace("p4-", ""))
    .sort();
  if (versions.length < 2) {
    console.error("[compare] ERROR: Need at least 2 p4-vNNN folders. Run pnpm phase4:fingerprint on two versions first.");
    process.exit(1);
  }
  return [versions[versions.length - 2], versions[versions.length - 1]];
}

async function loadFingerprints(version: string): Promise<FingerprintsFile> {
  const path = join(DEV_DIR, `p4-${version}`, "fingerprints.json");
  try {
    return JSON.parse(await readFile(path, "utf-8")) as FingerprintsFile;
  } catch {
    console.error(`[compare] ERROR: Could not read fingerprints for version ${version} at ${path}`);
    console.error(`[compare]        Run: pnpm phase4:fingerprint --req-version ${version}`);
    process.exit(1);
  }
}

function banner(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"─".repeat(60)}`);
}

function pct(score: number) {
  return `${Math.round(score * 100)}%`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let v1 = getArg("--v1");
  let v2 = getArg("--v2");
  const thresholdArg = getArg("--threshold");
  const threshold = thresholdArg ? parseFloat(thresholdArg) : DEFAULT_THRESHOLD;

  if (!v1 || !v2) {
    [v1, v2] = await detectLatestTwoVersions();
    console.log(`[compare] Auto-detected versions: ${v1} → ${v2}`);
  }

  const f1 = await loadFingerprints(v1);
  const f2 = await loadFingerprints(v2);

  console.log(`[compare] Similarity threshold: ${pct(threshold)} (override with --threshold 0.55)`);

  const { matches, unmatched1: removed, unmatched2: added } =
    findMatches(f1.fingerprints, f2.fingerprints, threshold);

  const exactMatches = matches.filter((m) => m.exact);
  const fuzzyMatches = matches.filter((m) => !m.exact);
  const total = f1.fingerprints.length;
  const stabilityPct = total === 0 ? 100 : Math.round((matches.length / total) * 100);

  banner(`Stability Report: ${v1} → ${v2}`);
  console.log(`  ${v1} requirements: ${f1.fingerprints.length}`);
  console.log(`  ${v2} requirements: ${f2.fingerprints.length}`);
  console.log(`  Exact match:  ${exactMatches.length}  (identical fingerprint)`);
  console.log(`  Fuzzy match:  ${fuzzyMatches.length}  (similar fingerprint, ≥${pct(threshold)} token overlap)`);
  console.log(`  Added:        ${added.length}  (new issues in ${v2})`);
  console.log(`  Removed:      ${removed.length}  (issues from ${v1} not found in ${v2})`);
  console.log(`  Stability score: ${stabilityPct}%`);

  if (exactMatches.length > 0) {
    banner("Exact Matches");
    for (const { v1: e1, v2: e2 } of exactMatches) {
      const idLabel = e1.id === e2.id ? e1.id : `${e1.id}→${e2.id}`;
      console.log(`  ${idLabel.padEnd(10)}  ${e1.fingerprint}`);
    }
  }

  if (fuzzyMatches.length > 0) {
    banner("Fuzzy Matches (same issue, slight fingerprint drift)");
    for (const { v1: e1, v2: e2, score } of fuzzyMatches) {
      const idLabel = e1.id === e2.id ? e1.id : `${e1.id}→${e2.id}`;
      const fpScore      = jaccard(tokenizeFp(e1.fingerprint), tokenizeFp(e2.fingerprint));
      const summaryScore = jaccard(tokenizeSummary(e1.summary), tokenizeSummary(e2.summary));
      const { domain, subject, defect } = segmentBonuses(e1.fingerprint, e2.fingerprint);
      console.log(`  ${idLabel.padEnd(10)}  combined=${pct(score)}  (fp=${pct(fpScore)} summary=${pct(summaryScore)} dom=${pct(domain)} subj=${pct(subject)} defect=${pct(defect)})`);
      console.log(`    ${v1}: ${e1.fingerprint}`);
      console.log(`    ${v2}: ${e2.fingerprint}`);
    }
  }

  if (added.length > 0) {
    banner(`Added in ${v2} (no match in ${v1})`);
    for (const a of added) {
      console.log(`  ${a.id.padEnd(6)}  ${a.fingerprint}`);
      console.log(`         ${a.summary}`);
    }
  }

  if (removed.length > 0) {
    banner(`Removed from ${v1} (no match in ${v2})`);
    for (const r of removed) {
      console.log(`  ${r.id.padEnd(6)}  ${r.fingerprint}`);
      console.log(`         ${r.summary}`);
    }
  }

  console.log(`\n${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("[compare] Fatal:", err);
  process.exit(1);
});
