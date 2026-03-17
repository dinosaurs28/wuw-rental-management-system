import { prisma } from "@repo/database/client";

export async function getDiscountForDays(
  branchId: number,
  categoryId: number,
  days: number,
): Promise<number> {
  // Fetch all discount slabs for this branch and category
  const slabs = await prisma.pricingDiscountSlab.findMany({
    where: {
      branchId,
      categoryId,
    },
    orderBy: { days: "asc" }, // Sort by days ascending
  });

  if (slabs.length === 0) {
    return 0; // No discount slabs = 0% discount
  }

  // Find the applicable discount slab
  // We want the highest slab where days >= slab.days
  let applicableDiscount = 0;

  for (const slab of slabs) {
    if (days >= slab.days) {
      // This slab applies, store its multiplier
      applicableDiscount = Number(slab.multiplier);
    } else {
      // Since slabs are sorted ascending, once we hit a slab
      // that's higher than our days, we can stop
      break;
    }
  }

  return applicableDiscount;
}
