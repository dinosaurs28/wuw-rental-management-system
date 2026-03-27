/**
 * Generates a unique receipt number in the format: RCP/YYYY/NNNNN
 * Example: RCP/2026/00123
 */
export function generateReceiptNumber(bookingId: number): string {
  const currentYear = new Date().getFullYear();
  const paddedBookingId = bookingId.toString().padStart(5, "0");
  return `RCP/${currentYear}/${paddedBookingId}`;
}
