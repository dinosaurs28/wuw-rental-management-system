/// <reference types="node" />
/**
 * One-shot script to backfill `typeClass` on existing VehicleCategory rows.
 *
 * Run AFTER applying the migration:
 *   pnpm tsx packages/db/scripts/set-type-class.ts
 *
 * Safe to run multiple times (idempotent via upsert-style updateMany).
 */

import { PrismaClient } from "../src/generated/client/index.js";

const prisma = new PrismaClient();

async function main() {
  // Two-Wheeler categories — match common naming variants
  const twoWheelerResult = await prisma.vehicleCategory.updateMany({
    where: {
      OR: [
        { name: { contains: "two", mode: "insensitive" } },
        { name: { contains: "2w", mode: "insensitive" } },
        { name: { contains: "bike", mode: "insensitive" } },
        { name: { contains: "scooter", mode: "insensitive" } },
        { description: { contains: "bike", mode: "insensitive" } },
        { description: { contains: "scooter", mode: "insensitive" } },
      ],
      typeClass: "OTHER",
    },
    data: { typeClass: "TWO_WHEELER" },
  });

  // Four-Wheeler categories — match common naming variants
  const fourWheelerResult = await prisma.vehicleCategory.updateMany({
    where: {
      OR: [
        { name: { contains: "four", mode: "insensitive" } },
        { name: { contains: "4w", mode: "insensitive" } },
        { name: { contains: "car", mode: "insensitive" } },
        { name: { contains: "suv", mode: "insensitive" } },
        { description: { contains: "car", mode: "insensitive" } },
        { description: { contains: "suv", mode: "insensitive" } },
      ],
      typeClass: "OTHER",
    },
    data: { typeClass: "FOUR_WHEELER" },
  });

  console.log(`TWO_WHEELER  → updated ${twoWheelerResult.count} row(s)`);
  console.log(`FOUR_WHEELER → updated ${fourWheelerResult.count} row(s)`);

  // Warn about any categories still on OTHER so they can be classified manually
  const remaining = await prisma.vehicleCategory.findMany({
    where: { typeClass: "OTHER" },
    select: { id: true, name: true, description: true },
  });

  if (remaining.length > 0) {
    console.warn("\n⚠  Categories still set to OTHER (classify manually if needed):");
    for (const cat of remaining) {
      console.warn(`   id=${cat.id}  name="${cat.name}"  desc="${cat.description ?? ""}"`);
    }
  } else {
    console.log("\nAll categories classified successfully.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
