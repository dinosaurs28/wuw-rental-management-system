export function calculateMultiDayTotalPrice(
  startDate: Date,
  endDate: Date,
  dailyPrice: number
) {
  // Calculate the difference in milliseconds
  const diffInMs = endDate.getTime() - startDate.getTime();

  // Convert to days (1 day = 24 * 60 * 60 * 1000 milliseconds)
  const diffInDays = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));

  // Ensure minimum 1 day
  const days = Math.max(1, diffInDays);

  const total = Number((days * dailyPrice).toFixed(2));

  return {
    days,
    total
  };
}