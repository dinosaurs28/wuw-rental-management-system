/**
 * Seed Feature Flags Script
 *
 * Run this after migration to populate default flags:
 *   npx ts-node src/scripts/seed-feature-flags.ts
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../../.env") });

import { flagSeederService } from "../services/feature-flag/flag-seeder.service.js";

async function seedFlags() {
  console.log("🚀 Seeding feature flags...\n");

  try {
    const result = await flagSeederService.seedDefaultFlags();

    console.log(`✅ Created  : ${result.created} new flags`);
    console.log(`⏭️  Skipped  : ${result.skipped} existing flags`);
    console.log(`📝 Updated  : ${result.updated} flag metadata\n`);
    console.log("Done!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seedFlags();
