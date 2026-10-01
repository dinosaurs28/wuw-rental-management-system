import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { computeBookingOwed, getBookingMoney } from "./booking-owed.service.js";

const ZERO = new Decimal(0);

export interface SettlementSummary {
  bookingId: number;
  bookingPublicId: string;
  bookingStatus: string;
  customerName: string;
  vehicleRegNo: string;
  rentalBalanceRemaining: string; // was remainingRentalBalance
  damageCharges: string;          // was damageChargesTotal
  extensionCharges: string;      // Added
  /**
   * Return charges outside totalFinal (incl. GST): a legacy drop's extra km + late return +
   * vehicle-swap difference collected here, or the Unified Payments drop bill (after its discount)
   */
  returnCharges: string;
  alreadyPaid: string;           // was totalCollectedConfirmed; refunds paid out are taken off
  totalCollectedPending: string;
  netPayable: string;
  isSettled: boolean;
  /** Refundable safety deposit taken and not yet credited back on a drop bill */
  safetyDepositHeld: string;
  /** Refunds paid out (OVERPAYMENT_REFUND / CANCELLATION_REFUND) */
  refunded: string;
  /** totalFinal + returnCharges + safety deposit held — what netPayable is measured against */
  totalOwed: string;
}

export interface PaginatedSettlements {
  settlements: SettlementSummary[];
  total: number;
  page: number;
  pageSize: number;
}

class SettlementEngineService {
  async calculateSettlement(bookingId: number): Promise<SettlementSummary> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        publicId: true,
        status: true,
        totalFinal: true,
        customer: {
          select: {
            user: { select: { name: true } },
          },
        },
        items: {
          select: {
            vehicle: { select: { regNo: true } },
          },
          take: 1,
        },
        damages: {
          where: { status: "APPROVED" },
          select: { finalCost: true, estimatedCost: true, chargedAtDrop: true },
        },
        extensions: {
          where: { extensionStatus: "CONFIRMED" },
          select: { additionalAmount: true },
        },
      },
    });
    if (!booking) throw new Error("Booking not found.");

    // Sum approved damage charges (use finalCost if set, else estimatedCost)
    const damageCost = (d: { finalCost: unknown; estimatedCost: unknown }) =>
      new Decimal(String(d.finalCost ?? d.estimatedCost));
    const damageChargesTotal = booking.damages.reduce((acc, d) => acc.add(damageCost(d)), ZERO);

    // What the booking owes — shared with the financial state and the over-payment
    // guard: totalFinal (rounded to paise) + return charges outside it (a legacy drop's
    // ChargeEntry rows with their frozen GST, or the Unified Payments drop bill after
    // its discount; damage billed at drop is on that bill — a damage the manager
    // charged in review is already inside totalFinal) + safety deposit held.
    // Money: refund rows are paid back, so they come off what was paid.
    const [owed, money] = await Promise.all([computeBookingOwed(bookingId), getBookingMoney(bookingId)]);
    const { totalFinal, totalOwed } = owed;
    const totalCollectedConfirmed = money.netConfirmed;
    const totalCollectedPending = money.pending;

    // Rental money paid = what was paid less the deposit still held / credited back
    const rentalPaid = totalCollectedConfirmed.sub(owed.safetyDepositCharged.sub(owed.safetyDepositCredited));
    const rentalBalanceRemaining = Decimal.max(ZERO, totalFinal.sub(rentalPaid));
    const netPayable = totalOwed.sub(totalCollectedConfirmed);
    const isSettled = netPayable.lte(ZERO) && totalCollectedPending.eq(ZERO);

    // Confirmed extension charges (taxable + GST). Informational: every
    // extension finalizer already added them to totalFinal.
    const extensionCharges = booking.extensions.reduce(
      (acc, e) => acc.add(new Decimal(e.additionalAmount.toString())),
      ZERO,
    );

    return {
      bookingId,
      bookingPublicId: booking.publicId,
      bookingStatus: booking.status,
      customerName: booking.customer.user.name,
      vehicleRegNo: booking.items[0]?.vehicle.regNo ?? "N/A",
      rentalBalanceRemaining: rentalBalanceRemaining.toString(),
      damageCharges: damageChargesTotal.toString(),
      extensionCharges: extensionCharges.toString(),
      returnCharges: owed.returnCharges.toString(),
      alreadyPaid: totalCollectedConfirmed.toString(),
      totalCollectedPending: totalCollectedPending.toString(),
      netPayable: netPayable.toString(),
      isSettled,
      safetyDepositHeld: owed.safetyDepositHeld.toString(),
      refunded: money.refundedOut.toString(),
      totalOwed: totalOwed.toString(),
    };
  }

  async listPendingSettlements(
    branchId: number,
    filters: { page?: number; pageSize?: number; minAmount?: number },
  ): Promise<PaginatedSettlements> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // Fetch all RETURNED bookings for the branch (settlement candidates)
    const bookings = await prisma.booking.findMany({
      where: { branchId, status: "RETURNED" },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });

    const summaries: SettlementSummary[] = [];
    for (const b of bookings) {
      const s = await this.calculateSettlement(b.id);
      if (s.isSettled) continue;
      if (filters.minAmount && new Decimal(s.netPayable).lt(new Decimal(filters.minAmount))) continue;
      summaries.push(s);
    }

    const total = summaries.length;
    const page_items = summaries.slice(skip, skip + pageSize);

    return { settlements: page_items, total, page, pageSize };
  }
}

export const settlementEngineService = new SettlementEngineService();
