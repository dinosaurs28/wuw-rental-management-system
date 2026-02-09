import Redis from "ioredis";

// Lazy initialization to ensure environment variables are loaded first
let redisInstance: Redis | null = null;

function createRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
  }

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 30000,
    // TLS configuration for Azure Redis (rediss://)
    tls: redisUrl.startsWith('rediss://') ? {
      rejectUnauthorized: true,
    } : undefined,
  });
}

// Export a getter that creates the client on first access
export const getRedis = (): Redis => {
  if (!redisInstance) {
    redisInstance = createRedisClient();
  }
  return redisInstance;
};

// For backward compatibility, export redis as a getter property
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return getRedis()[prop as keyof Redis];
  },
  set(_target, prop, value) {
    (getRedis() as any)[prop] = value;
    return true;
  }
});
