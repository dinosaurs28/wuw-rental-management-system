import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";

export async function calculatePricingForVehicleFromRecord(vehicle: any) {
  // Create a 24-hour baseline quote using the new pricing engine
  const pricingEngine = new PricingEngineService();
  const startAt = TimezoneService.getCurrentTime();
  const endAt = startAt.plus({ hours: 24 });
  
  const pricingResult = await pricingEngine.calculateBookingPrice(
    vehicle.id,
    startAt,
    endAt,
    vehicle.branchId
  );

  return {
    daily: Number(pricingResult.pricingBreakdown.applicablePrice),
    halfDay: Number(pricingResult.pricingBreakdown.applicablePrice) / 2,
    hourly: Number(pricingResult.pricingBreakdown.applicablePrice) / 24,
  };
}
