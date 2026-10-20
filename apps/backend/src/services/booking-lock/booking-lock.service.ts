/**
 * Booking locks (client, Oct 2026: "create a booking lock for a Window") —
 * list / create / cancel, the dialog's options and the overlap preview, shared
 * by the branch manager (own branch) and admin (any branch) controllers.
 *
 * A lock keeps the cars it names (the whole branch, some vehicles, some vehicle
 * groups) from new bookings and changes whose window overlaps its effective
 * window [effectiveLockStart(startAt), endAt) — from 00:00 IST the day before it
 * starts (LOCK_LEAD_DAYS), computed, never stored — and hides them while that
 * window runs; the availability rule reads locks through
 * utils/availability/bookingLocks.ts. Existing bookings are never changed:
 * create lists the CONFIRMED / PICKED_UP bookings (and checkouts in progress)
 * inside the effective window and needs the manager's acknowledgement when
 * there are any. Every create / cancel drops the listing caches (as a drop
 * does), writes an audit log and a staff activity entry.
 */
import type { Response } from "express";
import {
  prisma,
  BookingStatus,
  Prisma,
  StaffActionType,
  StaffEntityType,
  type Role,
} from "@repo/database/client";
import {
  BOOKING_LOCK_LIST_FILTERS,
  bookingLockStatus,
  effectiveLockStart,
  lockActsAt,
  lockCoversVehicle,
  vehicleGroupKey,
  type BookingLockListFilter,
  type CreateBookingLockInput,
} from "@repo/schemas";
import { DateTime } from "luxon";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { invalidateGroupListingCache, invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { DROP_NOT_RECORDED_WHERE } from "../../utils/availability/vehicleEligibility.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService } from "../staffActivity/staffActivity.service.js";

export class BookingLockError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BookingLockError";
  }
}

/** Who made the change. */
export interface BookingLockActor {
  userId: number;
  publicId: string;
  name: string;
  role: Role;
  branchId: number | null;
}

/** The signed-in staff user behind the request (the BM / admin). */
export async function bookingLockActor(publicId: string): Promise<BookingLockActor> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!user) throw new BookingLockError(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");
  return { userId: user.id, publicId: user.publicId, name: user.name, role: user.role, branchId: user.branchId };
}

export const bookingLockListFilter = (raw: unknown): BookingLockListFilter =>
  (BOOKING_LOCK_LIST_FILTERS as readonly string[]).includes(String(raw)) ? (raw as BookingLockListFilter) : "current";

const LOCK_INCLUDE = {
  createdBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
} as const satisfies Prisma.BookingLockInclude;

type LockRow = Prisma.BookingLockGetPayload<{ include: typeof LOCK_INCLUDE }>;

const VEHICLE_SELECT = {
  id: true,
  branchId: true,
  regNo: true,
  make: true,
  model: true,
  categoryId: true,
  category: { select: { name: true } },
} as const satisfies Prisma.VehicleSelect;

/** "3 Oct 2026, 10:00 AM" (IST). */
const istLabel = (d: Date) => DateTime.fromJSDate(d).setZone("Asia/Kolkata").toFormat("d LLL yyyy, h:mm a");

/** Branch name (404 when the branch doesn't exist). */
async function branchName(branchId: number): Promise<string> {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { name: true } });
  if (!branch) throw new BookingLockError(404, "BRANCH_NOT_FOUND", "Branch not found");
  return branch.name;
}

/** The branch's vehicle groups (make + model + category), named as their first vehicle is. */
function groupsOf(vehicles: Array<{ make: string; model: string; categoryId: number; category: { name: string } }>) {
  const groups = new Map<
    string,
    { key: string; make: string; model: string; categoryId: number; categoryName: string; vehicleCount: number }
  >();
  for (const v of vehicles) {
    const key = vehicleGroupKey(v.make, v.model, v.categoryId);
    const group = groups.get(key);
    if (group) group.vehicleCount++;
    else {
      groups.set(key, {
        key,
        make: v.make.trim(),
        model: v.model.trim(),
        categoryId: v.categoryId,
        categoryName: v.category.name,
        vehicleCount: 1,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.categoryName.localeCompare(b.categoryName),
  );
}

async function branchVehicles(branchId: number) {
  return prisma.vehicle.findMany({
    where: { branchId, deletedAt: null },
    select: VEHICLE_SELECT,
    orderBy: [{ make: "asc" }, { model: "asc" }, { regNo: "asc" }],
  });
}

/** A lock as the API returns it (vehicles and groups named). */
async function viewLocks(rows: LockRow[], now = new Date()) {
  const vehicleIds = [...new Set(rows.flatMap((r) => r.vehicleIds))];
  const branchIds = [...new Set(rows.filter((r) => r.groupKeys.length > 0).map((r) => r.branchId))];
  const [vehicles, groupVehicles] = await Promise.all([
    vehicleIds.length
      ? prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, regNo: true, make: true, model: true } })
      : [],
    branchIds.length
      ? prisma.vehicle.findMany({
          where: { branchId: { in: branchIds } },
          select: { branchId: true, make: true, model: true, categoryId: true, category: { select: { name: true } } },
        })
      : [],
  ]);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  return rows.map((r) => {
    const groups = new Map(groupsOf(groupVehicles.filter((v) => v.branchId === r.branchId)).map((g) => [g.key, g]));
    return {
      publicId: r.publicId,
      branchId: r.branchId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      reason: r.reason,
      scope: r.scope,
      vehicleIds: r.vehicleIds,
      groupKeys: r.groupKeys,
      customersOnly: r.customersOnly,
      status: bookingLockStatus(r, now),
      /** Hidden and unbookable from (ISO): 00:00 IST the day before startAt (effectiveLockStart). */
      hiddenFrom: effectiveLockStart(r.startAt).toISOString(),
      /** The lead day or the lock is running now: the cars are hidden. */
      hiddenNow: lockActsAt(r, now),
      vehicles: r.vehicleIds.flatMap((id) => vehicleById.get(id) ?? []),
      groups: r.groupKeys.map((key) => {
        const g = groups.get(key);
        if (g) return { key, make: g.make, model: g.model, categoryId: g.categoryId, categoryName: g.categoryName as string | null };
        // A group whose vehicles have all gone: named from its key (MAKE__MODEL__categoryId)
        const [make = key, model = "", categoryId = "0"] = key.split("__");
        return { key, make, model, categoryId: Number(categoryId) || 0, categoryName: null };
      }),
      createdBy: r.createdBy ? { name: r.createdBy.name } : null,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelledBy: r.cancelledBy ? { name: r.cancelledBy.name } : null,
    };
  });
}

export type BookingLockView = Awaited<ReturnType<typeof viewLocks>>[number];

/**
 * The branch's locks: "current" = active and upcoming (soonest first), "past"
 * = ended or cancelled (latest first), "all" = both, current first.
 */
export async function listBookingLocks(branchId: number, filter: BookingLockListFilter = "current") {
  await branchName(branchId);
  const now = new Date();
  const current: Prisma.BookingLockWhereInput = { cancelledAt: null, endAt: { gt: now } };
  const past: Prisma.BookingLockWhereInput = { OR: [{ cancelledAt: { not: null } }, { endAt: { lte: now } }] };
  const [currentRows, pastRows] = await Promise.all([
    filter === "past"
      ? []
      : prisma.bookingLock.findMany({ where: { branchId, ...current }, include: LOCK_INCLUDE, orderBy: [{ startAt: "asc" }, { id: "asc" }] }),
    filter === "current"
      ? []
      : prisma.bookingLock.findMany({
          where: { branchId, ...past },
          include: LOCK_INCLUDE,
          orderBy: [{ endAt: "desc" }, { id: "desc" }],
          take: 200,
        }),
  ]);
  return viewLocks([...currentRows, ...pastRows], now);
}

/** The dialog's pickers: the branch's vehicles and vehicle groups. */
export async function bookingLockOptions(branchId: number) {
  await branchName(branchId);
  const vehicles = await branchVehicles(branchId);
  return {
    vehicles: vehicles.map((v) => ({
      id: v.id,
      regNo: v.regNo,
      make: v.make,
      model: v.model,
      categoryId: v.categoryId,
      categoryName: v.category.name,
    })),
    groups: groupsOf(vehicles),
  };
}

type LockScopeInput = Pick<CreateBookingLockInput, "scope" | "vehicleIds" | "groupKeys">;

/** Only the list matching the scope is kept (deduplicated). */
function scopedLists(input: LockScopeInput) {
  return {
    vehicleIds: input.scope === "VEHICLES" ? [...new Set(input.vehicleIds)] : [],
    groupKeys: input.scope === "GROUPS" ? [...new Set(input.groupKeys)] : [],
  };
}

/**
 * The branch's vehicles the lock covers; picked vehicles / groups must be the
 * branch's own (400 BOOKING_LOCK_SCOPE_INVALID otherwise).
 */
async function coveredVehicles(branchId: number, input: LockScopeInput) {
  const lists = scopedLists(input);
  const vehicles = await branchVehicles(branchId);
  if (lists.vehicleIds.length > 0) {
    const ids = new Set(vehicles.map((v) => v.id));
    if (lists.vehicleIds.some((id) => !ids.has(id))) {
      throw new BookingLockError(400, "BOOKING_LOCK_SCOPE_INVALID", "Some of the picked vehicles aren't at this branch. Reload and try again.");
    }
  }
  if (lists.groupKeys.length > 0) {
    const keys = new Set(vehicles.map((v) => vehicleGroupKey(v.make, v.model, v.categoryId)));
    if (lists.groupKeys.some((k) => !keys.has(k))) {
      throw new BookingLockError(400, "BOOKING_LOCK_SCOPE_INVALID", "Some of the picked vehicle groups aren't at this branch. Reload and try again.");
    }
  }
  const lock = { branchId, scope: input.scope, ...lists };
  return { lists, vehicles: vehicles.filter((v) => lockCoversVehicle(lock, v)) };
}

/**
 * CONFIRMED bookings, rentals out now (PICKED_UP, drop not recorded — an
 * overdue one counts as out until now) and checkouts in progress (unexpired
 * HOLD rows) on these vehicles overlapping [start, end) — the lock's effective
 * window: what the lock leaves in place.
 */
async function overlappingBookings(vehicleIds: number[], start: Date, end: Date, now = new Date()) {
  if (vehicleIds.length === 0) return [];
  const rows = await prisma.booking.findMany({
    where: {
      deletedAt: null,
      items: { some: { vehicleId: { in: vehicleIds } } },
      startAt: { lt: end },
      OR: [
        { status: BookingStatus.CONFIRMED, endAt: { gt: start } },
        { status: BookingStatus.PICKED_UP, ...DROP_NOT_RECORDED_WHERE },
        { status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, endAt: { gt: start } },
      ],
    },
    orderBy: { startAt: "asc" },
    select: {
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      customer: { select: { user: { select: { name: true } } } },
      items: { select: { vehicleId: true, vehicle: { select: { regNo: true, make: true, model: true } } } },
    },
  });
  const ids = new Set(vehicleIds);
  return rows
    .filter((b) => {
      const until = b.status === BookingStatus.PICKED_UP ? Math.max(b.endAt.getTime(), now.getTime()) : b.endAt.getTime();
      return until > start.getTime();
    })
    .map((b) => ({
      bookingPublicId: b.publicId,
      status: b.status,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      customerName: b.customer?.user?.name ?? null,
      vehicles: b.items.filter((i) => ids.has(i.vehicleId)).map((i) => i.vehicle),
    }));
}

/** How many vehicles a draft covers and the existing bookings inside its effective window (the lead day included). */
export async function previewBookingLock(branchId: number, input: CreateBookingLockInput) {
  await branchName(branchId);
  const { vehicles } = await coveredVehicles(branchId, input);
  const hiddenFrom = effectiveLockStart(input.startAt);
  const overlapping = await overlappingBookings(vehicles.map((v) => v.id), hiddenFrom, new Date(input.endAt));
  return { vehicleCount: vehicles.length, hiddenFrom: hiddenFrom.toISOString(), overlapping };
}

/** "Branch closed 20 Oct 2026, 10:00 AM – 21 Oct 2026, 6:00 PM, whole branch (customers only)" */
function describeLock(lock: { reason: string; startAt: Date; endAt: Date; scope: string; vehicleIds: number[]; groupKeys: string[]; customersOnly: boolean }) {
  const scope =
    lock.scope === "VEHICLES"
      ? `${lock.vehicleIds.length} vehicle${lock.vehicleIds.length === 1 ? "" : "s"}`
      : lock.scope === "GROUPS"
        ? `${lock.groupKeys.length} vehicle group${lock.groupKeys.length === 1 ? "" : "s"}`
        : "whole branch";
  return `"${lock.reason}", ${istLabel(lock.startAt)} – ${istLabel(lock.endAt)} (hidden from ${istLabel(effectiveLockStart(lock.startAt))}), ${scope}${lock.customersOnly ? " (customers only)" : ""}`;
}

async function logChange(
  actor: BookingLockActor,
  branchId: number,
  kind: "created" | "cancelled",
  lock: { publicId: string; reason: string; startAt: Date; endAt: Date; scope: string; vehicleIds: number[]; groupKeys: string[]; customersOnly: boolean },
  meta: { ipAddress?: string; userAgent?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const description = `Booking lock ${kind}: ${describeLock(lock)}`;
  const snapshot = {
    reason: lock.reason,
    startAt: lock.startAt.toISOString(),
    endAt: lock.endAt.toISOString(),
    scope: lock.scope,
    vehicleIds: lock.vehicleIds,
    groupKeys: lock.groupKeys,
    customersOnly: lock.customersOnly,
  };
  const name = await branchName(branchId).catch(() => "Unknown Branch");
  await Promise.all([
    auditService
      .log({
        actorId: actor.userId,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: kind === "created" ? "BOOKING_LOCK_CREATED" : "BOOKING_LOCK_CANCELLED",
        category: AuditCategory.BRANCH,
        description,
        entity: "BookingLock",
        entityId: lock.publicId,
        entityLabel: lock.reason,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        ...(kind === "created" ? { after: snapshot } : { before: snapshot }),
        metadata: { branchId, branchName: name, ...meta.metadata },
      })
      .catch((err) => console.error("[booking-lock] audit log failed (non-fatal):", err)),
    staffActivityService
      .log({
        actorPublicId: actor.publicId,
        actorName: actor.name,
        actorRole: actor.role,
        branchId,
        branchName: name,
        actionType: kind === "created" ? StaffActionType.CREATED : StaffActionType.CANCELLED,
        entityType: StaffEntityType.VEHICLE,
        entityRef: lock.publicId,
        description,
        metadata: { ...snapshot, ...meta.metadata },
      })
      .catch((err) => console.error("[booking-lock] staff activity log failed (non-fatal):", err)),
  ]);
}

/**
 * The very next listing / details read sees the change: the availability and
 * grouped listing caches go (as when a drop is recorded).
 */
async function invalidateListings(vehicleIds: number[]): Promise<void> {
  try {
    await invalidateVehicleAvailability(redis, vehicleIds);
    await invalidateGroupListingCache(redis as Parameters<typeof invalidateGroupListingCache>[0]);
  } catch (err) {
    console.warn("[booking-lock] cache invalidation failed (non-fatal):", err);
  }
}

/**
 * Create a lock. When CONFIRMED / PICKED_UP bookings fall inside the window,
 * `acknowledgeOverlaps` must be true (409 BOOKING_LOCK_OVERLAPS with the list
 * otherwise); they are kept as they are. The covered vehicles' rows are locked
 * while the lock is written, so a booking created at the same moment either
 * commits first (and shows up as an overlap next time) or sees the lock
 * (lockAndFindBlockedVehicleIds takes the same row locks).
 */
export async function createBookingLock(
  branchId: number,
  input: CreateBookingLockInput,
  actor: BookingLockActor,
  meta: { ipAddress?: string; userAgent?: string } = {},
) {
  await branchName(branchId);
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const { lists, vehicles } = await coveredVehicles(branchId, input);
  const vehicleIds = vehicles.map((v) => v.id);

  const row = await prisma.$transaction(async (tx) => {
    if (vehicleIds.length > 0) {
      const ids = [...vehicleIds].sort((a, b) => a - b);
      await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    }
    const overlapping = await overlappingBookings(vehicleIds, effectiveLockStart(startAt), endAt);
    if (overlapping.length > 0 && input.acknowledgeOverlaps !== true) {
      throw new BookingLockError(
        409,
        "BOOKING_LOCK_OVERLAPS",
        `${overlapping.length} existing booking${overlapping.length === 1 ? " is" : "s are"} inside this window (from 1 day before it starts). They stay as they are — confirm to lock anyway.`,
        { overlapping },
      );
    }
    const created = await tx.bookingLock.create({
      data: {
        publicId: createID(),
        branchId,
        startAt,
        endAt,
        reason: input.reason.trim(),
        scope: input.scope,
        ...lists,
        customersOnly: input.customersOnly,
        createdById: actor.userId,
      },
      include: LOCK_INCLUDE,
    });
    return { created, overlapping };
  });

  await invalidateListings(vehicleIds);
  await logChange(actor, branchId, "created", row.created, {
    ...meta,
    metadata: {
      vehiclesCovered: vehicleIds.length,
      overlappingBookings: row.overlapping.map((b) => b.bookingPublicId),
    },
  });
  const [view] = await viewLocks([row.created]);
  return { ...view!, overlappingCount: row.overlapping.length };
}

/** Cancel a lock (soft: cancelledAt / cancelledBy). `branchId` limits it to that branch (the BM's own). */
export async function cancelBookingLock(
  publicId: string,
  actor: BookingLockActor,
  branchId?: number,
  meta: { ipAddress?: string; userAgent?: string } = {},
) {
  const lock = await prisma.bookingLock.findFirst({
    where: { publicId, ...(branchId != null && { branchId }) },
    include: LOCK_INCLUDE,
  });
  if (!lock) throw new BookingLockError(404, "BOOKING_LOCK_NOT_FOUND", "Booking lock not found");
  if (lock.cancelledAt) throw new BookingLockError(409, "BOOKING_LOCK_CANCELLED", "This booking lock is already cancelled");

  const updated = await prisma.bookingLock.update({
    where: { id: lock.id },
    data: { cancelledAt: new Date(), cancelledById: actor.userId },
    include: LOCK_INCLUDE,
  });
  const { vehicles } = await coveredVehicles(lock.branchId, lock as LockScopeInput).catch(() => ({ vehicles: [] as { id: number }[] }));
  await invalidateListings(vehicles.map((v) => v.id));
  await logChange(actor, lock.branchId, "cancelled", updated, meta);
  const [view] = await viewLocks([updated]);
  return view!;
}

export function invalidBookingLockBody(res: Response, issues: { path: (string | number)[]; message: string }[]) {
  return res.status(400).json({
    success: false,
    code: "INVALID_BOOKING_LOCK",
    message: issues[0]?.message ?? "Invalid booking lock",
    errors: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/** A BookingLockError as { success: false, code, message, ...extra }; anything else 500. */
export function sendBookingLockError(res: Response, error: unknown, label: string) {
  if (error instanceof BookingLockError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, ...error.extra });
  }
  console.error(`[${label}] error:`, error);
  return res.status(500).json({ message: "Internal server error" });
}
