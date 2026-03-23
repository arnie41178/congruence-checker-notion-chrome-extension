/**
 * Multi-Version Fingerprint Stability Analysis
 *
 * Clusters semantic fingerprints across N pipeline runs and reports how
 * consistently each issue appears. Each cluster anchors on the earliest
 * version's entry so matching doesn't drift as versions accumulate.
 *
 * Two matching modes (select with --llm flag):
 *
 *   Token mode (default):
 *     0.25 × fingerprint token Jaccard
 *     0.75 × summary text Jaccard  (slash-split, plural-normalized, stopwords)
 *     + 0.10 domain bonus, +0.15 subject bonus (≥0.70 Jaccard), +0.10 defect bonus
 *
 *   LLM mode (--llm):
 *     One Claude Haiku call per version — all cluster anchors + all version
 *     entries sent in a single batch. LLM returns per-candidate anchor
 *     assignment with confidence score. Same greedy assignment logic applied.
 *
 * Usage:
 *   cd apps/api && pnpm phase4:compare-multi                     # token mode, latest 5
 *   cd apps/api && pnpm phase4:compare-multi --latest 10         # auto-detect latest N
 *   cd apps/api && pnpm phase4:compare-multi --versions v020,v021,v022,v023,v024
 *   cd apps/api && pnpm phase4:compare-multi --threshold 0.55    # override threshold
 *   cd apps/api && pnpm phase4:compare-multi --llm               # LLM-based matching
 *   cd apps/api && pnpm phase4:compare-multi --llm --latest 10   # LLM, latest 10
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { spawnSync } from "child_process";

const DEV_DIR = join(process.cwd(), ".dev");
const LLM_TMP_DIR = join(DEV_DIR, "llm-match-tmp");
const DEFAULT_THRESHOLD = 0.55;
const DEFAULT_LATEST = 5;
const LLM_MODEL = "claude-haiku-4-5-20251001";

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
  /** Sum of match scores for all non-anchor members (token similarity or LLM confidence). */
  scoreSum: number;
  /** Number of non-anchor matches. */
  scoreCount: number;
}

// ── CLI arg helpers ───────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const USE_LLM = process.argv.includes("--llm");

// ── Token-based similarity helpers ───────────────────────────────────────────

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

// ── LLM matching ──────────────────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are a semantic deduplication engine for PRD audit issues.

You will be given:
  - anchors:    a list of existing issue clusters, each identified by a cluster_id, fingerprint, and summary
  - candidates: a list of new issue entries from a single pipeline run

Your task: for each CANDIDATE, decide if it represents the same underlying PRD gap
as any ANCHOR — even if the wording, domain label, subject, or defect type differs.

---

## What "same issue" means

Two entries represent the same issue if they describe the same gap or ambiguity in
the PRD, regardless of:
  - Surface wording differences in the summary
  - Minor domain relabelling  (e.g. "testing" vs "test", "quota" vs "rotation")
  - Subject phrasing variation (e.g. "state-file" vs "state-tracking")
  - Aspect phrasing variation  (e.g. "path" vs "file-path")
  - Defect type drift when the root problem is the same
    (e.g. "ambiguous" vs "missing" when the PRD is simply underspecified)

Two entries are DIFFERENT issues if they describe meaningfully distinct gaps —
different features, different failure modes, or different actors — even if some
tokens overlap.

---

## Few-shot examples  (confirmed MATCH pairs)

Pair A:
  Anchor:    quota.state-file.path.conflict
             "The PRD conflicts on where the quota state file path is stored"
  Candidate: quota.state-tracking.file-path.conflict
             "Conflicting specifications for the quota state tracking file path"
  → MATCH — same conflict about quota state file location; subject tokens differ
    ("state-file" vs "state-tracking") but domain, defect, and summary intent align.

Pair B:
  Anchor:    testing.tests.scope.missing
             "The scope of tests required for account quota changes is not defined"
  Candidate: test.account-quota.definition.missing
             "No definition provided for what tests are needed around account quota"
  → MATCH — both flag the missing test definition for account quota; domain differs
    ("testing" vs "test") and subject differs but the meaning is identical.

Pair C:
  Anchor:    quota.quota-rotation.specification.ambiguous
             "The specification for quota rotation behaviour is ambiguous"
  Candidate: quota.rotation.atomicity.missing
             "The atomicity requirements for quota rotation are not specified"
  → MATCH — both describe an underspecified quota rotation behaviour; defect type
    differs ("ambiguous" vs "missing") but the root gap is the same.

Pair D:
  Anchor:    account.activation-levels.determination.missing
             "How activation levels are determined for accounts is not specified"
  Candidate: quota.activation-levels.priority.conflict
             "Priority ordering for activation levels across quota tiers is conflicting"
  → MATCH — both flag an issue with activation-level rules; domain and defect differ
    but the subject "activation-levels" is identical and summaries share the same area.

Pair E:
  Anchor:    account.registry.specification.ambiguous
             "The account registry specification is ambiguous"
  Candidate: account.cli-command.naming.conflict
             "CLI command naming for account registry operations conflicts with existing conventions"
  → MATCH — both describe an underspecified/conflicting account registry definition;
    subject tokens differ but domain and summary intent align.

Pair F:
  Anchor:    quota.automatic-rotation.behavior.missing
             "Controller integration for automated quota monitoring"
  Candidate: rotation.automatic-execution.behavior.ambiguous
             "Controller integration for automated rotation"
  → MATCH — both describe a missing/underspecified controller integration for
    automated rotation behaviour; domain, subject, and defect all differ, but
    the summary meaning is identical.

---

## Output format

Return ONLY this JSON object — no preamble, no explanation outside the JSON:

{
  "assignments": [
    {
      "candidate_id":      "<the candidate's id field>",
      "candidate_version": "<the candidate's version field>",
      "anchor_id":         "<the matching cluster_id, or null if no match>",
      "confidence":        0.0–1.0,
      "reasoning":         "<one sentence>"
    }
  ]
}

Rules:
  - Every candidate must appear exactly once in the assignments array
  - Set anchor_id to null if no anchor matches with confidence ≥ 0.6
  - A candidate may only match ONE anchor (pick the best one)
  - Do not match entries that share only a single token coincidentally
  - Do not match entries that describe genuinely different PRD gaps`;

interface LLMAssignment {
  candidate_id: string;
  candidate_version: string;
  anchor_id: string | null;
  confidence: number;
  reasoning: string;
}

async function writeLLMFiles(userMessage: string): Promise<{ sysPath: string; userPath: string }> {
  await mkdir(LLM_TMP_DIR, { recursive: true });
  const sysPath  = join(LLM_TMP_DIR, "system-prompt.md");
  const userPath = join(LLM_TMP_DIR, "user-message.md");
  await writeFile(sysPath, LLM_SYSTEM_PROMPT, "utf-8");
  await writeFile(userPath, userMessage, "utf-8");
  return { sysPath, userPath };
}

function callLLMMatch(
  anchors:    Array<{ cluster_id: string; fingerprint: string; summary: string }>,
  candidates: Array<{ id: string; version: string; fingerprint: string; summary: string }>,
  sysRelPath:  string,
  userRelPath: string,
): LLMAssignment[] {
  const userMessage = [
    "Below are the ANCHORS and CANDIDATES.",
    "For each candidate, identify which anchor (if any) represents the same PRD issue.",
    "",
    "```json",
    JSON.stringify({ anchors, candidates }, null, 2),
    "```",
  ].join("\n");

  // Overwrite user-message file synchronously is not possible — caller must have written it already.
  // We pass relative paths so Claude can read them from the repo root.
  const prompt =
    `Read the system prompt at ${sysRelPath} and apply it as your instructions. ` +
    `Then process the batch input at ${userRelPath}. ` +
    `Return ONLY the JSON object with the assignments array — no preamble, no explanation.`;

  const result = spawnSync(
    "claude",
    ["--print", "--dangerously-skip-permissions", "--model", LLM_MODEL, prompt],
    { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] },
  );

  if (result.status !== 0) {
    console.warn(`[compare-multi] WARNING: LLM call failed (exit ${result.status}) — falling back to token similarity for this version`);
    return [];
  }

  const raw = result.stdout ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[compare-multi] WARNING: Could not parse LLM JSON response — falling back to token similarity`);
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.assignments ?? []) as LLMAssignment[];
  } catch {
    console.warn(`[compare-multi] WARNING: JSON parse error in LLM response — falling back to token similarity`);
    return [];
  }
  void userMessage; // built above for context; actual content written by caller
}

// ── Greedy assignment (shared by both modes) ──────────────────────────────────

function applyGreedyAssignment(
  entries: FingerprintEntry[],
  clusters: Cluster[],
  version: string,
  scoredCandidates: { entryIdx: number; clusterIdx: number; score: number }[],
) {
  scoredCandidates.sort((a, b) => b.score - a.score);
  const usedEntries  = new Set<number>();
  const usedClusters = new Set<number>();

  for (const { entryIdx, clusterIdx, score } of scoredCandidates) {
    if (usedEntries.has(entryIdx) || usedClusters.has(clusterIdx)) continue;
    usedEntries.add(entryIdx);
    usedClusters.add(clusterIdx);
    clusters[clusterIdx].versions.set(version, entries[entryIdx]);
    clusters[clusterIdx].scoreSum   += score;
    clusters[clusterIdx].scoreCount += 1;
  }

  // Unmatched entries → new clusters
  for (let ei = 0; ei < entries.length; ei++) {
    if (usedEntries.has(ei)) continue;
    clusters.push({
      anchor: entries[ei],
      versions: new Map([[version, entries[ei]]]),
      scoreSum: 0,
      scoreCount: 0,
    });
  }
}

// ── Token-based clustering ────────────────────────────────────────────────────

function buildClusters(
  versionedEntries: { version: string; entry: FingerprintEntry }[],
  threshold: number,
): Cluster[] {
  const clusters: Cluster[] = [];
  const versions = [...new Set(versionedEntries.map((e) => e.version))];

  for (const version of versions) {
    const entries = versionedEntries.filter((e) => e.version === version).map((e) => e.entry);

    const scored: { entryIdx: number; clusterIdx: number; score: number }[] = [];
    for (let ei = 0; ei < entries.length; ei++) {
      for (let ci = 0; ci < clusters.length; ci++) {
        if (clusters[ci].versions.has(version)) continue;
        const score = combinedScore(entries[ei], clusters[ci].anchor);
        if (score >= threshold) scored.push({ entryIdx: ei, clusterIdx: ci, score });
      }
    }

    applyGreedyAssignment(entries, clusters, version, scored);
  }

  return clusters;
}

// ── LLM-based clustering ──────────────────────────────────────────────────────

async function buildClustersLLM(
  versionedEntries: { version: string; entry: FingerprintEntry }[],
  threshold: number,
): Promise<Cluster[]> {
  const clusters: Cluster[] = [];
  const versions = [...new Set(versionedEntries.map((e) => e.version))];

  // Write system prompt once
  const { sysPath, userPath } = await writeLLMFiles("");
  const sysRelPath  = `apps/api/.dev/llm-match-tmp/system-prompt.md`;
  const userRelPath = `apps/api/.dev/llm-match-tmp/user-message.md`;

  for (const version of versions) {
    const entries = versionedEntries.filter((e) => e.version === version).map((e) => e.entry);

    // First version — all entries seed new clusters
    if (clusters.length === 0) {
      for (const entry of entries) {
        clusters.push({ anchor: entry, versions: new Map([[version, entry]]), scoreSum: 0, scoreCount: 0 });
      }
      continue;
    }

    // Build anchor list: clusters that don't already have this version
    const availableClusters = clusters
      .map((c, idx) => ({ cluster_id: String(idx), fingerprint: c.anchor.fingerprint, summary: c.anchor.summary }))
      .filter((_, idx) => !clusters[idx].versions.has(version));

    if (availableClusters.length === 0) {
      for (const entry of entries) {
        clusters.push({ anchor: entry, versions: new Map([[version, entry]]), scoreSum: 0, scoreCount: 0 });
      }
      continue;
    }

    const candidateInputs = entries.map((e) => ({
      id: e.id,
      version,
      fingerprint: e.fingerprint,
      summary: e.summary,
    }));

    // Write user message for this version
    const userMessage = [
      "Below are the ANCHORS and CANDIDATES.",
      "For each candidate, identify which anchor (if any) represents the same PRD issue.",
      "",
      "```json",
      JSON.stringify({ anchors: availableClusters, candidates: candidateInputs }, null, 2),
      "```",
    ].join("\n");
    await writeFile(userPath, userMessage, "utf-8");

    console.log(`[compare-multi] LLM matching ${entries.length} entries against ${availableClusters.length} clusters for ${version}...`);
    const assignments = callLLMMatch(availableClusters, candidateInputs, sysRelPath, userRelPath);

    // If LLM call failed entirely, fall back to token similarity for this version
    if (assignments.length === 0) {
      const scored: { entryIdx: number; clusterIdx: number; score: number }[] = [];
      for (let ei = 0; ei < entries.length; ei++) {
        for (let ci = 0; ci < clusters.length; ci++) {
          if (clusters[ci].versions.has(version)) continue;
          const score = combinedScore(entries[ei], clusters[ci].anchor);
          if (score >= threshold) scored.push({ entryIdx: ei, clusterIdx: ci, score });
        }
      }
      applyGreedyAssignment(entries, clusters, version, scored);
      continue;
    }

    // Convert LLM assignments to scored candidates
    const scored: { entryIdx: number; clusterIdx: number; score: number }[] = [];
    for (const assignment of assignments) {
      if (!assignment.anchor_id || assignment.confidence < threshold) continue;
      const entryIdx   = entries.findIndex((e) => e.id === assignment.candidate_id);
      const clusterIdx = parseInt(assignment.anchor_id, 10);
      if (entryIdx === -1 || isNaN(clusterIdx) || clusterIdx >= clusters.length) continue;
      scored.push({ entryIdx, clusterIdx, score: assignment.confidence });
    }

    applyGreedyAssignment(entries, clusters, version, scored);
  }

  void sysPath; // written at setup; not used directly after that
  return clusters;
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

  const latestArg   = getArg("--latest");
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

  const matchMode = USE_LLM ? "LLM (Claude Haiku)" : "token similarity";
  console.log(`[compare-multi] Match mode:  ${matchMode}`);
  console.log(`[compare-multi] Threshold:   ${pct(threshold)}`);

  const files = await Promise.all(versions.map((v) => loadFingerprints(v)));

  const versionedEntries = files.flatMap((f) =>
    f.fingerprints.map((entry) => ({ version: f.version, entry })),
  );

  const totalEntries = files.reduce((n, f) => n + f.fingerprints.length, 0);
  const clusters = USE_LLM
    ? await buildClustersLLM(versionedEntries, threshold)
    : buildClusters(versionedEntries, threshold);

  // Sort: most stable first, then alphabetically by fingerprint
  clusters.sort((a, b) => {
    const diff = b.versions.size - a.versions.size;
    return diff !== 0 ? diff : a.anchor.fingerprint.localeCompare(b.anchor.fingerprint);
  });

  const N = versions.length;
  const fullStable = clusters.filter((c) => c.versions.size === N).length;
  const mostStable = clusters.filter((c) => c.versions.size >= Math.ceil(N * 0.7) && c.versions.size < N).length;
  const unstable   = clusters.filter((c) => c.versions.size < Math.ceil(N * 0.5)).length;
  const partStable = clusters.length - fullStable - mostStable - unstable;

  const totalPresence  = clusters.reduce((sum, c) => sum + c.versions.size, 0);
  const maxPresence    = clusters.length * N;
  const overallStability = maxPresence === 0 ? 100 : Math.round((totalPresence / maxPresence) * 100);
  const consensusScore   = clusters.length === 0 ? 100 : Math.round((fullStable / clusters.length) * 100);

  const globalScoreSum   = clusters.reduce((s, c) => s + c.scoreSum, 0);
  const globalScoreCount = clusters.reduce((s, c) => s + c.scoreCount, 0);
  const avgTextSimilarity = globalScoreCount === 0 ? 100 : Math.round((globalScoreSum / globalScoreCount) * 100);

  banner(`Multi-Version Stability Report  (${N} versions)  [${matchMode}]`);
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
  console.log(`  Avg text similarity:       ${avgTextSimilarity}%  (mean similarity across matched pairs)`);

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

    // Show fingerprint drift across versions
    const uniqueFps = new Set([...cluster.versions.values()].map((e) => e.fingerprint));
    if (uniqueFps.size > 1) {
      console.log(`         Fingerprint variants:`);
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
