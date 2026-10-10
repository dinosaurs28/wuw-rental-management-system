/**
 * Branch Manager — Customers tab (Oct 3 batch, item 13).
 *
 *   GET  /api/branchManager/customers                         list (search, filter, paginate)
 *   GET  /api/branchManager/customers/:customerId             detail + rents + pending credit
 *   GET  /api/branchManager/customers/:customerId/rents       one rents bucket, paginated
 *   GET  /api/branchManager/customers/:customerId/bookings/:bookingId
 *                                                             booking drawer (amounts + payments)
 *   POST /api/branchManager/customers/:customerId/blacklist   { reason }
 *   POST /api/branchManager/customers/:customerId/unblacklist { note? }
 *
 * Fleet Executives get the same handlers at /api/employee/customers (EmployeeCheck);
 * "my branch" is req.branch_Id and the actor is req.public_Id in both portals.
 *
 * Every registered customer is listed (not only the branch's own), and rents
 * cover every branch with the branch named, so a manager sees the whole history
 * before blacklisting. `:customerId` is the Customer publicId (the id the
 * credit-ledger pages use); the customer's User publicId is accepted too.
 *
 * Money is returned as 2-dp strings. Amounts come from the stored booking
 * columns and the shared owed / financial-state computations, never re-priced.
 */
import { Request, Response } from "express";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  CreditStatus,
  LedgerEntryClassification,
  LedgerEntryType,
  PaymentSessionStatus,
  PaymentSessionType,
  Role,
} from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { maskAadhaar } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import {
  displayEmail,
  getMissingProfileFields,
  profileFieldsOf,
} from "../../utils/customer/identity.js";
import { bookingListTypeOf } from "../../utils/booking/bookingTypeFilter.js";
import { getClientIp } from "../../utils/clientIp.js";
import {
  computeBookingOwed,
  summarizeBookingMoney,
  REFUND_PAYMENT_PURPOSES,
} from "../../services/payment/booking-owed.service.js";
import { financialStateService } from "../../services/payment/financial-state.service.js";
import {
  LEGACY_RETURN_CHARGE_TYPES,
  chargeEntryGst,
} from "../../services/charges/legacy-return-charges.service.js";
import { generatePresignedUrl } from "../../services/r2-upload.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import {
  AUDIT_CUSTOMER_BLACKLISTED,
  AUDIT_CUSTOMER_BLACKLIST_REMOVED,
  BLACKLIST_REASON_MAX,
  BLACKLIST_REASON_MIN,
  invalidateCustomerSearchCache,
  maskDrivingLicence,
} from "../../services/customer/customer-blacklist.service.js";

const ZERO = new Decimal(0);
/** Presigned payment-proof photo links live this long (seconds). */
const PROOF_URL_TTL_SECONDS = 900;

type DecimalLike = { toString(): string } | number | string;
const dec = (v: DecimalLike | null | undefined) => new Decimal(v == null ? "0" : v.toString());
const money = (v: DecimalLike | null | undefined) =>
  dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const PENDING_CREDIT_STATUSES: CreditStatus[] = [CreditStatus.PENDING, CreditStatus.PARTIALLY_CLEARED];

// ── Rents buckets ────────────────────────────────────────────────────────────
// upcoming = CONFIRMED + HOLD still awaiting payment (unexpired)
// active   = PICKED_UP (vehicle out, overdue or not)
// past     = RETURNED + CANCELLED
// Expired holds (HOLD_EXPIRED, or HOLD past holdExpiresAt) never became rents
// and are left out.

export type RentBucket = "upcoming" | "active" | "past";
const RENT_BUCKETS: readonly RentBucket[] = ["upcoming", "active", "past"];

function bucketWhere(bucket: RentBucket, now: Date): Prisma.BookingWhereInput {
  switch (bucket) {
    case "upcoming":
      return {
        OR: [
          { status: BookingStatus.CONFIRMED },
          {
            status: BookingStatus.HOLD,
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      };
    case "active":
      return { status: BookingStatus.PICKED_UP };
    case "past":
      return { status: { in: [BookingStatus.RETURNED, BookingStatus.CANCELLED] } };
  }
}

function bucketOrder(bucket: RentBucket): Prisma.BookingOrderByWithRelationInput[] {
  if (bucket === "upcoming") return [{ startAt: "asc" }, { id: "asc" }];
  if (bucket === "active") return [{ endAt: "asc" }, { id: "asc" }];
  return [{ startAt: "desc" }, { id: "desc" }];
}

function bucketOf(status: BookingStatus): RentBucket {
  if (status === BookingStatus.PICKED_UP) return "active";
  if (status === BookingStatus.RETURNED || status === BookingStatus.CANCELLED) return "past";
  return "upcoming";
}

/** Any booking that counts as a rent (every bucket). */
function anyRentWhere(now: Date): Prisma.BookingWhereInput {
  return { OR: RENT_BUCKETS.map((b) => bucketWhere(b, now)) };
}

const RENT_SELECT = {
  id: true,
  publicId: true,
  status: true,
  rentalPeriodType: true,
  startAt: true,
  endAt: true,
  originalEndAt: true,
  returnedAt: true,
  cancelledAt: true,
  holdExpiresAt: true,
  createdAt: true,
  totalFinal: true,
  totalDeposit: true,
  extensionCount: true,
  paymentStatus: true,
  branch: { select: { id: true, publicId: true, name: true } },
  createdBy: { select: { role: true } },
  items: { select: { vehicle: { select: { publicId: true, make: true, model: true, regNo: true } } } },
  creditEntry: { select: { pendingAmount: true, status: true } },
} satisfies Prisma.BookingSelect;

type RentRow = Prisma.BookingGetPayload<{ select: typeof RENT_SELECT }>;

/** ONLINE = the customer booked it themselves; COUNTER = staff walk-in. */
const bookingSource = (creatorRole: Role | null | undefined) =>
  creatorRole === Role.CUSTOMER ? "ONLINE" : "COUNTER";

async function loadRents(
  customerId: number,
  bucket: RentBucket,
  opts: { skip: number; take: number; branchId: number; now: Date },
) {
  const where: Prisma.BookingWhereInput = {
    customerId,
    deletedAt: null,
    ...bucketWhere(bucket, opts.now),
  };
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: bucketOrder(bucket),
      skip: opts.skip,
      take: opts.take,
      select: RENT_SELECT,
    }),
    prisma.booking.count({ where }),
  ]);
  return { items: await toRentViews(rows, opts.branchId, opts.now), total };
}

async function toRentViews(rows: RentRow[], branchId: number, now: Date) {
  if (rows.length === 0) return [];
  const txns = await prisma.paymentTransaction.findMany({
    where: { bookingId: { in: rows.map((r) => r.id) } },
    select: { bookingId: true, purpose: true, status: true, totalAmount: true },
  });
  const txnsByBooking = new Map<number, typeof txns>();
  for (const t of txns) {
    const list = txnsByBooking.get(t.bookingId) ?? [];
    list.push(t);
    txnsByBooking.set(t.bookingId, list);
  }

  return rows.map((b) => {
    const paid = summarizeBookingMoney(txnsByBooking.get(b.id) ?? []);
    const creditPending =
      b.creditEntry && PENDING_CREDIT_STATUSES.includes(b.creditEntry.status)
        ? dec(b.creditEntry.pendingAmount)
        : ZERO;
    return {
      publicId: b.publicId,
      status: b.status,
      bucket: bucketOf(b.status),
      /** HOLD — the customer hasn't paid yet */
      awaitingPayment: b.status === BookingStatus.HOLD,
      type: bookingListTypeOf(b.rentalPeriodType),
      source: bookingSource(b.createdBy?.role),
      branch: { publicId: b.branch.publicId, name: b.branch.name },
      isOwnBranch: b.branch.id === branchId,
      vehicles: b.items.map((i) => ({
        publicId: i.vehicle.publicId,
        make: i.vehicle.make,
        model: i.vehicle.model,
        regNo: i.vehicle.regNo,
      })),
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      originalEndAt: iso(b.originalEndAt),
      returnedAt: iso(b.returnedAt),
      cancelledAt: iso(b.cancelledAt),
      holdExpiresAt: b.status === BookingStatus.HOLD ? iso(b.holdExpiresAt) : null,
      createdAt: b.createdAt.toISOString(),
      isOverdue: b.status === BookingStatus.PICKED_UP && b.endAt.getTime() < now.getTime(),
      extensionCount: b.extensionCount,
      paymentStatus: b.paymentStatus,
      amounts: {
        /** Booking total: rent incl. GST + refundable deposit + confirmed extensions */
        totalFinal: money(b.totalFinal),
        /** totalFinal without the refundable deposit */
        rentAmount: money(dec(b.totalFinal).sub(dec(b.totalDeposit))),
        refundableDeposit: money(b.totalDeposit),
        /** Confirmed money in less refunds paid out */
        paid: money(paid.netConfirmed),
        /** Collected, awaiting the manager's cash confirmation */
        pendingConfirmation: money(paid.pending),
        /** Customer credit still owed on this booking */
        creditPending: money(creditPending),
      },
    };
  });
}

// ── Customer lookup ──────────────────────────────────────────────────────────

const CUSTOMER_SELECT = {
  id: true,
  publicId: true,
  alternatePhone: true,
  addressLine1: true,
  city: true,
  state: true,
  zipCode: true,
  country: true,
  drivingLicenceNumber: true,
  aadhaarNumber: true,
  isBlacklisted: true,
  blacklistReason: true,
  blacklistedAt: true,
  blacklistedById: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      publicId: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

/** Active (not deleted) customer by Customer publicId or User publicId. */
async function findCustomer(id: string | undefined): Promise<CustomerRow | null> {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return prisma.customer.findFirst({
    where: {
      deletedAt: null,
      user: { role: Role.CUSTOMER, deletedAt: null },
      OR: [{ publicId: key }, { user: { publicId: key } }],
    },
    select: CUSTOMER_SELECT,
  });
}

const customerNotFound = (res: Response) =>
  res.status(StatusCode.NOT_FOUND).json({
    success: false,
    code: "CUSTOMER_NOT_FOUND",
    message: "Customer not found.",
  });

async function blacklistedByView(userId: number | null) {
  if (!userId) return null;
  const by = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, branch: { select: { publicId: true, name: true } } },
  });
  return by
    ? { name: by.name, role: by.role, branch: by.branch ? { publicId: by.branch.publicId, name: by.branch.name } : null }
    : null;
}

async function loadActor(req: Request) {
  return prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true },
  });
}

// ── Query parsing ────────────────────────────────────────────────────────────

const LIST_FILTERS = ["all", "blacklisted", "credit", "branch"] as const;
type ListFilter = (typeof LIST_FILTERS)[number];

function intParam(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

const badQuery = (res: Response, message: string) =>
  res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "INVALID_QUERY", message });

/** Phone fragments to match: as typed, digits only, and the last 10 digits of a +91 number. */
function phoneTerms(search: string): string[] {
  const terms = new Set<string>();
  if (/^[+\d\s()-]+$/.test(search)) terms.add(search.replace(/[\s()-]/g, ""));
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 3) terms.add(digits);
  if (digits.length > 10) terms.add(digits.slice(-10));
  return [...terms].filter((t) => t.length > 0);
}

// ── GET /customers ───────────────────────────────────────────────────────────

export const ListCustomers = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const page = intParam(req.query.page, 1, 1, 100000);
    const limit = intParam(req.query.limit, 20, 1, 100);
    if (page === null) return badQuery(res, "page must be a whole number of 1 or more.");
    if (limit === null) return badQuery(res, "limit must be a whole number from 1 to 100.");

    const rawFilter = typeof req.query.filter === "string" ? req.query.filter.trim().toLowerCase() : "";
    const filter: ListFilter = (rawFilter || "all") as ListFilter;
    if (!LIST_FILTERS.includes(filter)) {
      return badQuery(res, "filter must be all, blacklisted, credit or branch.");
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const now = new Date();

    const and: Prisma.CustomerWhereInput[] = [];
    if (search) {
      const or: Prisma.CustomerWhereInput[] = [
        { user: { name: { contains: search, mode: "insensitive" } } },
      ];
      for (const term of phoneTerms(search)) {
        or.push({ user: { phone: { contains: term } } });
        or.push({ alternatePhone: { contains: term } });
      }
      and.push({ OR: or });
    }
    if (filter === "blacklisted") and.push({ isBlacklisted: true });
    if (filter === "credit") {
      and.push({
        creditEntries: {
          some: { status: { in: PENDING_CREDIT_STATUSES }, pendingAmount: { gt: 0 } },
        },
      });
    }
    if (filter === "branch") {
      and.push({ bookings: { some: { branchId, deletedAt: null, ...anyRentWhere(now) } } });
    }

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      user: { role: Role.CUSTOMER, deletedAt: null },
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: CUSTOMER_SELECT,
      }),
      prisma.customer.count({ where }),
    ]);

    const ids = customers.map((c) => c.id);
    const [statusCounts, liveHolds, ownBranch, credit] = ids.length
      ? await Promise.all([
          prisma.booking.groupBy({
            by: ["customerId", "status"],
            where: {
              customerId: { in: ids },
              deletedAt: null,
              status: {
                in: [
                  BookingStatus.CONFIRMED,
                  BookingStatus.PICKED_UP,
                  BookingStatus.RETURNED,
                  BookingStatus.CANCELLED,
                ],
              },
            },
            _count: { _all: true },
            _max: { startAt: true },
          }),
          prisma.booking.groupBy({
            by: ["customerId"],
            where: {
              customerId: { in: ids },
              deletedAt: null,
              status: BookingStatus.HOLD,
              OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
            },
            _count: { _all: true },
            _max: { startAt: true },
          }),
          prisma.booking.groupBy({
            by: ["customerId"],
            where: { customerId: { in: ids }, deletedAt: null, branchId, ...anyRentWhere(now) },
            _count: { _all: true },
          }),
          prisma.customerCreditEntry.groupBy({
            by: ["customerId", "branchId"],
            where: { customerId: { in: ids }, status: { in: PENDING_CREDIT_STATUSES } },
            _sum: { pendingAmount: true },
          }),
        ])
      : [[], [], [], []];

    type Counts = { upcoming: number; active: number; past: number; lastRentAt: Date | null };
    const counts = new Map<number, Counts>();
    const countsOf = (id: number) => {
      let c = counts.get(id);
      if (!c) {
        c = { upcoming: 0, active: 0, past: 0, lastRentAt: null };
        counts.set(id, c);
      }
      return c;
    };
    const bumpLast = (c: Counts, d: Date | null | undefined) => {
      if (d && (!c.lastRentAt || d > c.lastRentAt)) c.lastRentAt = d;
    };
    for (const row of statusCounts) {
      const c = countsOf(row.customerId);
      c[bucketOf(row.status)] += row._count._all;
      bumpLast(c, row._max.startAt);
    }
    for (const row of liveHolds) {
      const c = countsOf(row.customerId);
      c.upcoming += row._count._all;
      bumpLast(c, row._max.startAt);
    }
    const atBranch = new Set(ownBranch.map((r) => r.customerId));
    const creditAll = new Map<number, Decimal>();
    const creditHere = new Map<number, Decimal>();
    for (const row of credit) {
      const amt = dec(row._sum.pendingAmount);
      creditAll.set(row.customerId, (creditAll.get(row.customerId) ?? ZERO).add(amt));
      if (row.branchId === branchId) {
        creditHere.set(row.customerId, (creditHere.get(row.customerId) ?? ZERO).add(amt));
      }
    }

    const data = customers.map((c) => {
      const n = counts.get(c.id) ?? { upcoming: 0, active: 0, past: 0, lastRentAt: null };
      return {
        customerPublicId: c.publicId,
        userPublicId: c.user.publicId,
        name: c.user.name,
        phone: c.user.phone,
        alternatePhone: c.alternatePhone ?? null,
        // Walk-in placeholder emails are never shown (#1).
        email: displayEmail(c.user.email),
        registeredAt: c.user.createdAt.toISOString(),
        isProfileCompleted: getMissingProfileFields(profileFieldsOf(c.user, c)).length === 0,
        isBlacklisted: c.isBlacklisted,
        blacklistReason: c.isBlacklisted ? c.blacklistReason : null,
        blacklistedAt: c.isBlacklisted ? iso(c.blacklistedAt) : null,
        rents: {
          upcoming: n.upcoming,
          active: n.active,
          past: n.past,
          total: n.upcoming + n.active + n.past,
        },
        lastRentAt: iso(n.lastRentAt),
        hasRentAtBranch: atBranch.has(c.id),
        /** Σ pending CustomerCreditEntry, every branch */
        pendingCredit: money(creditAll.get(c.id)),
        /** The part of pendingCredit owed at the manager's branch */
        pendingCreditAtBranch: money(creditHere.get(c.id)),
      };
    });

    return res.status(StatusCode.OK).json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("ListCustomers Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't load customers. Please try again.",
    });
  }
};

// ── GET /customers/:customerId ───────────────────────────────────────────────

/** Rents per bucket returned with the customer detail; page further with /rents. */
const DETAIL_RENTS_PER_BUCKET = 20;

export const GetCustomer = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const customer = await findCustomer(req.params.customerId);
    if (!customer) return customerNotFound(res);

    const now = new Date();
    const opts = { skip: 0, take: DETAIL_RENTS_PER_BUCKET, branchId, now };
    const [upcoming, active, past, creditEntries, blacklistedBy] = await Promise.all([
      loadRents(customer.id, "upcoming", opts),
      loadRents(customer.id, "active", opts),
      loadRents(customer.id, "past", opts),
      prisma.customerCreditEntry.findMany({
        where: { customerId: customer.id, status: { in: PENDING_CREDIT_STATUSES } },
        orderBy: { createdAt: "desc" },
        select: {
          publicId: true,
          sections: true,
          totalAmount: true,
          clearedAmount: true,
          pendingAmount: true,
          status: true,
          createdAt: true,
          booking: { select: { publicId: true } },
          branch: { select: { id: true, publicId: true, name: true } },
        },
      }),
      customer.isBlacklisted ? blacklistedByView(customer.blacklistedById) : Promise.resolve(null),
    ]);

    let pendingCredit = ZERO;
    let pendingCreditAtBranch = ZERO;
    const credits = creditEntries.map((e) => {
      const pending = dec(e.pendingAmount);
      pendingCredit = pendingCredit.add(pending);
      if (e.branch.id === branchId) pendingCreditAtBranch = pendingCreditAtBranch.add(pending);
      const sections = Array.isArray(e.sections) ? (e.sections as unknown[]) : [];
      return {
        creditPublicId: e.publicId,
        bookingPublicId: e.booking.publicId,
        branch: { publicId: e.branch.publicId, name: e.branch.name },
        isOwnBranch: e.branch.id === branchId,
        status: e.status,
        totalAmount: money(e.totalAmount),
        clearedAmount: money(e.clearedAmount),
        pendingAmount: money(e.pendingAmount),
        createdAt: e.createdAt.toISOString(),
        // Sections still owed, as stored (label, amount, collateral note, …)
        pendingSections: sections.filter(
          (s): s is Record<string, unknown> =>
            !!s && typeof s === "object" && !(s as { isCleared?: unknown }).isCleared,
        ),
      };
    });

    const p = customer;
    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        customer: {
          customerPublicId: p.publicId,
          userPublicId: p.user.publicId,
          name: p.user.name,
          phone: p.user.phone,
          alternatePhone: p.alternatePhone ?? null,
          email: displayEmail(p.user.email),
          address: {
            line1: p.addressLine1,
            city: p.city,
            state: p.state,
            zipCode: p.zipCode,
            country: p.country,
          },
          registeredAt: p.user.createdAt.toISOString(),
          isProfileCompleted: getMissingProfileFields(profileFieldsOf(p.user, p)).length === 0,
          // Identity numbers are masked for the manager (#13).
          drivingLicenceNumberMasked: maskDrivingLicence(p.drivingLicenceNumber),
          aadhaarNumberMasked: p.aadhaarNumber ? maskAadhaar(p.aadhaarNumber) : null,
        },
        blacklist: {
          isBlacklisted: p.isBlacklisted,
          reason: p.isBlacklisted ? p.blacklistReason : null,
          blacklistedAt: p.isBlacklisted ? iso(p.blacklistedAt) : null,
          blacklistedBy,
        },
        credit: {
          pendingTotal: money(pendingCredit),
          pendingAtBranch: money(pendingCreditAtBranch),
          entries: credits,
        },
        rents: {
          upcoming: upcoming.items,
          active: active.items,
          past: past.items,
        },
        counts: {
          upcoming: upcoming.total,
          active: active.total,
          past: past.total,
        },
        hasMore: {
          upcoming: upcoming.total > upcoming.items.length,
          active: active.total > active.items.length,
          past: past.total > past.items.length,
        },
      },
    });
  } catch (error) {
    console.error("GetCustomer Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't load the customer. Please try again.",
    });
  }
};

// ── GET /customers/:customerId/rents?bucket=&page=&limit= ────────────────────

export const GetCustomerRents = async (req: Request, res: Response) => {
  try {
    const bucketRaw = typeof req.query.bucket === "string" ? req.query.bucket.trim().toLowerCase() : "";
    if (!RENT_BUCKETS.includes(bucketRaw as RentBucket)) {
      return badQuery(res, "bucket must be upcoming, active or past.");
    }
    const bucket = bucketRaw as RentBucket;
    const page = intParam(req.query.page, 1, 1, 100000);
    const limit = intParam(req.query.limit, DETAIL_RENTS_PER_BUCKET, 1, 50);
    if (page === null) return badQuery(res, "page must be a whole number of 1 or more.");
    if (limit === null) return badQuery(res, "limit must be a whole number from 1 to 50.");

    const customer = await findCustomer(req.params.customerId);
    if (!customer) return customerNotFound(res);

    const { items, total } = await loadRents(customer.id, bucket, {
      skip: (page - 1) * limit,
      take: limit,
      branchId: req.branch_Id,
      now: new Date(),
    });

    return res.status(StatusCode.OK).json({
      success: true,
      bucket,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("GetCustomerRents Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't load the rents. Please try again.",
    });
  }
};

// ── GET /customers/:customerId/bookings/:bookingId — booking drawer ──────────

/** Ledger entry types that are money or deposit movements, not drop charges. */
const NON_CHARGE_ENTRY_TYPES: LedgerEntryType[] = [
  LedgerEntryType.DEPOSIT,
  LedgerEntryType.PAYMENT,
  LedgerEntryType.REFUND,
  LedgerEntryType.CREDIT,
];

export const GetCustomerBooking = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const customer = await findCustomer(req.params.customerId);
    if (!customer) return customerNotFound(res);

    const booking = await prisma.booking.findFirst({
      where: { publicId: String(req.params.bookingId ?? ""), customerId: customer.id, deletedAt: null },
      select: {
        id: true,
        publicId: true,
        status: true,
        rentalPeriodType: true,
        days: true,
        startAt: true,
        endAt: true,
        originalEndAt: true,
        returnedAt: true,
        cancelledAt: true,
        cancellationReason: true,
        holdExpiresAt: true,
        createdAt: true,
        totalBase: true,
        totalDiscount: true,
        totalTax: true,
        totalDeposit: true,
        totalFinal: true,
        couponCode: true,
        paymentStatus: true,
        isAdvancePayment: true,
        advanceAmount: true,
        safetyDeposit: true,
        safetyDepositRefunded: true,
        safetyDepositSetOff: true,
        branch: { select: { id: true, publicId: true, name: true } },
        createdBy: { select: { name: true, role: true } },
        items: {
          select: {
            cgstAmount: true,
            sgstAmount: true,
            taxRate: true,
            vehicle: { select: { publicId: true, make: true, model: true, regNo: true } },
          },
        },
        extensions: {
          orderBy: { createdAt: "asc" },
          select: {
            publicId: true,
            extensionStatus: true,
            extensionTrigger: true,
            oldEndAt: true,
            requestedEndAt: true,
            actualNewEndAt: true,
            baseAmount: true,
            discountAmount: true,
            taxableAmount: true,
            taxAmount: true,
            cgstAmount: true,
            sgstAmount: true,
            taxRate: true,
            additionalAmount: true,
            createdAt: true,
          },
        },
        creditEntry: {
          select: {
            publicId: true,
            sections: true,
            totalAmount: true,
            clearedAmount: true,
            pendingAmount: true,
            status: true,
            createdAt: true,
            clearances: {
              orderBy: { clearedAt: "asc" },
              select: {
                publicId: true,
                amountCleared: true,
                paymentMethod: true,
                transactionRef: true,
                clearedAt: true,
                clearedBy: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "BOOKING_NOT_FOUND",
        message: "Booking not found for this customer.",
      });
    }

    const [owed, state, dropLines, legacyCharges, txns] = await Promise.all([
      computeBookingOwed(booking.id),
      financialStateService.getState(booking.id),
      // Drop bill (Unified Payments RETURN session) charge lines, as in computeBookingOwed
      prisma.ledgerEntry.findMany({
        where: {
          bookingId: booking.id,
          isVoided: false,
          entryType: { notIn: NON_CHARGE_ENTRY_TYPES },
          classification: { not: LedgerEntryClassification.PAYMENT },
          session: {
            sessionType: PaymentSessionType.RETURN,
            status: { not: PaymentSessionStatus.ABANDONED },
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          publicId: true,
          entryType: true,
          classification: true,
          description: true,
          amount: true,
          gstAmount: true,
        },
      }),
      // Legacy drop charges collected by the BM in Settlements
      prisma.chargeEntry.findMany({
        where: { bookingId: booking.id, chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
        orderBy: { createdAt: "asc" },
        select: {
          publicId: true,
          chargeType: true,
          label: true,
          finalAmount: true,
          gstAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          taxRate: true,
          notes: true,
        },
      }),
      prisma.paymentTransaction.findMany({
        where: { bookingId: booking.id },
        orderBy: { createdAt: "asc" },
        select: {
          publicId: true,
          purpose: true,
          method: true,
          status: true,
          totalAmount: true,
          cashAmount: true,
          onlineAmount: true,
          onlineTransactionRef: true,
          onlineGateway: true,
          collectedAt: true,
          confirmedAt: true,
          rejectedAt: true,
          rejectionReason: true,
          notes: true,
          createdAt: true,
          collectedBy: { select: { name: true } },
          confirmedBy: { select: { name: true } },
          proofFile: { select: { key: true, url: true, mime: true } },
        },
      }),
    ]);

    // ── Original rental (Booking.total* describe the original booking only) ──
    const base = dec(booking.totalBase);
    const discount = dec(booking.totalDiscount);
    const gst = dec(booking.totalTax);
    const deposit = dec(booking.totalDeposit);
    const taxable = base.sub(discount);
    const cgst = booking.items.reduce((s, i) => s.add(dec(i.cgstAmount)), ZERO);
    const sgst = booking.items.reduce((s, i) => s.add(dec(i.sgstAmount)), ZERO);
    // Older rows carry only the total; the split is shown only when it adds up.
    const splitKnown = gst.gt(0) && cgst.add(sgst).sub(gst).abs().lte("0.01");
    const gstRate = booking.items.find((i) => dec(i.taxRate).gt(0))?.taxRate ?? null;

    // ── Extensions (CONFIRMED ones are inside Booking.totalFinal) ──
    const extensions = booking.extensions.map((e) => ({
      publicId: e.publicId,
      status: e.extensionStatus,
      trigger: e.extensionTrigger,
      oldEndAt: e.oldEndAt.toISOString(),
      newEndAt: (e.actualNewEndAt ?? e.requestedEndAt).toISOString(),
      baseAmount: money(e.baseAmount),
      discountAmount: money(e.discountAmount),
      taxableAmount: money(e.taxableAmount),
      cgst: money(e.cgstAmount),
      sgst: money(e.sgstAmount),
      gst: money(e.taxAmount),
      gstRate: money(e.taxRate),
      amount: money(e.additionalAmount),
      includedInTotal: e.extensionStatus === "CONFIRMED",
      createdAt: e.createdAt.toISOString(),
    }));
    const extensionsTotal = booking.extensions
      .filter((e) => e.extensionStatus === "CONFIRMED")
      .reduce((s, e) => s.add(dec(e.additionalAmount)), ZERO);

    // ── Return / drop charges (outside totalFinal) ──
    const returnChargeItems = [
      ...dropLines.map((l) => {
        const amount = dec(l.amount);
        const lineGst = l.classification === LedgerEntryClassification.TAXABLE ? dec(l.gstAmount) : ZERO;
        return {
          source: "DROP_BILL" as const,
          type: l.entryType as string,
          label: l.description,
          isDiscount: l.classification === LedgerEntryClassification.DISCOUNT,
          amount: money(amount),
          gst: money(lineGst),
          total: money(amount.add(lineGst)),
        };
      }),
      ...legacyCharges.map((c) => {
        const amount = dec(c.finalAmount);
        const lineGst = chargeEntryGst(c)?.gst ?? ZERO;
        return {
          source: "LEGACY_DROP" as const,
          type: c.chargeType as string,
          label: c.label,
          isDiscount: false,
          amount: money(amount),
          gst: money(lineGst),
          total: money(amount.add(lineGst)),
        };
      }),
      ...(owed.dropDamageOutsideBill.gt(0)
        ? [
            {
              source: "DAMAGE" as const,
              type: "DAMAGE",
              label: "Damage charged at drop",
              isDiscount: false,
              amount: money(owed.dropDamageOutsideBill),
              gst: "0.00",
              total: money(owed.dropDamageOutsideBill),
            },
          ]
        : []),
    ];

    // ── Payments ──
    const transactions = await Promise.all(
      txns.map(async (t) => {
        let proofPhoto: { url: string; mime: string; expiresIn: number | null } | null = null;
        if (t.proofFile) {
          // Private-bucket files store the key in url; public ones a full URL.
          proofPhoto = /^https?:\/\//i.test(t.proofFile.url)
            ? { url: t.proofFile.url, mime: t.proofFile.mime, expiresIn: null }
            : {
                url: await generatePresignedUrl(t.proofFile.key, PROOF_URL_TTL_SECONDS),
                mime: t.proofFile.mime,
                expiresIn: PROOF_URL_TTL_SECONDS,
              };
        }
        return {
          publicId: t.publicId,
          purpose: t.purpose,
          method: t.method,
          status: t.status,
          isRefund: (REFUND_PAYMENT_PURPOSES as string[]).includes(t.purpose),
          totalAmount: money(t.totalAmount),
          cashAmount: money(t.cashAmount),
          onlineAmount: money(t.onlineAmount),
          onlineTransactionRef: t.onlineTransactionRef ?? null,
          onlineGateway: t.onlineGateway ?? null,
          collectedBy: t.collectedBy?.name ?? null,
          collectedAt: iso(t.collectedAt),
          confirmedBy: t.confirmedBy?.name ?? null,
          confirmedAt: iso(t.confirmedAt),
          rejectedAt: iso(t.rejectedAt),
          rejectionReason: t.rejectionReason ?? null,
          notes: t.notes ?? null,
          createdAt: t.createdAt.toISOString(),
          proofPhoto,
        };
      }),
    );

    const credit = booking.creditEntry;
    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        booking: {
          publicId: booking.publicId,
          status: booking.status,
          type: bookingListTypeOf(booking.rentalPeriodType),
          source: bookingSource(booking.createdBy?.role),
          createdBy: booking.createdBy ? { name: booking.createdBy.name, role: booking.createdBy.role } : null,
          branch: { publicId: booking.branch.publicId, name: booking.branch.name },
          isOwnBranch: booking.branch.id === branchId,
          vehicles: booking.items.map((i) => ({
            publicId: i.vehicle.publicId,
            make: i.vehicle.make,
            model: i.vehicle.model,
            regNo: i.vehicle.regNo,
          })),
          days: booking.days,
          startAt: booking.startAt.toISOString(),
          endAt: booking.endAt.toISOString(),
          originalEndAt: iso(booking.originalEndAt),
          returnedAt: iso(booking.returnedAt),
          cancelledAt: iso(booking.cancelledAt),
          cancellationReason: booking.cancellationReason ?? null,
          holdExpiresAt: booking.status === BookingStatus.HOLD ? iso(booking.holdExpiresAt) : null,
          createdAt: booking.createdAt.toISOString(),
          couponCode: booking.couponCode ?? null,
          paymentStatus: booking.paymentStatus,
          isAdvancePayment: booking.isAdvancePayment,
          advanceAmount: money(booking.advanceAmount),
        },
        breakdown: {
          rental: {
            rentWithoutGst: money(base),
            discount: money(discount),
            taxableAmount: money(taxable),
            cgst: splitKnown ? money(cgst) : null,
            sgst: splitKnown ? money(sgst) : null,
            gst: money(gst),
            gstRate: gstRate != null ? money(gstRate) : null,
            rentInclGst: money(taxable.add(gst)),
            refundableDeposit: money(deposit),
            /** Original booking total: rent incl. GST + refundable deposit */
            total: money(taxable.add(gst).add(deposit)),
          },
          extensions: {
            items: extensions,
            /** Σ CONFIRMED extensions — already inside totalFinal */
            total: money(extensionsTotal),
          },
          /** Booking total: original + confirmed extensions */
          totalFinal: money(owed.totalFinal),
          returnCharges: {
            items: returnChargeItems,
            dropBill: money(owed.dropBillCharges),
            legacy: money(owed.legacyReturnCharges),
            damageOutsideBill: money(owed.dropDamageOutsideBill),
            total: money(owed.returnCharges),
          },
          safetyDeposit: {
            amount: money(booking.safetyDeposit),
            charged: money(owed.safetyDepositCharged),
            credited: money(owed.safetyDepositCredited),
            held: money(owed.safetyDepositHeld),
            refunded: booking.safetyDepositRefunded,
            setOff: booking.safetyDepositSetOff,
          },
          /** totalFinal + return charges + safety deposit taken − deposit credited back */
          totalOwed: money(owed.totalOwed),
        },
        payments: {
          lifecycleState: state.lifecycleState,
          totalCollectedConfirmed: money(state.totalCollectedConfirmed),
          totalCollectedPending: money(state.totalCollectedPending),
          totalRefunded: money(state.totalRefunded),
          amountDue: money(state.amountDue),
          transactions,
        },
        credit: credit
          ? {
              creditPublicId: credit.publicId,
              status: credit.status,
              totalAmount: money(credit.totalAmount),
              clearedAmount: money(credit.clearedAmount),
              pendingAmount: money(credit.pendingAmount),
              createdAt: credit.createdAt.toISOString(),
              sections: Array.isArray(credit.sections) ? credit.sections : [],
              clearances: credit.clearances.map((c) => ({
                publicId: c.publicId,
                amountCleared: money(c.amountCleared),
                paymentMethod: c.paymentMethod,
                transactionRef: c.transactionRef ?? null,
                clearedAt: c.clearedAt.toISOString(),
                clearedBy: c.clearedBy?.name ?? null,
              })),
            }
          : null,
      },
    });
  } catch (error) {
    console.error("GetCustomerBooking Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't load the booking. Please try again.",
    });
  }
};

// ── Blacklist ────────────────────────────────────────────────────────────────

async function openRentCounts(customerId: number, now: Date) {
  const [upcoming, active] = await Promise.all([
    prisma.booking.count({ where: { customerId, deletedAt: null, ...bucketWhere("upcoming", now) } }),
    prisma.booking.count({ where: { customerId, deletedAt: null, ...bucketWhere("active", now) } }),
  ]);
  return { upcoming, active };
}

/** POST /customers/:customerId/blacklist { reason } */
export const BlacklistCustomer = async (req: Request, res: Response) => {
  try {
    const rawReason = req.body?.reason;
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (reason.length < BLACKLIST_REASON_MIN) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "BLACKLIST_REASON_REQUIRED",
        message: `Enter a reason for the blacklist (at least ${BLACKLIST_REASON_MIN} characters).`,
      });
    }
    if (reason.length > BLACKLIST_REASON_MAX) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "BLACKLIST_REASON_TOO_LONG",
        message: `Keep the reason under ${BLACKLIST_REASON_MAX} characters.`,
      });
    }

    const [customer, actor] = await Promise.all([findCustomer(req.params.customerId), loadActor(req)]);
    if (!customer) return customerNotFound(res);
    if (!actor) {
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        code: "MANAGER_NOT_FOUND",
        message: "Your account could not be found. Please log in again.",
      });
    }
    if (customer.isBlacklisted) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "CUSTOMER_ALREADY_BLACKLISTED",
        message: "This customer is already blacklisted.",
        blacklistReason: customer.blacklistReason,
        blacklistedAt: iso(customer.blacklistedAt),
      });
    }

    const now = new Date();
    const changed = await prisma.$transaction(async (tx) => {
      // Guarded update: a concurrent blacklist of the same customer is a no-op.
      const { count } = await tx.customer.updateMany({
        where: { id: customer.id, isBlacklisted: false },
        data: {
          isBlacklisted: true,
          blacklistReason: reason,
          blacklistedAt: now,
          blacklistedById: actor.id,
        },
      });
      if (count === 0) return false;

      await auditService.log(
        {
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          actorBranchId: req.branch_Id,
          action: AUDIT_CUSTOMER_BLACKLISTED,
          category: AuditCategory.CUSTOMER,
          severity: AuditSeverity.WARNING,
          description: `Blacklisted customer ${customer.user.name} (${customer.publicId}): ${reason}`,
          entity: "Customer",
          entityId: customer.publicId,
          entityLabel: customer.user.name,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"] as string | undefined,
          before: { isBlacklisted: false, blacklistReason: null },
          after: { isBlacklisted: true, blacklistReason: reason },
          metadata: { reason, userPublicId: customer.user.publicId },
        },
        tx,
      );
      await staffActivityService.logFromRequest(
        req,
        {
          actionType: StaffActionType.FLAGGED,
          entityType: StaffEntityType.CUSTOMER,
          entityRef: customer.publicId,
          description: `Blacklisted customer ${customer.user.name}: ${reason}`,
          metadata: { reason },
        },
        tx,
      );
      return true;
    });

    if (!changed) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "CUSTOMER_ALREADY_BLACKLISTED",
        message: "This customer is already blacklisted.",
      });
    }

    await invalidateCustomerSearchCache();
    const openRents = await openRentCounts(customer.id, now);

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Customer blacklisted. They can't make new bookings until the blacklist is removed.",
      data: {
        customerPublicId: customer.publicId,
        isBlacklisted: true,
        reason,
        blacklistedAt: now.toISOString(),
        blacklistedBy: await blacklistedByView(actor.id),
        // Existing bookings are not cancelled by the blacklist.
        openRents,
      },
    });
  } catch (error) {
    console.error("BlacklistCustomer Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't blacklist the customer. Please try again.",
    });
  }
};

/** POST /customers/:customerId/unblacklist { note? } */
export const RemoveCustomerBlacklist = async (req: Request, res: Response) => {
  try {
    const rawNote = req.body?.note;
    if (rawNote != null && typeof rawNote !== "string") {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_NOTE",
        message: "note must be text.",
      });
    }
    const note = typeof rawNote === "string" ? rawNote.trim() : "";
    if (note.length > BLACKLIST_REASON_MAX) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_NOTE",
        message: `Keep the note under ${BLACKLIST_REASON_MAX} characters.`,
      });
    }

    const [customer, actor] = await Promise.all([findCustomer(req.params.customerId), loadActor(req)]);
    if (!customer) return customerNotFound(res);
    if (!actor) {
      return res.status(StatusCode.FORBIDDEN).json({
        success: false,
        code: "MANAGER_NOT_FOUND",
        message: "Your account could not be found. Please log in again.",
      });
    }
    if (!customer.isBlacklisted) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "CUSTOMER_NOT_BLACKLISTED",
        message: "This customer isn't blacklisted.",
      });
    }

    const previous = {
      reason: customer.blacklistReason,
      blacklistedAt: iso(customer.blacklistedAt),
      blacklistedById: customer.blacklistedById,
    };

    const changed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: { id: customer.id, isBlacklisted: true },
        data: {
          isBlacklisted: false,
          blacklistReason: null,
          blacklistedAt: null,
          blacklistedById: null,
        },
      });
      if (count === 0) return false;

      await auditService.log(
        {
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          actorBranchId: req.branch_Id,
          action: AUDIT_CUSTOMER_BLACKLIST_REMOVED,
          category: AuditCategory.CUSTOMER,
          severity: AuditSeverity.INFO,
          description: `Removed the blacklist on customer ${customer.user.name} (${customer.publicId})${
            note ? `: ${note}` : ""
          }`,
          entity: "Customer",
          entityId: customer.publicId,
          entityLabel: customer.user.name,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"] as string | undefined,
          before: { isBlacklisted: true, blacklistReason: previous.reason },
          after: { isBlacklisted: false, blacklistReason: null },
          metadata: {
            note: note || null,
            previousReason: previous.reason,
            previousBlacklistedAt: previous.blacklistedAt,
            previousBlacklistedById: previous.blacklistedById,
            userPublicId: customer.user.publicId,
          },
        },
        tx,
      );
      await staffActivityService.logFromRequest(
        req,
        {
          actionType: StaffActionType.UPDATED,
          entityType: StaffEntityType.CUSTOMER,
          entityRef: customer.publicId,
          description: `Removed the blacklist on customer ${customer.user.name}${note ? `: ${note}` : ""}`,
          metadata: { note: note || null, previousReason: previous.reason },
        },
        tx,
      );
      return true;
    });

    if (!changed) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "CUSTOMER_NOT_BLACKLISTED",
        message: "This customer isn't blacklisted.",
      });
    }

    await invalidateCustomerSearchCache();

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Blacklist removed. The customer can book again.",
      data: {
        customerPublicId: customer.publicId,
        isBlacklisted: false,
        reason: null,
        blacklistedAt: null,
        blacklistedBy: null,
      },
    });
  } catch (error) {
    console.error("RemoveCustomerBlacklist Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't remove the blacklist. Please try again.",
    });
  }
};
