/**
 * Feature Flag Cache Utility
 *
 * In-memory cache for feature flags to minimize DB queries.
 * TTL: 5 minutes (300,000ms)
 *
 * Key format:
 *   'flag:system:{flagKey}'
 *   'flag:branch:{branchId}:{flagKey}'
 *   'flag:vehicle:{vehicleId}:{flagKey}'
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class FlagCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly defaultTTL: number = 300_000; // 5 minutes in ms

  /**
   * Get a value from cache. Returns null if missing or expired.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /**
   * Set a value in cache with optional custom TTL.
   */
  set<T>(key: string, value: T, customTTL?: number): void {
    const ttl = customTTL ?? this.defaultTTL;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Delete a specific key.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all keys matching a glob-style pattern (supports * wildcard).
   */
  clearPattern(pattern: string): void {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all entries from the cache.
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Generate a type-safe cache key.
   */
  static generateKey(
    scope: "system" | "branch" | "vehicle",
    flagKey: string,
    id?: number
  ): string {
    if (scope === "system") return `flag:system:${flagKey}`;
    if (scope === "branch") return `flag:branch:${id}:${flagKey}`;
    if (scope === "vehicle") return `flag:vehicle:${id}:${flagKey}`;
    throw new Error(`Invalid cache scope: ${scope}`);
  }
}

export const flagCache = new FlagCache();
export default flagCache;
