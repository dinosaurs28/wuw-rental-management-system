import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { prisma } from "@repo/database/client";

export async function calculatePricingForVehicle(vehicleId: number) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  // Create a 24-hour baseline quote using the new pricing engine
  const pricingEngine = new PricingEngineService();
  const startAt = TimezoneService.getCurrentTime();
  const endAt = startAt.plus({ hours: 24 });

  const pricingResult = await pricingEngine.calculateBookingPrice(
    vehicleId,
    startAt,
    endAt,
    vehicle.branchId,
  );

  return {
    hourly: Number(pricingResult.pricingBreakdown.applicablePrice) / 24,
    halfDay: Number(pricingResult.pricingBreakdown.applicablePrice) / 2,
    daily: Number(pricingResult.pricingBreakdown.applicablePrice),
  };
}
