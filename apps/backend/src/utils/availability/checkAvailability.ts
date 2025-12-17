import { prisma } from "@repo/database/client";

export async function checkVehicleAvailability(vehicleId: number, start: Date, end: Date) {
  const booking = await prisma.booking.findFirst({
    where: {
      status: { not: "CANCELLED" },
      startAt: { lte: end },  
      endAt: { gte: start },  

      items: {
        some: { vehicleId }  
      }
    },
    select: { id: true }
  });

  return booking ? false : true;
}
