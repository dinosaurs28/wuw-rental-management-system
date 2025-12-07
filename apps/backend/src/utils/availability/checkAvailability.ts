import { prisma } from "@repo/database/client";

export async function checkVehicleAvailability(vehicleId: number, start: Date, end: Date) {
  const booking = await prisma.booking.findFirst({
    where: {
      vehicleId,
      status: { not: "CANCELLED" },
      startAt: { lte: end },
      endAt: { gte: start },
    },
  });

  return booking ? false : true;
}
