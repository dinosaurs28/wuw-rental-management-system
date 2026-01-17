export function calculateMultiDayTotalPrice(
  startDate: Date,
  endDate: Date,
  dailyPrice: number
) {
  // Normalize to start of day (midnight) to avoid time-based discrepancies
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

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