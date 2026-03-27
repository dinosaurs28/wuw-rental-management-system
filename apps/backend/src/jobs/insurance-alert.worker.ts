import { Worker, Queue } from "bullmq";
import Redis from "ioredis";
import { prisma } from "@repo/database/client";
import { getRedis } from "../lib/redisconfig.js";
import { getInsuranceAlertQueue } from "../lib/queue.client.js";

const REDIS_KEY = "insurance:alert:counts";
const CACHE_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const EXPIRY_WARN_DAYS = 7;

let connection: Redis | null = null;

function getConnection(): Redis {
  if (!connection) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL environment variable is required");
    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 30000,
      enableOfflineQueue: false,
      retryStrategy: (t) => Math.min(t * 50, 2000),
      tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: true } : undefined,
    });
  }
  return connection;
}

/**
 * Runs the insurance check: counts vehicles with insurance expired or expiring
 * within EXPIRY_WARN_DAYS days, then caches the result in Redis.
 */
async function runInsuranceCheck(): Promise<void> {
  const now = new Date();
  const warnCutoff = new Date(now.getTime() + EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);

  const [expiredCount, expiringCount] = await Promise.all([
    // Already expired
    prisma.vehicle.count({
      where: {
        insuranceExpiry: { lt: now },
        deletedAt: null,
      },
    }),
    // Expiring within 7 days (but not yet expired)
    prisma.vehicle.count({
      where: {
        insuranceExpiry: { gte: now, lte: warnCutoff },
        deletedAt: null,
      },
    }),
  ]);

  const payload = JSON.stringify({
    expiredCount,
    expiringCount,
    total: expiredCount + expiringCount,
    computedAt: now.toISOString(),
  });

  await getRedis().set(REDIS_KEY, payload, "EX", CACHE_TTL_SECONDS);

  console.log(
    `[Insurance Alert] ✅ Counts updated — expired: ${expiredCount}, expiring: ${expiringCount}`,
  );
}

let insuranceWorker: Worker | null = null;

export function initInsuranceAlertWorker(): void {
  if (insuranceWorker) return;

  const queue = getInsuranceAlertQueue();

  // Schedule daily check at 08:00 every day (server local time)
  queue.add(
    "check-insurance-expiry",
    {},
    {
      jobId: "insurance-daily-check",
      repeat: { pattern: "0 8 * * *" },
    },
  ).catch((err) =>
    console.error("[Insurance Alert] Failed to schedule repeatable job:", err),
  );

  // Also trigger an immediate check on startup so the cache is warm
  queue.add("check-insurance-expiry", {}, { jobId: "insurance-startup-check" }).catch(
    () => {/* already queued or minor race — safe to ignore */},
  );

  insuranceWorker = new Worker(
    "{bull}insurance-alert",
    async () => {
      await runInsuranceCheck();
    },
    { connection: getConnection() as any, concurrency: 1 },
  );

  insuranceWorker.on("completed", () =>
    console.log("[Insurance Alert] ✅ Job completed"),
  );
  insuranceWorker.on("failed", (_job, err) =>
    console.error("[Insurance Alert] ❌ Job failed:", err.message),
  );

  console.log("[Insurance Alert] Worker initialized — runs daily at 08:00");
}

/**
 * Reads the cached insurance alert counts from Redis.
 * Falls back to a live DB query if the cache is cold (e.g., first boot before
 * the worker has run).
 */
export async function getInsuranceAlertCounts(): Promise<{
  expiredCount: number;
  expiringCount: number;
  total: number;
  computedAt: string | null;
}> {
  try {
    const cached = await getRedis().get(REDIS_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {/* Redis miss — fall through to DB */}

  // Cold cache: compute on-demand and store
  await runInsuranceCheck().catch(() => {/* non-fatal */});

  try {
    const fresh = await getRedis().get(REDIS_KEY);
    if (fresh) return JSON.parse(fresh);
  } catch (_) {/* */}

  // If Redis is unavailable entirely, return live counts with no cache
  const now = new Date();
  const warnCutoff = new Date(now.getTime() + EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);
  const [expiredCount, expiringCount] = await Promise.all([
    prisma.vehicle.count({ where: { insuranceExpiry: { lt: now }, deletedAt: null } }),
    prisma.vehicle.count({ where: { insuranceExpiry: { gte: now, lte: warnCutoff }, deletedAt: null } }),
  ]);
  return { expiredCount, expiringCount, total: expiredCount + expiringCount, computedAt: null };
}
