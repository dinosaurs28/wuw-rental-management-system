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
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    // TLS configuration for Azure Redis (rediss://)
    tls: redisUrl.startsWith("rediss://")
      ? {
          rejectUnauthorized: true,
        }
      : undefined,
  });
}

export const getRedis = (): Redis => {
  if (!redisInstance) {
    redisInstance = createRedisClient();
    redisInstance.on("error", (err) => {
      console.warn("[Redis] Connection Error:", err.message);
    });
  }
  return redisInstance;
};

// For backward compatibility, export redis as a getter property
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const instance = getRedis();
    const value = instance[prop as keyof Redis];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, prop, value) {
    (getRedis() as any)[prop] = value;
    return true;
  },
});
