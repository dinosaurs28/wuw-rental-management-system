import { Request, Response } from "express";
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, CreditStatus, PaymentPurpose } from "@repo/database/client";

import {
  searchCustomersSchema,
  getCustomerEntriesSchema,
  addCreditSchema,
  clearCreditSchema,
} from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { displayEmail } from "../../utils/customer/identity.js";
import {
  recalcCreditAggregates,
  lockBookingCredit,
  type CreditSection,
} from "../../services/payment/customer-credit.service.js";
import {
  resolveCounterUpi,
  claimCounterUpi,
  proofPhotoFields,
  PROOF_FILE_RELATION_SELECT,
  type CounterUpi,
} from "../../services/payment/payment-proof.service.js";
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";
import {
  computeBookingOwed,
  getBookingMoney,
  unpaidBesideDepositRemainder,
} from "../../services/payment/booking-owed.service.js";
import { settlementEngineService } from "../../services/payment/settlement-engine.service.js";
import { finalizeInvoice, syncLegacyReturnInvoice } from "../../services/invoice-finalization.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sections now also carry Fleet credits (#11): source FLEET_CREDIT, purpose,
// collateral, reference — see services/payment/customer-credit.service.ts.
type Section = CreditSection;

/** Totals to the paisa (summing plain numbers drifted, e.g. 0.1 + 0.2). */
function recalcAggregates(sections: Section[]) {
  return recalcCreditAggregates(sections);
}

/** idempotencyKey prefix of the PaymentTransactions a credit clearance records. */
const CREDIT_CLEAR_KEY_PREFIX = "credit-clear:";

/** The payments each clearance recorded (with the UPI proof photo), keyed by clearance publicId. */
async function clearancePayments(clearancePublicIds: string[]) {
  const out = new Map<string, any[]>();
  if (clearancePublicIds.length === 0) return out;
  const txns = await prisma.paymentTransaction.findMany({
    where: {
      OR: clearancePublicIds.map((id) => ({ idempotencyKey: { startsWith: `${CREDIT_CLEAR_KEY_PREFIX}${id}:` } })),
    },
    select: {
      publicId: true,
      idempotencyKey: true,
      purpose: true,
      method: true,
      status: true,
      totalAmount: true,
      cashAmount: true,
      onlineAmount: true,
      onlineGateway: true,
      onlineTransactionRef: true,
      createdAt: true,
      proofFile: PROOF_FILE_RELATION_SELECT,
    },
    orderBy: { createdAt: "asc" },
  });
  for (const t of txns) {
    const clearanceId = t.idempotencyKey.slice(CREDIT_CLEAR_KEY_PREFIX.length).split(":")[0]!;
    const list = out.get(clearanceId) ?? [];
    list.push({
      publicId: t.publicId,
      purpose: t.purpose,
      method: t.method,
      status: t.status,
      totalAmount: new Decimal(t.totalAmount.toString()).toFixed(2),
      cashAmount: new Decimal(t.cashAmount.toString()).toFixed(2),
      onlineAmount: new Decimal(t.onlineAmount.toString()).toFixed(2),
      onlineGateway: t.onlineGateway,
      onlineTransactionRef: t.onlineTransactionRef,
      createdAt: t.createdAt,
      ...(await proofPhotoFields(t.proofFile)),
    });
    out.set(clearanceId, list);
  }
  return out;
}

/** Adds `payments` (with proof photos) to each clearance of the given entries. */
async function withClearancePayments<T extends { clearances?: Array<{ publicId: string }> }>(entries: T[]) {
  const ids = entries.flatMap((e) => (e.clearances ?? []).map((c) => c.publicId));
  const payments = await clearancePayments(ids);
  return entries.map((e) => ({
    ...e,
    clearances: (e.clearances ?? []).map((c) => ({ ...c, payments: payments.get(c.publicId) ?? [] })),
  }));
}

// ─── Controllers ──────────────────────────────────────────────────────────────

export const SearchCustomersWithCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = searchCustomersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: parsed.error.format() });
      return;
    }
    const { search, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // Search all customers who have at least one booking in this branch.
    // Credit amounts are shown if they exist, but a customer with no credit
    // entries yet still appears in results so the manager can add credit.
    const customerWhere: any = {
      bookings: {
        some: { branchId: req.branch_Id },
      },
    };

    if (search && search.trim()) {
      const term = search.trim();
      customerWhere.user = {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { phone: { contains: term, mode: "insensitive" } },
        ],
      };
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where: customerWhere,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          publicId: true,
          user: { select: { name: true, phone: true } },
        },
      }),
      prisma.customer.count({ where: customerWhere }),
    ]);

    // Fetch pending credit totals for the returned customers in one query
    const customerIds = customers.map((c) => c.id);
    const aggregates = await prisma.customerCreditEntry.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: customerIds },
        branchId: req.branch_Id,
        status: { in: [CreditStatus.PENDING, CreditStatus.PARTIALLY_CLEARED] },
      },
      _sum: { pendingAmount: true },
    });
    const aggMap = new Map(aggregates.map((a) => [a.customerId, a._sum.pendingAmount]));

    const data = customers.map((c) => ({
      customerPublicId: c.publicId,
      name: c.user.name,
      phone: c.user.phone,
      totalPending: aggMap.get(c.id) ?? 0,
    }));

    res.status(StatusCode.OK).json({ data, total, page, limit });
  } catch (error) {
    console.error("SearchCustomersWithCredit Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetCustomerCreditSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { publicId: req.params.customerId },
      select: {
        id: true,
        publicId: true,
        user: { select: { name: true, phone: true, email: true } },
      },
    });
    if (!customer) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
      return;
    }

    // Verify the customer has at least one booking in this branch
    const hasBooking = await prisma.booking.findFirst({
      where: { customerId: customer.id, branchId: req.branch_Id },
      select: { id: true },
    });
    if (!hasBooking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found in this branch" });
      return;
    }

    const agg = await prisma.customerCreditEntry.aggregate({
      where: { customerId: customer.id, branchId: req.branch_Id },
      _sum: { totalAmount: true, clearedAmount: true, pendingAmount: true },
      _count: { id: true },
    });

    res.status(StatusCode.OK).json({
      data: {
        customer: {
          publicId: customer.publicId,
          name: customer.user.name,
          phone: customer.user.phone,
          // Walk-in placeholder / tombstone emails are blank, never shown (#1).
          email: displayEmail(customer.user.email) ?? "",
        },
        stats: {
          totalEntries: agg._count.id,
          totalAmount: agg._sum.totalAmount ?? 0,
          clearedAmount: agg._sum.clearedAmount ?? 0,
          pendingAmount: agg._sum.pendingAmount ?? 0,
        },
      },
    });
  } catch (error) {
    console.error("GetCustomerCreditSummary Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetCustomerCreditEntries = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = getCustomerEntriesSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: parsed.error.format() });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const customer = await prisma.customer.findUnique({
      where: { publicId: req.params.customerId },
      select: { id: true },
    });
    if (!customer) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
      return;
    }

    const [entries, total] = await Promise.all([
      prisma.customerCreditEntry.findMany({
        where: { customerId: customer.id, branchId: req.branch_Id },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          booking: {
            select: {
              publicId: true,
              startAt: true,
              endAt: true,
              status: true,
              items: {
                select: {
                  vehicle: { select: { make: true, model: true, regNo: true } },
                },
                take: 1,
              },
            },
          },
          clearances: {
            orderBy: { clearedAt: "desc" },
          },
        },
      }),
      prisma.customerCreditEntry.count({
        where: { customerId: customer.id, branchId: req.branch_Id },
      }),
    ]);

    // Each clearance carries the payments it recorded (and their UPI proof photos)
    res.status(StatusCode.OK).json({ data: await withClearancePayments(entries), total, page, limit });
  } catch (error) {
    console.error("GetCustomerCreditEntries Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetEligibleBookingsForCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { publicId: req.params.customerId },
      select: { id: true },
    });
    if (!customer) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        customerId: customer.id,
        branchId: req.branch_Id,
        status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED] },
        // Exclude bookings whose credit is fully cleared
        NOT: { creditEntry: { status: CreditStatus.CLEARED } },
      },
      orderBy: { startAt: "desc" },
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        items: {
          select: {
            vehicle: { select: { make: true, model: true, regNo: true } },
          },
          take: 1,
        },
        creditEntry: {
          select: { status: true, pendingAmount: true },
        },
      },
    });

    const data = bookings.map((b) => ({
      publicId: b.publicId,
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      vehicle: b.items[0]?.vehicle ?? null,
      creditStatus: b.creditEntry?.status ?? null,
      pendingAmount: b.creditEntry?.pendingAmount ?? null,
    }));

    res.status(StatusCode.OK).json({ data });
  } catch (error) {
    console.error("GetEligibleBookingsForCredit Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetBookingChargesForCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingId },
      select: {
        id: true,
        branchId: true,
        totalBase: true,
        totalDiscount: true,
        totalTax: true,
        totalFinal: true,
        chargeEntries: {
          where: { finalAmount: { gt: 0 } },
          select: {
            moduleKey: true,
            label: true,
            finalAmount: true,
            chargeType: true,
          },
        },
        creditEntry: {
          select: { publicId: true, status: true, sections: true },
        },
      },
    });

    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }

    const existingSections: Section[] = (booking.creditEntry?.sections as unknown as Section[]) ?? [];
    const creditedKeys = new Set(existingSections.map((s) => s.sectionKey));

    const sections = booking.chargeEntries.map((ce) => ({
      sectionKey: ce.moduleKey,
      label: ce.label,
      amount: Number(ce.finalAmount),
      isCredited: creditedKeys.has(ce.moduleKey),
      isCleared: existingSections.find((s) => s.sectionKey === ce.moduleKey)?.isCleared ?? false,
      isCustom: false,
    }));

    res.status(StatusCode.OK).json({
      data: {
        bookingSummary: {
          totalBase: booking.totalBase,
          totalDiscount: booking.totalDiscount,
          totalTax: booking.totalTax,
          totalFinal: booking.totalFinal,
        },
        sections,
        existingCreditStatus: booking.creditEntry?.status ?? null,
        existingCreditPublicId: booking.creditEntry?.publicId ?? null,
      },
    });
  } catch (error) {
    console.error("GetBookingChargesForCredit Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const AddOrAppendCredit = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = addCreditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid request", errors: parsed.error.format() });
      return;
    }

    const actor = await buildActorContext(req);

    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingId },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        status: true,
        creditEntry: true,
      },
    });

    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }

    if (booking.status !== BookingStatus.PICKED_UP && booking.status !== BookingStatus.RETURNED) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Credit can only be added for picked-up or returned bookings" });
      return;
    }

    const newSections: Section[] = parsed.data.sections.map((s) => ({
      sectionKey: s.sectionKey,
      label: s.label,
      amount: s.amount,
      isCleared: false,
      clearedAt: null,
      clearedRef: null,
      isCustom: s.sectionKey.startsWith("custom_"),
    }));

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerCreditEntry.findUnique({
        where: { bookingId: booking.id },
      });

      let mergedSections: Section[];

      if (existing) {
        const existingSections: Section[] = existing.sections as unknown as Section[];
        const existingKeys = new Set(existingSections.map((s) => s.sectionKey));
        const duplicates = newSections.filter((s) => existingKeys.has(s.sectionKey));
        if (duplicates.length > 0) {
          throw Object.assign(new Error("Duplicate section keys"), {
            code: "DUPLICATE_SECTION",
            keys: duplicates.map((s) => s.sectionKey),
          });
        }
        mergedSections = [...existingSections, ...newSections];
      } else {
        mergedSections = newSections;
      }

      const { totalAmount, clearedAmount, pendingAmount, status } = recalcAggregates(mergedSections);

      const entry = await tx.customerCreditEntry.upsert({
        where: { bookingId: booking.id },
        create: {
          publicId: createID(),
          customerId: booking.customerId,
          bookingId: booking.id,
          branchId: req.branch_Id,
          createdById: actor.actorId,
          sections: mergedSections as any,
          totalAmount,
          clearedAmount,
          pendingAmount,
          status,
        },
        update: {
          sections: mergedSections as any,
          totalAmount,
          clearedAmount,
          pendingAmount,
          status,
        },
      });

      return entry;
    });

    res.status(StatusCode.OK).json({ message: "Credit added successfully", data: result });
  } catch (error: any) {
    if (error?.code === "DUPLICATE_SECTION") {
      res.status(StatusCode.CONFLICT).json({ message: "Some sections are already credited", keys: error.keys });
      return;
    }
    console.error("AddOrAppendCredit Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetCreditEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const entry = await prisma.customerCreditEntry.findUnique({
      where: { publicId: req.params.creditId },
      include: {
        clearances: { orderBy: { clearedAt: "desc" } },
        booking: {
          select: {
            publicId: true,
            startAt: true,
            endAt: true,
            status: true,
            items: {
              select: {
                vehicle: { select: { make: true, model: true, regNo: true } },
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!entry || entry.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Credit entry not found" });
      return;
    }

    const [withPayments] = await withClearancePayments([entry]);
    res.status(StatusCode.OK).json({ data: withPayments });
  } catch (error) {
    console.error("GetCreditEntry Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ClearCreditSections = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = clearCreditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid request", errors: parsed.error.format() });
      return;
    }

    const actor = await buildActorContext(req);
    const { sectionKeys, transactionRef, notes } = parsed.data;
    // ONLINE is the older name for a UPI payment
    const method = parsed.data.paymentMethod === "ONLINE" ? "UPI" : parsed.data.paymentMethod;

    // The money arrives now (#11): UPI (and a split's UPI part) is backed by a photo
    // of the customer's payment screen or a 12-digit UTR, like every counter UPI.
    const upi: CounterUpi | null =
      method === "UPI" || method === "SPLIT"
        ? await resolveCounterUpi({ utr: transactionRef, proofFileId: parsed.data.proof_file_id, branchId: req.branch_Id })
        : null;

    const result = await prisma.$transaction(async (tx) => {
      const found = await tx.customerCreditEntry.findUnique({
        where: { publicId: req.params.creditId },
        select: { id: true, bookingId: true, branchId: true },
      });
      if (!found || found.branchId !== req.branch_Id) {
        throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
      }
      // One credit change at a time per booking (Fleet credits and clearances)
      await lockBookingCredit(tx, found.bookingId);
      const entry = await tx.customerCreditEntry.findUniqueOrThrow({ where: { id: found.id } });

      // A cancelled booking owes nothing — its pending credit is closed, never
      // collected (a payment recorded here would be money for a rental that didn't happen)
      const creditBooking = await tx.booking.findUniqueOrThrow({
        where: { id: entry.bookingId },
        select: { status: true },
      });
      if (creditBooking.status === BookingStatus.CANCELLED || creditBooking.status === BookingStatus.HOLD_EXPIRED) {
        throw Object.assign(new Error("Booking cancelled"), { code: "BOOKING_CANCELLED" });
      }

      const sections: Section[] = entry.sections as unknown as Section[];

      // Validate all requested keys exist
      const sectionMap = new Map(sections.map((s) => [s.sectionKey, s]));
      for (const key of sectionKeys) {
        if (!sectionMap.has(key)) {
          throw Object.assign(new Error("Section key not found"), {
            code: "KEY_NOT_FOUND",
            key,
          });
        }
      }

      // What is cleared, grouped by what it pays for (sections the BM added
      // by hand have no purpose: return charges → REMAINING_BALANCE)
      let amountCleared = new Decimal(0);
      const byPurpose = new Map<PaymentPurpose, Decimal>();
      for (const s of sections) {
        if (!sectionKeys.includes(s.sectionKey)) continue;
        if (s.isCleared) {
          throw Object.assign(new Error("Section already cleared"), {
            code: "ALREADY_CLEARED",
            key: s.sectionKey,
          });
        }
        const amount = new Decimal(String(s.amount)).toDecimalPlaces(2);
        amountCleared = amountCleared.add(amount);
        const purpose = s.purpose ?? PaymentPurpose.REMAINING_BALANCE;
        byPurpose.set(purpose, (byPurpose.get(purpose) ?? new Decimal(0)).add(amount));
      }

      // Split: the parts must add up to what is cleared
      let cashTotal = method === "CASH" ? amountCleared : new Decimal(0);
      if (method === "SPLIT") {
        const cash = new Decimal(parsed.data.cashAmount ?? 0).toDecimalPlaces(2);
        const online = new Decimal(parsed.data.onlineAmount ?? 0).toDecimalPlaces(2);
        if (!cash.add(online).eq(amountCleared)) {
          throw Object.assign(new Error("Split mismatch"), {
            code: "SPLIT_AMOUNT_MISMATCH",
            amount: amountCleared.toFixed(2),
          });
        }
        cashTotal = cash;
      }

      // Never record more than the booking still owes (credit stays inside what is
      // due; money awaiting confirmation counts as paid here). A legacy drop's
      // SET_OFF deposit counts against the return charges only, never against money
      // on credit (what is left of it is refunded in Settlements).
      const [owed, money] = await Promise.all([
        computeBookingOwed(entry.bookingId, tx),
        getBookingMoney(entry.bookingId, tx),
      ]);
      const due = Decimal.max(0, unpaidBesideDepositRemainder(owed, money.netConfirmed).sub(money.pending));
      // A section the BM added by hand (bookkeeping before credit recorded money)
      // whose charge was already paid through the booking's payments: nothing is
      // owed any more, so it is cleared without recording the money a second time.
      const selected = sections.filter((s) => sectionKeys.includes(s.sectionKey));
      const alreadyPaid = due.lte(0.005) && selected.every((s) => s.source !== "FLEET_CREDIT");
      if (!alreadyPaid && amountCleared.gt(due.add(0.01))) {
        throw Object.assign(new Error("Exceeds due"), {
          code: "CREDIT_EXCEEDS_DUE",
          due: due.toFixed(2),
          amount: amountCleared.toFixed(2),
        });
      }

      if (upi && !alreadyPaid) await claimCounterUpi(upi, tx as any);

      const clearance = await tx.creditClearance.create({
        data: {
          publicId: createID(),
          creditEntryId: entry.id,
          clearedSectionKeys: sectionKeys,
          amountCleared: amountCleared.toFixed(2),
          // ALREADY_PAID: no money recorded (the booking's payments already cover it)
          paymentMethod: alreadyPaid ? "ALREADY_PAID" : method,
          transactionRef: alreadyPaid ? null : (upi?.utr ?? transactionRef?.trim() ?? null),
          clearedById: actor.actorId,
        },
      });

      // The money arrives with the manager now: CONFIRMED PaymentTransaction(s) —
      // one per purpose, cash allocated first — on the manager's open shift if any,
      // so the financial state, settlement, shifts and reports see it.
      const shift = await tx.cashShift.findFirst({
        where: { employeeId: actor.actorId, status: "OPEN" },
        select: { id: true },
      });
      const now = new Date();
      let cashLeft = cashTotal;
      const payments: Array<{ publicId: string; purpose: string; method: string; totalAmount: string }> = [];
      for (const [purpose, amount] of alreadyPaid ? [] : byPurpose) {
        const cashPart = Decimal.min(cashLeft, amount);
        cashLeft = cashLeft.sub(cashPart);
        const onlinePart = amount.sub(cashPart);
        const txnMethod = cashPart.gt(0) && onlinePart.gt(0) ? "SPLIT" : cashPart.gt(0) ? "CASH" : "ONLINE";
        const txn = await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `${CREDIT_CLEAR_KEY_PREFIX}${clearance.publicId}:${purpose}`,
            bookingId: entry.bookingId,
            branchId: entry.branchId,
            purpose,
            method: txnMethod,
            status: "CONFIRMED",
            totalAmount: amount.toFixed(2),
            cashAmount: cashPart.toFixed(2),
            onlineAmount: onlinePart.toFixed(2),
            onlineTransactionRef: onlinePart.gt(0) ? (upi?.utr ?? null) : null,
            onlineGateway: onlinePart.gt(0) ? "UPI" : null,
            proofFileId: onlinePart.gt(0) ? (upi?.proof?.id ?? null) : null,
            collectedById: actor.actorId,
            collectedAt: now,
            confirmedById: actor.actorId,
            confirmedAt: now,
            cashShiftId: shift?.id ?? null,
            notes: notes?.trim() || `Customer credit cleared (${clearance.publicId})`,
          },
        });
        payments.push({ publicId: txn.publicId, purpose, method: txnMethod, totalAmount: amount.toFixed(2) });
      }

      const nowISO = now.toISOString();
      const paymentIds = payments.map((p) => p.publicId);
      const updatedSections = sections.map((s) =>
        sectionKeys.includes(s.sectionKey)
          ? {
              ...s,
              isCleared: true,
              clearedAt: nowISO,
              clearedRef: alreadyPaid ? "ALREADY_PAID" : (upi?.utr ?? transactionRef?.trim() ?? clearance.publicId),
              clearedPaymentPublicIds: paymentIds,
            }
          : s,
      );
      const { clearedAmount, pendingAmount, status } = recalcAggregates(updatedSections);

      const updated = await tx.customerCreditEntry.update({
        where: { id: entry.id },
        data: {
          sections: updatedSections as any,
          clearedAmount,
          pendingAmount,
          status,
        },
        include: {
          clearances: { orderBy: { clearedAt: "desc" } },
          booking: { select: { publicId: true, status: true, isAdvancePayment: true } },
        },
      });

      return { updated, payments, amountCleared, alreadyPaid, clearancePublicId: clearance.publicId };
    }, { timeout: 15000 });

    const { updated, payments, amountCleared, alreadyPaid } = result;
    const bookingId = updated.bookingId;

    // The invoice follows the money: a returned booking's invoice is rebuilt (PAID
    // once settled); before return, a fully paid booking's PENDING invoice turns PAID.
    (async () => {
      if (updated.booking.status === BookingStatus.RETURNED) {
        const legacy = await syncLegacyReturnInvoice(bookingId);
        if (!legacy) {
          const { isSettled } = await settlementEngineService.calculateSettlement(bookingId);
          await finalizeInvoice(bookingId, { markPaid: isSettled });
        }
      } else if (updated.status === CreditStatus.CLEARED && !updated.booking.isAdvancePayment) {
        const { isSettled } = await settlementEngineService.calculateSettlement(bookingId);
        if (isSettled) {
          await prisma.invoice.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "PAID" } });
        }
      }
    })().catch((err) => console.error("[ClearCreditSections] Invoice sync failed:", err));

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: req.branch_Id,
      action: "CUSTOMER_CREDIT_CLEARED",
      category: AuditCategory.PAYMENT,
      description: alreadyPaid
        ? `Customer credit ₹${amountCleared.toFixed(2)} cleared on booking ${updated.booking.publicId} — already paid through the booking's payments, no new payment recorded`
        : `Customer credit ₹${amountCleared.toFixed(2)} cleared by ${method} on booking ${updated.booking.publicId}`,
      entity: "CustomerCreditEntry",
      entityId: updated.publicId,
      entityLabel: updated.booking.publicId,
      metadata: {
        sectionKeys,
        method: alreadyPaid ? "ALREADY_PAID" : method,
        amount: amountCleared.toFixed(2),
        payments,
        ...(upi?.proof && !alreadyPaid && { proofFileId: upi.proof.publicId }),
      },
    });
    staffActivityService
      .logFromRequest(req, {
        actionType: StaffActionType.SETTLED,
        entityType: StaffEntityType.PAYMENT,
        entityRef: updated.booking.publicId,
        description: `Customer credit ₹${amountCleared.toFixed(2)} cleared (${alreadyPaid ? "already paid" : method})`,
        metadata: { sectionKeys, method: alreadyPaid ? "ALREADY_PAID" : method, payments },
      })
      .catch(() => {});

    const [withPayments] = await withClearancePayments([updated]);
    res.status(StatusCode.OK).json({
      message: alreadyPaid
        ? "Credit cleared — the booking's payments already cover it, so no new payment was recorded."
        : "Credit cleared successfully",
      data: { ...withPayments, payments, alreadyPaid },
    });
  } catch (error: any) {
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    if (error?.code === "NOT_FOUND") {
      res.status(StatusCode.NOT_FOUND).json({ message: "Credit entry not found" });
      return;
    }
    if (error?.code === "BOOKING_CANCELLED") {
      res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "BOOKING_CANCELLED",
        message: "This booking was cancelled, so nothing is owed on it — its credit can't be collected.",
      });
      return;
    }
    if (error?.code === "SPLIT_AMOUNT_MISMATCH") {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "SPLIT_AMOUNT_MISMATCH",
        message: `The cash and UPI parts must add up to ₹${error.amount} (the sections being cleared).`,
      });
      return;
    }
    if (error?.code === "CREDIT_EXCEEDS_DUE") {
      res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "CREDIT_EXCEEDS_DUE",
        message: `This booking only has ₹${error.due} still due — clearing ₹${error.amount} would record more than is owed. Check the booking's payments first.`,
        due: error.due,
      });
      return;
    }
    if (error?.code === "ALREADY_CLEARED") {
      res.status(StatusCode.BAD_REQUEST).json({ message: `Section "${error.key}" is already cleared` });
      return;
    }
    if (error?.code === "KEY_NOT_FOUND") {
      res.status(StatusCode.BAD_REQUEST).json({ message: `Section key "${error.key}" not found in credit entry` });
      return;
    }
    console.error("ClearCreditSections Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
