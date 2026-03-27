import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";

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
  alreadyPaid: string;           // was totalCollectedConfirmed
  totalCollectedPending: string;
  netPayable: string;
  isSettled: boolean;
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
          select: { finalCost: true, estimatedCost: true },
        },
      },
    });
    if (!booking) throw new Error("Booking not found.");

    const totalFinal = new Decimal(booking.totalFinal.toString());

    // Sum approved damage charges (use finalCost if set, else estimatedCost)
    const damageChargesTotal = booking.damages.reduce((acc, d) => {
      const cost = d.finalCost ?? d.estimatedCost;
      return acc.add(new Decimal(cost.toString()));
    }, ZERO);

    const totalOwed = totalFinal.add(damageChargesTotal);

    // Aggregate confirmed and collected (pending) payments
    const agg = await prisma.paymentTransaction.groupBy({
      by: ["status"],
      where: {
        bookingId,
        status: { in: ["CONFIRMED", "COLLECTED"] },
        purpose: { notIn: ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"] },
      },
      _sum: { totalAmount: true },
    });

    let totalCollectedConfirmed = ZERO;
    let totalCollectedPending = ZERO;
    for (const row of agg) {
      const amt = new Decimal((row._sum.totalAmount ?? ZERO).toString());
      if (row.status === "CONFIRMED") totalCollectedConfirmed = totalCollectedConfirmed.add(amt);
      else if (row.status === "COLLECTED") totalCollectedPending = totalCollectedPending.add(amt);
    }

    const rentalBalanceRemaining = Decimal.max(ZERO, totalFinal.sub(totalCollectedConfirmed));
    const netPayable = totalOwed.sub(totalCollectedConfirmed);
    const isSettled = netPayable.lte(ZERO) && totalCollectedPending.eq(ZERO);

    // Extension charges: for now we can derive it from the total owed vs (base + damage)
    // but totalFinal already includes base. For simplicity, we'll return 0 if not tracked.
    const extensionCharges = ZERO; 

    return {
      bookingId,
      bookingPublicId: booking.publicId,
      bookingStatus: booking.status,
      customerName: booking.customer.user.name,
      vehicleRegNo: booking.items[0]?.vehicle.regNo ?? "N/A",
      rentalBalanceRemaining: rentalBalanceRemaining.toString(),
      damageCharges: damageChargesTotal.toString(),
      extensionCharges: extensionCharges.toString(),
      alreadyPaid: totalCollectedConfirmed.toString(),
      totalCollectedPending: totalCollectedPending.toString(),
      netPayable: netPayable.toString(),
      isSettled,
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
