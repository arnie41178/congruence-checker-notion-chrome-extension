/**
 * Compare Fingerprints — Cross-Run Stability Analysis
 *
 * Compares semantic fingerprints from two pipeline versions to measure
 * how stable the analysis results are across runs.
 *
 * Usage:
 *   cd apps/api && pnpm phase4:compare --v1 v025 --v2 v026
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";

const DEV_DIR = join(process.cwd(), ".dev");

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

async function main() {
  let v1 = getArg("--v1");
  let v2 = getArg("--v2");

  if (!v1 || !v2) {
    [v1, v2] = await detectLatestTwoVersions();
    console.log(`[compare] Auto-detected versions: ${v1} → ${v2}`);
  }

  const f1 = await loadFingerprints(v1);
  const f2 = await loadFingerprints(v2);

  const map1 = new Map(f1.fingerprints.map((f) => [f.id, f]));
  const map2 = new Map(f2.fingerprints.map((f) => [f.id, f]));

  const allIds = new Set([...map1.keys(), ...map2.keys()]);

  const stable:  FingerprintEntry[] = [];
  const changed: { id: string; from: string; to: string; summary: string }[] = [];
  const added:   FingerprintEntry[] = [];
  const removed: FingerprintEntry[] = [];

  for (const id of allIds) {
    const e1 = map1.get(id);
    const e2 = map2.get(id);

    if (e1 && e2) {
      if (e1.fingerprint === e2.fingerprint) {
        stable.push(e2);
      } else {
        changed.push({ id, from: e1.fingerprint, to: e2.fingerprint, summary: e2.summary });
      }
    } else if (e2 && !e1) {
      added.push(e2);
    } else if (e1 && !e2) {
      removed.push(e1);
    }
  }

  const total = map1.size;
  const stabilityPct = total === 0 ? 100 : Math.round((stable.length / total) * 100);

  banner(`Stability Report: ${v1} → ${v2}`);
  console.log(`  Stable:   ${stable.length} / ${total}  (same fingerprint)`);
  console.log(`  Changed:  ${changed.length} / ${total}  (same id, different fingerprint)`);
  console.log(`  Added:    ${added.length}        (new in ${v2})`);
  console.log(`  Removed:  ${removed.length}        (dropped from ${v1})`);
  console.log(`  Stability score: ${stabilityPct}%`);

  if (changed.length > 0) {
    banner("Changed Fingerprints");
    for (const c of changed) {
      console.log(`  ${c.id}  ${c.summary}`);
      console.log(`    from: ${c.from}`);
      console.log(`    to:   ${c.to}`);
    }
  }

  if (added.length > 0) {
    banner(`Added in ${v2}`);
    for (const a of added) {
      console.log(`  ${a.id.padEnd(6)}  ${a.fingerprint}  — ${a.summary}`);
    }
  }

  if (removed.length > 0) {
    banner(`Removed from ${v1}`);
    for (const r of removed) {
      console.log(`  ${r.id.padEnd(6)}  ${r.fingerprint}  — ${r.summary}`);
    }
  }

  if (stable.length > 0) {
    banner("Stable Fingerprints");
    for (const s of stable) {
      console.log(`  ${s.id.padEnd(6)}  ${s.fingerprint}`);
    }
  }

  console.log(`\n${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("[compare] Fatal:", err);
  process.exit(1);
});
