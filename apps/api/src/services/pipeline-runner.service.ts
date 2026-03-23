/**
 * Pipeline Runner Service
 *
 * Spawns the Phase 1→2→3 Claude CLI pipeline as a background child process,
 * tracks progress via stdout parsing, and writes results to Redis via job-store.
 *
 * Repo files sent from the extension are materialised to a temp directory on
 * disk so the pipeline can walk them via --repo-root.
 */

import { spawn, spawnSync } from "child_process";
import { readFile, writeFile, readdir, mkdir, rm } from "fs/promises";
import { join } from "path";
import { dirname } from "path";
import crypto from "crypto";
import { createJob, updateJob } from "./job-store.js";
import type { AnalysisResult, RepoFile } from "@alucify/shared-types";

const API_DIR = process.cwd(); // apps/api
const DEV_DIR = join(API_DIR, ".dev");
const TMP_DIR = join(API_DIR, ".tmp-repos");

const CONSENSUS_RUNS = parseInt(process.env.PIPELINE_CONSENSUS_RUNS ?? "5", 10);

// ── Stage detection from stdout ───────────────────────────────────────────────

interface StageInfo { stage: number; stageLabel: string }

function detectStage(line: string): StageInfo | null {
  if (line.includes("[Phase 1 Consensus]")) {
    return { stage: 1, stageLabel: "Phase 1 — Merging consensus requirements…" };
  }
  if (line.includes("[Phase 1]")) {
    return { stage: 1, stageLabel: "Phase 1 — Extracting requirements…" };
  }
  if (line.includes("[Phase 2]")) {
    return { stage: 2, stageLabel: "Phase 2 — Auditing requirements…" };
  }
  if (line.includes("[Phase 3]")) {
    return { stage: 3, stageLabel: "Phase 3 — Compiling results…" };
  }
  return null;
}

// ── Materialise repo files to a temp directory ────────────────────────────────

async function writeRepoToTemp(jobId: string, files: RepoFile[]): Promise<string> {
  const repoDir = join(TMP_DIR, jobId);
  await mkdir(repoDir, { recursive: true });
  for (const file of files) {
    const filePath = join(repoDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf-8");
  }
  return repoDir;
}

async function cleanupTempRepo(repoDir: string) {
  await rm(repoDir, { recursive: true, force: true }).catch(() => {});
}

// ── Find latest p3 analysis-result.json ──────────────────────────────────────

async function findLatestResult(): Promise<AnalysisResult | null> {
  try {
    const entries = await readdir(DEV_DIR);
    const p3Dirs = entries.filter((e) => /^p3-v\d+$/.test(e)).sort();
    if (p3Dirs.length === 0) return null;
    const latest = p3Dirs[p3Dirs.length - 1];
    const raw = await readFile(join(DEV_DIR, latest, "analysis-result.json"), "utf-8");
    return JSON.parse(raw) as AnalysisResult;
  } catch {
    return null;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function startPipelineAnalysis(prdContent: string, repoFiles: RepoFile[]): Promise<string> {
  const jobId = crypto.randomUUID();

  // Write PRD to .dev/prd.md
  await writeFile(join(DEV_DIR, "prd.md"), prdContent, "utf-8");

  // Materialise repo files to a temp directory so pipeline can walk them
  const repoDir = await writeRepoToTemp(jobId, repoFiles);

  // Build GitNexus index inside the temp repo directory so phase2 gets graph context.
  // gitnexus requires a git repo, so initialise one first.
  console.log(`[pipeline:${jobId.slice(0, 8)}] Initialising git repo in temp dir for gitnexus`);
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "pipeline", GIT_AUTHOR_EMAIL: "pipeline@local", GIT_COMMITTER_NAME: "pipeline", GIT_COMMITTER_EMAIL: "pipeline@local" };
  for (const [cmd, args] of [
    ["git", ["init"]],
    ["git", ["add", "."]],
    ["git", ["commit", "-m", "init", "--no-gpg-sign"]],
  ] as [string, string[]][]) {
    spawnSync(cmd, args, { cwd: repoDir, stdio: "ignore", env: gitEnv });
  }

  console.log(`[pipeline:${jobId.slice(0, 8)}] Running gitnexus analyze in ${repoDir}`);
  const gitnexusResult = spawnSync("npx", ["gitnexus", "analyze"], {
    cwd: repoDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    env: { ...process.env },
  });
  if (gitnexusResult.status !== 0) {
    console.warn(`[pipeline:${jobId.slice(0, 8)}] gitnexus analyze failed — continuing without graph context`);
    console.warn(gitnexusResult.stderr?.slice(0, 500));
  } else {
    console.log(`[pipeline:${jobId.slice(0, 8)}] gitnexus analyze complete`);
  }

  // Create job in Redis
  await createJob(jobId, {
    jobId,
    status: "running",
    stage: 1,
    stageLabel: "Phase 1 — Extracting requirements…",
  });

  // Build pipeline command args
  const args = ["pipeline", "--runs", String(CONSENSUS_RUNS), "--repo-root", repoDir];

  // Spawn pipeline as background process
  const child = spawn("pnpm", args, {
    cwd: API_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stdoutBuf = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";

    for (const line of lines) {
      process.stdout.write(`[pipeline:${jobId.slice(0, 8)}] ${line}\n`);
      const stage = detectStage(line);
      if (stage) {
        updateJob(jobId, { status: "running", ...stage }).catch(() => {});
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[pipeline:${jobId.slice(0, 8)}] ${chunk.toString()}`);
  });

  child.on("close", async (code) => {
    await cleanupTempRepo(repoDir);

    if (code !== 0) {
      await updateJob(jobId, {
        status: "failed",
        message: `Pipeline exited with code ${code}. Check server logs for details.`,
      });
      return;
    }

    await updateJob(jobId, { stage: 3, stageLabel: "Phase 3 — Finalising results…" });
    const result = await findLatestResult();
    if (!result) {
      await updateJob(jobId, {
        status: "failed",
        message: "Pipeline completed but analysis-result.json was not found.",
      });
      return;
    }

    await updateJob(jobId, { status: "completed", result });
    console.log(`[pipeline:${jobId.slice(0, 8)}] Done — ${result.issueCount} issues, badge: ${result.badge}`);

    // Fire-and-forget: generate semantic fingerprints (does not block result delivery)
    console.log(`[pipeline:${jobId.slice(0, 8)}] Running Phase 4 fingerprinting...`);
    spawnSync("pnpm", ["phase4:fingerprint"], { cwd: API_DIR, stdio: "ignore" });
  });

  return jobId;
}
