import { Prisma, BookingStatus } from "@repo/database/client";
import { REVENUE_BOOKING_STATUSES } from "./constants.js";

/** Parse a `categories` query param (comma-separated string or array) into publicIds. */
export const parseCategoryIds = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter((v) => v && v !== "all");
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "all");
};

/** True when a branch param means "all branches" (no filter). */
const isAllBranches = (branchPublicId?: string | null): boolean =>
  !branchPublicId || branchPublicId === "all";

export interface BookingWhereOptions {
  /** Branch public id, or "all"/undefined for no branch filter. */
  branchPublicId?: string | null;
  /** Inclusive range start. */
  from: Date;
  /** Inclusive range end. */
  to: Date;
  /** Vehicle category public ids to filter by (empty = all). */
  categoryPublicIds?: string[];
  /** Booking statuses to include. Defaults to the canonical revenue set. */
  statuses?: BookingStatus[];
  /** Date column to anchor the range on. Defaults to startAt (spec booking_start_date). */
  dateField?: "startAt" | "endAt" | "createdAt" | "cancelledAt";
}

/**
 * THE canonical booking filter. Every revenue-bearing report and the dashboard
 * build their `where` from this so they cannot disagree on the same filters —
 * this is the structural fix for the "100k vs 61.2k" inconsistency.
 *
 * - Anchors the date range on `startAt` (spec booking_start_date) by default.
 * - Branch via relation publicId; "all"/missing = no filter.
 * - Category via items -> vehicle -> category.publicId (Booking has no categoryId).
 * - Always excludes soft-deleted bookings.
 */
export const buildBookingWhere = (
  opts: BookingWhereOptions,
): Prisma.BookingWhereInput => {
  const {
    branchPublicId,
    from,
    to,
    categoryPublicIds = [],
    statuses = REVENUE_BOOKING_STATUSES,
    dateField = "startAt",
  } = opts;

  const where: Prisma.BookingWhereInput = {
    deletedAt: null,
    status: { in: statuses },
    [dateField]: { gte: from, lte: to },
  };

  if (!isAllBranches(branchPublicId)) {
    where.branch = { publicId: branchPublicId as string };
  }

  if (categoryPublicIds.length > 0) {
    where.items = {
      some: { vehicle: { category: { publicId: { in: categoryPublicIds } } } },
    };
  }

  return where;
};

/**
 * Snapshot booking filter (no date range) for "right now" metrics like Pending
 * Revenue (confirmed) and Active Bookings (picked up). Applies branch + category
 * + status + soft-delete, but no date anchor.
 */
export const buildBookingSnapshotWhere = (opts: {
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  statuses: BookingStatus[];
}): Prisma.BookingWhereInput => {
  const { branchPublicId, categoryPublicIds = [], statuses } = opts;
  const where: Prisma.BookingWhereInput = {
    deletedAt: null,
    status: { in: statuses },
  };
  if (!isAllBranches(branchPublicId)) {
    where.branch = { publicId: branchPublicId as string };
  }
  if (categoryPublicIds.length > 0) {
    where.items = {
      some: { vehicle: { category: { publicId: { in: categoryPublicIds } } } },
    };
  }
  return where;
};

export interface VehicleWhereOptions {
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  /** When false (default) inactive vehicles are excluded. */
  includeInactive?: boolean;
}

/**
 * Canonical vehicle filter for vehicle-centric reports (Vehicle Reports,
 * Availability, Insurance). Filters category directly on the vehicle.
 */
export const buildVehicleWhere = (
  opts: VehicleWhereOptions,
): Prisma.VehicleWhereInput => {
  const { branchPublicId, categoryPublicIds = [], includeInactive = false } =
    opts;

  const where: Prisma.VehicleWhereInput = { deletedAt: null };

  if (!includeInactive) {
    where.status = { not: "INACTIVE" };
  }

  if (!isAllBranches(branchPublicId)) {
    where.branch = { publicId: branchPublicId as string };
  }

  if (categoryPublicIds.length > 0) {
    where.category = { publicId: { in: categoryPublicIds } };
  }

  return where;
};
