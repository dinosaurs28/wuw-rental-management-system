import { redis } from "../../lib/redisconfig.js";

const LOCK_TTL_SECONDS = 60;
const LOCK_PREFIX = "ext-lock:vehicle:";

class ExtensionLockService {
  private lockKey(vehicleId: number): string {
    return `${LOCK_PREFIX}${vehicleId}`;
  }

  async acquireVehicleLock(vehicleId: number): Promise<boolean> {
    const result = await redis.set(this.lockKey(vehicleId), "1", "EX", LOCK_TTL_SECONDS, "NX");
    return result === "OK";
  }

  async releaseVehicleLock(vehicleId: number): Promise<void> {
    await redis.del(this.lockKey(vehicleId));
  }

  async lockExists(vehicleId: number): Promise<boolean> {
    const result = await redis.exists(this.lockKey(vehicleId));
    return result === 1;
  }

  async acquireMultipleLocks(vehicleIds: number[]): Promise<{ acquired: number[]; failed: number[] }> {
    const acquired: number[] = [];
    const failed: number[] = [];

    for (const vehicleId of vehicleIds) {
      const ok = await this.acquireVehicleLock(vehicleId);
      if (ok) {
        acquired.push(vehicleId);
      } else {
        failed.push(vehicleId);
      }
    }

    if (failed.length > 0) {
      // Release all acquired locks since we couldn't get all of them
      await Promise.all(acquired.map((id) => this.releaseVehicleLock(id)));
      return { acquired: [], failed };
    }

    return { acquired, failed: [] };
  }

  async releaseMultipleLocks(vehicleIds: number[]): Promise<void> {
    await Promise.all(vehicleIds.map((id) => this.releaseVehicleLock(id)));
  }
}

export const extensionLockService = new ExtensionLockService();
