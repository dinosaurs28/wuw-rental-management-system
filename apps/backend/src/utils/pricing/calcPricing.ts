import { prisma } from "@repo/database/client";

export async function calculatePricingForVehicle(vehicleId: number) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      branch: {
        include: { pricingSetting: true },  
      },
      pricingOverride: true,               
    },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  const base = Number(vehicle.baseDailyPrice);
  let finalDailyPrice = base;

  if (vehicle.pricingOverride?.enabled) {
    if (vehicle.pricingOverride.customPrice) {
      finalDailyPrice = Number(vehicle.pricingOverride.customPrice);
    } else if (vehicle.pricingOverride.multiplier) {
      finalDailyPrice = base * Number(vehicle.pricingOverride.multiplier);
    }
  }

  else {
    const settings = vehicle.branch?.pricingSetting;

    if (settings) {
      if (settings.customEnabled) {
        finalDailyPrice = base * Number(settings.customMultiplier);
      } else if (settings.peakEnabled) {
        finalDailyPrice = base * Number(settings.peakMultiplier);
      } else if (settings.weekendEnabled) {
        finalDailyPrice = base * Number(settings.weekendMultiplier);
      }
    }
  }

  return {
    hourly: Number((finalDailyPrice / 24).toFixed(2)),
    halfDay: Number((finalDailyPrice / 2).toFixed(2)),
    daily: Number(finalDailyPrice.toFixed(2)),
  };
}
