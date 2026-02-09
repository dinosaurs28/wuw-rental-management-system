import Redis from "ioredis";

// Environment variables should already be loaded by index.ts
// Validate that REDIS_URL is set
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectTimeout: 30000,
  // TLS configuration for Azure Redis (rediss://)
  tls: redisUrl.startsWith('rediss://') ? {
    rejectUnauthorized: true,
  } : undefined,
});
