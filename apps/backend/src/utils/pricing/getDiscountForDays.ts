import { prisma } from "@repo/database/client";
export async function getDiscountForDays(
  branchId: number,
  categoryId: number,
  days: number
): Promise<number> {

  const slabs = await prisma.pricingDiscountSlab.findMany({
    where: {
      branchId,
      categoryId,
    },
    orderBy: { days: "asc" }, 
  });

  if (slabs.length === 0) {
    return 1; 
  }
  let applicable = slabs[0];

  for (const slab of slabs) {
    if (days >= slab.days) {
      applicable = slab;
    } else {
      break;
    }
  }
  return Number(applicable?.multiplier);
}
