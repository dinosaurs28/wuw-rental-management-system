export function calculateMultiDayTotalPrice(
  startDate: Date,
  endDate: Date,
  dailyPrice: number
) {
  // Normalize to start of day (midnight) to avoid time-based discrepancies
  // Normalize to start of day (midnight) using UTC to avoid timezone issues
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));

  // Calculate the difference in milliseconds
  const diffInMs = end.getTime() - start.getTime();

  // Convert to days (1 day = 24 * 60 * 60 * 1000 milliseconds)
  // Add 1 to include both start and end dates (calendar days)
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24)) + 1;

  // Ensure minimum 1 day
  const days = Math.max(1, diffInDays);

  const total = Number((days * dailyPrice).toFixed(2));

  return {
    days,
    total
  };
}