import { redis } from "../lib/redisconfig.js";

export const rateLimit = async (key: string, limit: number, ttl: number) => {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, ttl);
  }

  if (count > limit) {
    return false;
  }

  return true;
};
