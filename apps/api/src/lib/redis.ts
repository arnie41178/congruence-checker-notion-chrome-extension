import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const JOB_TTL_SECONDS = 6 * 60 * 60; // 6 hours
export const DAILY_LIMIT = 100; // max analyses per clientId per day
