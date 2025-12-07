export async function calculatePricingForVehicleFromRecord(vehicle: any) {
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
    daily: Number(finalDailyPrice.toFixed(2)),
    halfDay: Number((finalDailyPrice / 2).toFixed(2)),
    hourly: Number((finalDailyPrice / 24).toFixed(2)),
  };
}
