import { prisma } from "@repo/database/client";

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;

  // Company/Branch Details
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  gstNumber: string;

  // Customer Details
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;

  // Booking Details
  bookingId: number;
  bookingPublicId: string;
  startDate: Date;
  endDate: Date;
  days: number;

  // Line Items
  items: {
    description: string;
    days: number;
    rate: number;
    discount: number;
    taxRate: number;
    cgst: number;
    sgst: number;
    amount: number;
  }[];

  // Totals
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  cgstAmount: number;
  sgstAmount: number;
  damageCharges: number;
  grandTotal: number;
}

/**
 * Transforms booking data into invoice-ready format
 * @param bookingId - The booking ID to transform
 * @returns Structured invoice data
 */
export async function transformBookingToInvoiceData(
  bookingId: number,
): Promise<InvoiceData> {
  try {
    console.log(`[Invoice Data Transformer] Transforming booking ${bookingId}`);

    // Fetch booking with all required relations
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: {
          include: {
            user: true,
          },
        },
        branch: {
          include: {
            gstRule: true,
          },
        },
        items: {
          include: {
            vehicle: {
              include: {
                category: true,
              },
            },
          },
        },
        invoice: true,
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    if (!booking.invoice) {
      throw new Error(`Invoice not found for booking ${bookingId}`);
    }

    // Build customer address
    const customer = booking.customer;
    const customerAddress = [
      customer.addressLine1,
      customer.city,
      customer.state,
      customer.zipCode,
      customer.country,
    ]
      .filter(Boolean)
      .join(", ");

    // Build line items
    const items = booking.items.map((item) => ({
      description: `${item.vehicle.make} ${item.vehicle.model} (${item.vehicle.regNo})`,
      days: item.days,
      rate: Number(item.baseTotal) / item.days,
      discount: Number(item.discountAmount),
      taxRate: Number(item.taxRate),
      cgst: Number(item.cgstAmount),
      sgst: Number(item.sgstAmount),
      amount: Number(item.finalTotal),
    }));

    // GST details from branch
    const gstNumber = booking.branch.gstRule?.gstNumber || "N/A";

    // Calculate total tax from items (CGST + SGST)
    const totalCgst = items.reduce((sum, item) => sum + item.cgst, 0);
    const totalSgst = items.reduce((sum, item) => sum + item.sgst, 0);
    const totalTax = totalCgst + totalSgst;

    const invoiceData: InvoiceData = {
      invoiceNumber:
        booking.invoice.invoiceNumber ||
        `INV/${new Date().getFullYear()}/${bookingId.toString().padStart(5, "0")}`,
      invoiceDate: booking.invoice.createdAt,

      // Company/Branch Details
      companyName: booking.branch?.name || "Unknown Branch",
      companyAddress: booking.branch?.address || "N/A",
      companyPhone: booking.branch?.phone || process.env.COMPANY_PHONE || "N/A",
      companyEmail: process.env.COMPANY_EMAIL || "info@company.com",
      gstNumber: gstNumber,

      // Customer Details
      customerName: customer.user?.name || "Guest",
      customerEmail: customer.user?.email || "N/A",
      customerPhone: customer.user?.phone || customer.alternatePhone || "N/A",
      customerAddress: customerAddress || "N/A",

      // Booking Details
      bookingId: booking.id,
      bookingPublicId: booking.publicId,
      startDate: booking.startAt,
      endDate: booking.endAt,
      days: booking.days,

      // Line Items
      items: items,

      // Totals
      subtotal: Number(booking.invoice.subtotal),
      totalDiscount: Number(booking.invoice.discount),
      totalTax: totalTax,
      cgstAmount: totalCgst,
      sgstAmount: totalSgst,
      damageCharges: Number(booking.invoice.damageCharges),
      grandTotal: Number(booking.invoice.total),
    };

    console.log(
      `[Invoice Data Transformer] Successfully transformed booking ${bookingId}`,
    );

    return invoiceData;
  } catch (error) {
    console.error("[Invoice Data Transformer] ❌ CRITICAL ERROR:", error);
    if (error instanceof Error) {
      console.error("[Invoice Data Transformer] Stack:", error.stack);
    }
    throw error;
  }
}
