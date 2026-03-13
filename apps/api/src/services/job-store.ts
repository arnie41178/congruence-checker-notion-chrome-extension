import { redis, JOB_TTL_SECONDS, DAILY_LIMIT } from "../lib/redis.js";
import type { JobState } from "@alucify/shared-types";

function jobKey(jobId: string) { return `job:${jobId}`; }
function limitKey(clientId: string) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `limit:${clientId}:${day}`;
}

export async function createJob(jobId: string, initial: JobState): Promise<void> {
  await redis.set(jobKey(jobId), JSON.stringify(initial), { ex: JOB_TTL_SECONDS });
}

export async function updateJob(jobId: string, patch: Partial<JobState>): Promise<void> {
  const raw = await redis.get<string>(jobKey(jobId));
  if (!raw) return;
  const current: JobState = typeof raw === "string" ? JSON.parse(raw) : raw;
  const updated = { ...current, ...patch };
  await redis.set(jobKey(jobId), JSON.stringify(updated), { ex: JOB_TTL_SECONDS });
}

export async function getJob(jobId: string): Promise<JobState | null> {
  const raw = await redis.get<string>(jobKey(jobId));
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

// Returns true if under limit, false if exceeded
export async function checkAndIncrementLimit(clientId: string): Promise<boolean> {
  const key = limitKey(clientId);
  const count = await redis.incr(key);
  if (count === 1) {
    // First request today — set TTL to end of day
    const now = new Date();
    const secondsUntilMidnight =
      86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
    await redis.expire(key, secondsUntilMidnight);
  }
  return count <= DAILY_LIMIT;
}
