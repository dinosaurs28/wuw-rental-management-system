import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, CreditStatus } from "@repo/database/client";

import {
  searchCustomersSchema,
  getCustomerEntriesSchema,
  addCreditSchema,
  clearCreditSchema,
} from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";

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

type Section = {
  sectionKey: string;
  label: string;
  amount: number;
  isCleared: boolean;
  clearedAt?: string | null;
  clearedRef?: string | null;
  isCustom?: boolean;
};

function recalcAggregates(sections: Section[]) {
  const totalAmount = sections.reduce((sum, s) => sum + s.amount, 0);
  const clearedAmount = sections.filter((s) => s.isCleared).reduce((sum, s) => sum + s.amount, 0);
  const pendingAmount = totalAmount - clearedAmount;
  let status: CreditStatus = CreditStatus.PENDING;
  if (pendingAmount === 0) status = CreditStatus.CLEARED;
  else if (clearedAmount > 0) status = CreditStatus.PARTIALLY_CLEARED;
  return { totalAmount, clearedAmount, pendingAmount, status };
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
          email: customer.user.email,
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

    res.status(StatusCode.OK).json({ data: entries, total, page, limit });
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

    const existingSections: Section[] = (booking.creditEntry?.sections as Section[]) ?? [];
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
        const existingSections: Section[] = existing.sections as Section[];
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
          sections: mergedSections,
          totalAmount,
          clearedAmount,
          pendingAmount,
          status,
        },
        update: {
          sections: mergedSections,
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

    res.status(StatusCode.OK).json({ data: entry });
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
    const { sectionKeys, paymentMethod, transactionRef } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.customerCreditEntry.findUnique({
        where: { publicId: req.params.creditId },
      });

      if (!entry || entry.branchId !== req.branch_Id) {
        throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
      }

      const sections: Section[] = entry.sections as Section[];
      let amountCleared = 0;
      const nowISO = new Date().toISOString();

      const updatedSections = sections.map((s) => {
        if (!sectionKeys.includes(s.sectionKey)) return s;
        if (s.isCleared) {
          throw Object.assign(new Error("Section already cleared"), {
            code: "ALREADY_CLEARED",
            key: s.sectionKey,
          });
        }
        amountCleared += s.amount;
        return {
          ...s,
          isCleared: true,
          clearedAt: nowISO,
          clearedRef: transactionRef ?? null,
        };
      });

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

      const { totalAmount, clearedAmount, pendingAmount, status } = recalcAggregates(updatedSections);

      await tx.creditClearance.create({
        data: {
          publicId: createID(),
          creditEntryId: entry.id,
          clearedSectionKeys: sectionKeys,
          amountCleared,
          paymentMethod,
          transactionRef: transactionRef ?? null,
          clearedById: actor.actorId,
        },
      });

      const updated = await tx.customerCreditEntry.update({
        where: { id: entry.id },
        data: {
          sections: updatedSections,
          clearedAmount,
          pendingAmount,
          status,
        },
        include: {
          clearances: { orderBy: { clearedAt: "desc" } },
        },
      });

      return updated;
    });

    res.status(StatusCode.OK).json({ message: "Credit cleared successfully", data: result });
  } catch (error: any) {
    if (error?.code === "NOT_FOUND") {
      res.status(StatusCode.NOT_FOUND).json({ message: "Credit entry not found" });
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
