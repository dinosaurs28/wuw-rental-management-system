import { prisma } from "@repo/database/client";

export const getDepositAmount = async (
  branchId: number,
  categoryId: number,
) => {
  const row = await prisma.categoryDepositSetting.findUnique({
    where: { branchId_categoryId: { branchId, categoryId } },
  });

  return row ? Number(row.amount) : 0;
};
