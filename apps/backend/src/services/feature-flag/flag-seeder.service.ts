/**
 * Flag Seeder Service
 *
 * Seeds default feature flags from config into the database.
 * Safe to re-run: skips existing flags, only inserts missing ones.
 */

import { prisma } from "@repo/database/client";
import {
  FEATURE_FLAG_DEFINITIONS,
} from "../../config/feature-flags.config.js";
import { createID } from "../../utils/nanoID.js";

class FlagSeederService {
  /**
   * Seed all default feature flags.
   *
   * @returns { created, skipped, updated }
   */
  async seedDefaultFlags(): Promise<{
    created: number;
    skipped: number;
    updated: number;
  }> {
    const existingFlags = await prisma.featureFlag.findMany({
      select: { key: true },
    });
    const existingKeys = new Set(existingFlags.map((f: { key: string }) => f.key));

    let created = 0;
    let skipped = 0;
    const updated = 0;

    for (const def of FEATURE_FLAG_DEFINITIONS) {
      if (!existingKeys.has(def.key)) {
        await prisma.featureFlag.create({
          data: {
            publicId: createID(),
            key: def.key,
            name: def.name,
            description: def.description,
            scope: def.scope as any,
            enabled: def.defaultEnabled,
            config: def.config ?? null,
          },
        });
        created++;
      } else {
        skipped++;
      }
    }

    return { created, skipped, updated };
  }

  /**
   * Update metadata (name, description) for existing flags without
   * touching enabled status or config.
   */
  async updateFlagMetadata(): Promise<number> {
    let updated = 0;

    for (const def of FEATURE_FLAG_DEFINITIONS) {
      const result = await prisma.featureFlag.updateMany({
        where: { key: def.key },
        data: { name: def.name, description: def.description },
      });
      if (result.count > 0) updated++;
    }

    return updated;
  }
}

export const flagSeederService = new FlagSeederService();
export default flagSeederService;
