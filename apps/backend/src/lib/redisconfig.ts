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

// Resolves once the shared client is ready (or after timeoutMs, in which case
// the caller proceeds and fails fast exactly as before).
export const waitForRedisReady = (timeoutMs = 5000): Promise<void> => {
  const client = getRedis();
  if (client.status === "ready") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off("ready", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    client.on("ready", done);
  });
};

// Methods that must stay synchronous (return builders / emitters, not promises).
const SYNC_METHODS = new Set([
  "multi", "pipeline", "on", "once", "off", "addListener", "removeListener",
  "removeAllListeners", "duplicate", "disconnect", "connect", "defineCommand",
  "listeners", "emit", "setMaxListeners",
]);

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
      const fn = value.bind(instance) as (...a: unknown[]) => unknown;
      if (typeof prop !== "string" || SYNC_METHODS.has(prop)) return fn;
      // Offline queue is disabled, so a command issued before the connection is
      // ready would fail with "Stream isn't writeable": wait for readiness first.
      return (...args: unknown[]) =>
        instance.status === "ready"
          ? fn(...args)
          : waitForRedisReady().then(() => fn(...args));
    }
    return value;
  },
  set(_target, prop, value) {
    (getRedis() as any)[prop] = value;
    return true;
  },
});
