export function calculateMultiDayTotalPrice(start: Date, end: Date, dailyPrice: number) {
  const days = [];

  const current = new Date(start);

  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  const total = days.length * dailyPrice;

  return {
    days: days.length,
    total: Number(total.toFixed(2)),
  };
}
