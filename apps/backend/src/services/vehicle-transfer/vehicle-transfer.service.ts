/**
 * Vehicle transfer between branches (Nov 14 2026, client: "Vehicle transfer from
 * one branch to another"). Rules: vehicle-transfer-rules.ts.
 *
 * In one transaction, with the vehicle row locked FOR UPDATE (the lock booking
 * creation, booking locks and swaps take — lockAndFindBlockedVehicleIds — so a
 * booking being created for the car either lands first and refuses the transfer,
 * or waits and sees the new branch):
 *   - re-reads the car's bookings / bills / drafts and asks transferRefusal,
 *   - moves Vehicle.branchId (publicId unchanged); a higher odometer reading is
 *     saved on the car,
 *   - recomputes its own prices' stored "without GST" parts with the new branch's
 *     GST rule (the price totals are GST-inclusive and stay as they are),
 *   - takes the car out of the old branch's festival rules / booking locks that
 *     name it by id (they only ever act on their own branch's cars),
 *   - writes a VehicleBranchTransfer row (+ audit log).
 * Then clears the listing / availability / pricing caches.
 *
 * Unchanged on purpose: past bookings keep Booking.branchId, so booking / finance
 * reports and the BM rent history stay with the branch where each rental
 * happened. Group-keyed rules (festival GROUPS, group locks) and the branch's
 * default prices / deposits / weekend days / GST of the NEW branch apply to the
 * car from now on (they are matched by branch at pricing time).
 */
import { prisma, Prisma, BookingStatus, PaymentSessionStatus, PaymentSessionType, DamageReportStatus, Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { redis } from "../../lib/redisconfig.js";
import {
  invalidateGroupListingCache,
  invalidateVehicleAvailability,
  invalidateVehiclePricing,
} from "../../utils/cache/vehicleCacheKeys.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { isDropDamage } from "../damage/drop-damage.service.js";
import { branchRentRates, rentWithoutGstOf } from "../pricing/rent-columns.service.js";
import {
  isUpcomingBooking,
  transferRefusal,
  withoutId,
  type TransferActor,
  type TransferBody,
} from "./vehicle-transfer-rules.js";

/** Bills still open (not completed / abandoned). */
const OPEN_BILL_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.OPEN,
  PaymentSessionStatus.COMPUTING,
  PaymentSessionStatus.AWAITING_PAYMENT,
  PaymentSessionStatus.PAYMENT_INITIATED,
];

export interface TransferActorInfo extends TransferActor {
  userId: number | null;
  name: string;
  ipAddress?: string;
  userAgent?: string;
}

export const TRANSFER_SELECT = {
  publicId: true,
  fromBranchName: true,
  toBranchName: true,
  transferredByName: true,
  transferredByRole: true,
  reason: true,
  odometer: true,
  createdAt: true,
  fromBranch: { select: { publicId: true } },
  toBranch: { select: { publicId: true } },
} satisfies Prisma.VehicleBranchTransferSelect;

type TransferRow = Prisma.VehicleBranchTransferGetPayload<{ select: typeof TRANSFER_SELECT }>;

export function toTransferDto(t: TransferRow) {
  return {
    publicId: t.publicId,
    fromBranchId: t.fromBranch?.publicId ?? null,
    fromBranchName: t.fromBranchName,
    toBranchId: t.toBranch?.publicId ?? null,
    toBranchName: t.toBranchName,
    transferredByName: t.transferredByName,
    transferredByRole: t.transferredByRole,
    reason: t.reason,
    odometer: t.odometer,
    createdAt: t.createdAt,
  };
}

/** A vehicle's transfers, newest first. */
export async function listVehicleTransfers(vehicleId: number) {
  const rows = await prisma.vehicleBranchTransfer.findMany({
    where: { vehicleId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: TRANSFER_SELECT,
  });
  return rows.map(toTransferDto);
}

export async function transferVehicle(vehiclePublicId: string, body: TransferBody, actor: TransferActorInfo) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.vehicle.findUnique({ where: { publicId: vehiclePublicId }, select: { id: true } });
    const locked = found
      ? await tx.$queryRaw<Array<{ id: number; branchId: number; status: string; deletedAt: Date | null; odo: number }>>`
          SELECT "id", "branchId", "status"::text AS "status", "deletedAt", "odo" FROM "Vehicle"
          WHERE "id" = ${found.id} FOR UPDATE`
      : [];
    const vehicle = locked[0] ?? null;

    const target = await tx.branch.findUnique({
      where: { publicId: body.toBranchId },
      select: { id: true, name: true, deletedAt: true },
    });

    let onRent: string | null = null;
    let upcoming: Array<{ publicId: string; status: string; startAt: Date }> = [];
    let openBillCount = 0;
    let openDraftCount = 0;
    let pendingDropDamage = false;
    if (vehicle) {
      const itemOf = { items: { some: { vehicleId: vehicle.id } } };
      const [active, bills, drafts, damages] = await Promise.all([
        tx.booking.findMany({
          where: {
            ...itemOf,
            status: { in: [BookingStatus.PICKED_UP, BookingStatus.HOLD, BookingStatus.CONFIRMED] },
          },
          select: { publicId: true, status: true, startAt: true, endAt: true, holdExpiresAt: true },
          orderBy: { startAt: "asc" },
        }),
        tx.paymentSession.count({
          where: {
            booking: itemOf,
            sessionType: { in: [PaymentSessionType.RETURN, PaymentSessionType.ADJUSTMENT] },
            status: { in: OPEN_BILL_STATUSES },
          },
        }),
        tx.operationDraft.count({
          where: {
            booking: { ...itemOf, status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP, BookingStatus.RETURNED] } },
          },
        }),
        tx.damageReport.findMany({
          where: { vehicleId: vehicle.id, status: DamageReportStatus.PENDING },
          select: { notes: true },
        }),
      ]);
      onRent = active.find((b) => b.status === BookingStatus.PICKED_UP)?.publicId ?? null;
      upcoming = active.filter((b) => isUpcomingBooking(b, now));
      openBillCount = bills;
      openDraftCount = drafts;
      pendingDropDamage = damages.some((d) => isDropDamage(d.notes));
    }

    const refusal = transferRefusal({
      vehicle,
      actor,
      target: target ? { id: target.id, deletedAt: target.deletedAt } : null,
      onRentBookingPublicId: onRent,
      upcomingBookings: upcoming,
      openBillCount,
      openDraftCount,
      pendingDropDamage,
      odometer: body.odometer,
    });
    if (refusal) throw refusal;
    const v = vehicle!;
    const to = target!;

    const from = await tx.branch.findUnique({ where: { id: v.branchId }, select: { id: true, name: true } });
    const odoChanged = body.odometer != null && body.odometer > v.odo;

    const moved = await tx.vehicle.update({
      where: { id: v.id },
      data: { branchId: to.id, ...(odoChanged && { odo: body.odometer! }) },
      select: {
        id: true,
        publicId: true,
        make: true,
        model: true,
        regNo: true,
        odo: true,
        categoryId: true,
        category: { select: { name: true } },
        customPricing: {
          select: { id: true, totalRent12Hour: true, totalRent24Hour: true, price12Hour: true, price24Hour: true, weekendTotalRent12Hour: true, weekendTotalRent24Hour: true },
        },
      },
    });

    // The car's own prices: stored "without GST" parts by the new branch's GST rule
    const warnings: string[] = [];
    const cp = moved.customPricing;
    if (cp) {
      const rates = await branchRentRates(to.id, tx);
      const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d.toString()));
      await tx.vehicleCustomPricing.update({
        where: { id: cp.id },
        data: {
          rentWithoutGst12Hour: rentWithoutGstOf(num(cp.totalRent12Hour) ?? num(cp.price12Hour), rates),
          rentWithoutGst24Hour: rentWithoutGstOf(num(cp.totalRent24Hour) ?? num(cp.price24Hour), rates),
          weekendRentWithoutGst12Hour: rentWithoutGstOf(num(cp.weekendTotalRent12Hour), rates),
          weekendRentWithoutGst24Hour: rentWithoutGstOf(num(cp.weekendTotalRent24Hour), rates),
        },
      });
    } else {
      const defaults = await tx.branchPricingDefaults.findUnique({
        where: { branchId_categoryId: { branchId: to.id, categoryId: moved.categoryId } },
        select: { id: true },
      });
      if (!defaults) {
        warnings.push(
          `${to.name} has no default prices for ${moved.category.name} and this vehicle has no prices of its own — set its prices before it is booked.`,
        );
      }
    }

    // The old branch's festival rules / booking locks naming this car by id
    const [rules, locks] = await Promise.all([
      tx.specialPricingRule.findMany({
        where: { branchId: v.branchId, deletedAt: null, vehicleIds: { has: v.id } },
        select: { id: true, vehicleIds: true },
      }),
      tx.bookingLock.findMany({
        where: { branchId: v.branchId, cancelledAt: null, endAt: { gt: now }, vehicleIds: { has: v.id } },
        select: { id: true, vehicleIds: true },
      }),
    ]);
    for (const r of rules) {
      const ids = withoutId(r.vehicleIds, v.id);
      if (ids) await tx.specialPricingRule.update({ where: { id: r.id }, data: { vehicleIds: { set: ids } } });
    }
    for (const l of locks) {
      const ids = withoutId(l.vehicleIds, v.id);
      if (ids) await tx.bookingLock.update({ where: { id: l.id }, data: { vehicleIds: { set: ids } } });
    }

    const transfer = await tx.vehicleBranchTransfer.create({
      data: {
        publicId: createID(),
        vehicleId: v.id,
        fromBranchId: v.branchId,
        toBranchId: to.id,
        fromBranchName: from?.name ?? "Unknown branch",
        toBranchName: to.name,
        transferredByUserId: actor.userId,
        transferredByName: actor.name,
        transferredByRole: actor.role,
        reason: body.reason,
        odometer: body.odometer,
      },
      select: TRANSFER_SELECT,
    });

    await auditService.log(
      {
        actorId: actor.userId ?? undefined,
        actorName: actor.name,
        actorRole: actor.role === "ADMIN" ? Role.ADMIN : Role.MANAGER,
        actorBranchId: actor.branchId ?? undefined,
        action: "VEHICLE_BRANCH_TRANSFER",
        category: AuditCategory.VEHICLE,
        description: `${moved.regNo} (${moved.make} ${moved.model}) transferred from ${from?.name ?? "Unknown branch"} to ${to.name} — ${body.reason}`,
        entity: "Vehicle",
        entityId: moved.publicId,
        entityLabel: moved.regNo,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        before: { branchName: from?.name ?? null, odo: v.odo },
        after: { branchName: to.name, odo: moved.odo },
        metadata: {
          reason: body.reason,
          odometer: body.odometer,
          festivalRulesUpdated: rules.length,
          bookingLocksUpdated: locks.length,
        },
      },
      tx,
    );

    return {
      vehicle: { id: v.id, publicId: moved.publicId, regNo: moved.regNo, odo: moved.odo },
      fromBranchId: v.branchId,
      toBranchId: to.id,
      transfer: toTransferDto(transfer),
      warnings,
    };
  });

  await clearTransferCaches(result.vehicle.id, [result.fromBranchId, result.toBranchId]);

  return {
    vehicle: { publicId: result.vehicle.publicId, regNo: result.vehicle.regNo, odo: result.vehicle.odo },
    transfer: result.transfer,
    warnings: result.warnings,
  };
}

async function clearTransferCaches(vehicleId: number, branchIds: number[]) {
  try {
    await Promise.all([
      invalidateVehicleAvailability(redis, [vehicleId]),
      invalidateVehiclePricing(redis, [vehicleId]),
      invalidateGroupListingCache(redis),
    ]);
    // The BM vehicle list cache of both branches
    for (const branchId of branchIds) {
      let cursor = "0";
      do {
        const [next, keys] = (await redis.scan(cursor, "MATCH", `vehicles:${branchId}:*`, "COUNT", 100)) as [string, string[]];
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    }
    await redis.del("admin:all_branches");
  } catch (err) {
    console.warn("[vehicle-transfer] Cache invalidation failed (non-fatal):", err);
  }
}
