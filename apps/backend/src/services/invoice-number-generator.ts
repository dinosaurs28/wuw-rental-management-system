import { prisma } from "@repo/database/client";

/**
 * Generates a unique invoice number in the format: INV/YYYY/NNNNN
 * Example: INV/2026/00123
 * 
 * @param bookingId - The booking ID to generate invoice number for
 * @returns Invoice number string
 */
export async function generateInvoiceNumber(bookingId: number): Promise<string> {
    try {
        // Get current year
        const currentYear = new Date().getFullYear();

        // Pad booking ID to 5 digits
        const paddedBookingId = bookingId.toString().padStart(5, '0');

        // Format: INV/YYYY/NNNNN
        const invoiceNumber = `INV/${currentYear}/${paddedBookingId}`;

        console.log(`[Invoice Number Generator] Generated: ${invoiceNumber} for booking ${bookingId}`);

        return invoiceNumber;

    } catch (error) {
        console.error('[Invoice Number Generator] Error generating invoice number:', error);
        throw new Error('Failed to generate invoice number');
    }
}
