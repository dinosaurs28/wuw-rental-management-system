/**
 * Drop Damage controller — damage recorded by staff while closing a drop.
 *
 * Endpoints:
 *   POST   /employee/bookings/:bookingId/return/damages
 *   GET    /employee/bookings/:bookingId/return/damages
 *   DELETE /employee/bookings/:bookingId/return/damages/:damagePublicId
 *
 * Photos are uploaded first via POST /employee/damage/upload. Unlike
 * /employee/damage/report, these endpoints never change the booking or vehicle
 * status and never abandon the RETURN session; the vehicle goes to
 * MANAGER_REPORTED when the drop completes.
 *
 * Who bills a customer-charged damage depends on the branch:
 *  - payment sessions on  → billed on the drop bill by the next compute (`chargedAtDrop`)
 *  - payment sessions off → the manager charges it in the damage review
 *    (estimatedCost prefilled from the amount entered here)
 *
 * Add/remove run with the booking row locked (like compute and record-payment),
 * so a change can't slip between computing the drop bill and paying it.
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  BookingPhotoType,
  DamageChargeType,
  DamageReportStatus,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { publicFileUrl } from "../../utils/file-url.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import {
  DROP_DAMAGE_SOURCE,
  isDropDamage,
  lockBookingForDrop,
} from "../../services/damage/drop-damage.service.js";

const createDropDamageSchema = z.object({
  area: z.string().trim().min(1, "Enter the damaged area"),
  severity: z.enum(["Minor", "Moderate", "Severe"], { error: "Choose the damage severity" }),
  description: z.string().trim().min(3, "Describe the damage (at least 3 characters)"),
  amount: z.coerce.number().min(0, "Damage cost can't be negative"),
  chargeCustomer: z.boolean({ error: "Choose Charge customer or Company expense" }),
  damageImageIds: z.array(z.string().min(1)).min(1, "Add at least one damage photo"),
  // Required when the booking has more than one vehicle
  vehiclePublicId: z.string().min(1).optional(),
});

const dropDamageInclude = {
  photos: {
    where: { type: BookingPhotoType.DAMAGE },
    orderBy: { createdAt: "asc" as const },
    select: { file: { select: { publicId: true, key: true, url: true } } },
  },
  vehicle: { select: { publicId: true, make: true, model: true, regNo: true } },
};

/** A precondition that failed inside a locked transaction — sent to the client as-is. */
class DropDamageRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "DropDamageRejection";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveActor(req: Request) {
  return prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
}

async function findBranchBooking(bookingPublicId: string, branchId: number) {
  return prisma.booking.findFirst({
    where: { publicId: bookingPublicId, branchId },
    select: {
      id: true,
      publicId: true,
      status: true,
      items: {
        orderBy: { id: "asc" },
        select: { vehicle: { select: { id: true, publicId: true, regNo: true } } },
      },
      branch: { select: { chargeConfig: { select: { usePaymentSessions: true } } } },
    },
  });
}

/** Re-reads the booking status under the lock; add/remove only while the car is still out. */
async function assertStillPickedUp(tx: any, bookingId: number, action: "recorded" | "removed") {
  const current = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true },
  });
  if (current.status !== BookingStatus.PICKED_UP) {
    throw new DropDamageRejection(StatusCode.BAD_REQUEST, {
      message:
        action === "recorded"
          ? `Damage can only be recorded while the vehicle is out. Booking status: ${current.status}`
          : `Damage can't be removed after the drop is closed. Booking status: ${current.status}`,
    });
  }
}

// ── POST /employee/bookings/:bookingId/return/damages ─────────────────────────

export const CreateDropDamage = async (req: Request, res: Response) => {
  try {
    const validation = createDropDamageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: validation.error.issues[0]?.message ?? "Validation failed",
        errors: validation.error.format(),
      });
    }
    const { area, severity, description, chargeCustomer, damageImageIds, vehiclePublicId } = validation.data;
    const amount = new Decimal(validation.data.amount).toDecimalPlaces(2);

    const actor = await resolveActor(req);
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const booking = await findBranchBooking(req.params.bookingId!, actor.branchId!);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }
    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Damage can only be recorded while the vehicle is out. Booking status: ${booking.status}`,
      });
    }

    // Which car is damaged — required when the booking has more than one
    const bookingVehicles = booking.items.map((i) => i.vehicle);
    let vehicle = bookingVehicles[0];
    if (vehiclePublicId) {
      vehicle = bookingVehicles.find((v) => v.publicId === vehiclePublicId);
      if (!vehicle) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "That vehicle isn't on this booking." });
      }
    } else if (bookingVehicles.length > 1) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "VEHICLE_REQUIRED",
        message: "This booking has more than one vehicle — choose the damaged one.",
      });
    }
    if (!vehicle) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Booking has no vehicle assigned" });
    }
    const damagedVehicle = vehicle;

    // The drop bill can only carry a damage with a cost; without payment sessions
    // the manager prices and charges it in the damage review instead.
    const usePaymentSessions = booking.branch?.chargeConfig?.usePaymentSessions ?? false;
    if (usePaymentSessions && chargeCustomer && amount.lte(0)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Enter the damage cost to charge the customer, or choose Company expense.",
      });
    }

    const uniqueImageIds = [...new Set(damageImageIds)];
    const files = await prisma.fileObject.findMany({
      where: { publicId: { in: uniqueImageIds } },
      select: { id: true, publicId: true, url: true },
    });
    if (files.length !== uniqueImageIds.length) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "One or more damage photos are invalid" });
    }

    const chargedAtDrop = usePaymentSessions && chargeCustomer && amount.gt(0);

    const { report, created } = await prisma.$transaction(async (tx) => {
      await lockBookingForDrop(tx as any, booking.id);
      await assertStillPickedUp(tx, booking.id, "recorded");

      // Idempotent retry: a photo already on a drop damage of this booking means
      // this damage was recorded — hand back that report instead of a duplicate.
      const linkedPhotos = await tx.bookingPhoto.findMany({
        where: {
          bookingId: booking.id,
          type: BookingPhotoType.DAMAGE,
          fileId: { in: files.map((f) => f.id) },
          damageReportId: { not: null },
        },
        select: { damageReport: { include: dropDamageInclude } },
      });
      const existing = linkedPhotos
        .map((p) => p.damageReport)
        .find((r) => r != null && isDropDamage(r.notes));
      if (existing) return { report: existing, created: false };

      const newReport = await tx.damageReport.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          vehicleId: damagedVehicle.id,
          status: DamageReportStatus.PENDING,
          severity,
          chargeType: chargeCustomer ? DamageChargeType.PENALTY : DamageChargeType.COMPENSATION,
          estimatedCost: amount.toFixed(2),
          finalCost: amount.toFixed(2),
          chargedAtDrop,
          // `damages` mirrors the shape the manager damage review renders
          notes: {
            area,
            description,
            source: DROP_DAMAGE_SOURCE,
            chargeCustomer,
            damages: [
              { area, severity, description, photos: files.map((f) => ({ publicId: f.publicId, url: f.url })) },
            ],
          },
        },
      });

      await tx.bookingPhoto.createMany({
        data: files.map((f) => ({
          publicId: createID(),
          bookingId: booking.id,
          fileId: f.id,
          type: BookingPhotoType.DAMAGE,
          damageReportId: newReport.id,
        })),
      });

      const withPhotos = await tx.damageReport.findUniqueOrThrow({
        where: { id: newReport.id },
        include: dropDamageInclude,
      });
      return { report: withPhotos, created: true };
    }, { timeout: 30000 });

    if (!created) {
      return res.status(StatusCode.OK).json({
        message: "Damage already recorded",
        data: { damage: serializeDropDamage(report) },
      });
    }

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "DROP_DAMAGE_RECORDED",
      category: AuditCategory.VEHICLE,
      description: `Damage recorded at drop for booking ${booking.publicId} (${damagedVehicle.regNo}): ${area} (${severity}), ₹${amount.toFixed(2)} ${
        chargedAtDrop ? "charged on the drop bill" : chargeCustomer ? "to be charged by the manager" : "company expense"
      }`,
      entity: "DamageReport",
      entityId: report.publicId,
      entityLabel: damagedVehicle.regNo,
      metadata: { bookingRef: booking.publicId, area, severity, amount: amount.toFixed(2), chargeCustomer, chargedAtDrop },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.DAMAGE_REPORT,
      entityRef: report.publicId,
      description: `Drop damage ${report.publicId} recorded for booking ${booking.publicId}`,
      metadata: { bookingRef: booking.publicId, amount: amount.toFixed(2), chargeCustomer },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Damage recorded",
      data: { damage: serializeDropDamage(report) },
    });
  } catch (err: any) {
    if (err instanceof DropDamageRejection) {
      return res.status(err.status).json(err.body);
    }
    console.error("CreateDropDamage Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── GET /employee/bookings/:bookingId/return/damages ──────────────────────────

export const GetDropDamages = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const booking = await findBranchBooking(req.params.bookingId!, actor.branchId!);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const reports = await prisma.damageReport.findMany({
      where: { bookingId: booking.id },
      include: dropDamageInclude,
      orderBy: { createdAt: "asc" },
    });

    return res.status(StatusCode.OK).json({
      message: "Drop damages fetched",
      data: { damages: reports.filter((r) => isDropDamage(r.notes)).map(serializeDropDamage) },
    });
  } catch (err: any) {
    console.error("GetDropDamages Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── DELETE /employee/bookings/:bookingId/return/damages/:damagePublicId ───────

export const DeleteDropDamage = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const booking = await findBranchBooking(req.params.bookingId!, actor.branchId!);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }
    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Damage can't be removed after the drop is closed. Booking status: ${booking.status}`,
      });
    }

    const report = await prisma.$transaction(async (tx) => {
      await lockBookingForDrop(tx as any, booking.id);
      await assertStillPickedUp(tx, booking.id, "removed");

      const completedReturn = await tx.paymentSession.findFirst({
        where: {
          bookingId: booking.id,
          sessionType: PaymentSessionType.RETURN,
          status: PaymentSessionStatus.COMPLETED,
        },
        select: { id: true },
      });
      if (completedReturn) {
        throw new DropDamageRejection(StatusCode.BAD_REQUEST, {
          message: "Damage can't be removed after the drop is paid.",
        });
      }

      const found = await tx.damageReport.findFirst({
        where: { publicId: req.params.damagePublicId!, bookingId: booking.id },
        include: { photos: { select: { fileId: true, file: { select: { key: true } } } } },
      });
      if (!found || !isDropDamage(found.notes)) {
        throw new DropDamageRejection(StatusCode.NOT_FOUND, { message: "Damage not found" });
      }
      if (found.status !== DamageReportStatus.PENDING) {
        throw new DropDamageRejection(StatusCode.BAD_REQUEST, {
          message: "This damage was already reviewed by the manager and can't be removed.",
        });
      }

      await tx.bookingPhoto.deleteMany({ where: { damageReportId: found.id } });
      await tx.damageReport.delete({ where: { id: found.id } });
      return found;
    }, { timeout: 30000 });

    // Remove the uploaded photos unless another booking photo still uses them (non-critical)
    for (const photo of report.photos) {
      try {
        const stillUsed = await prisma.bookingPhoto.count({ where: { fileId: photo.fileId } });
        if (stillUsed > 0) continue;
        await prisma.fileObject.delete({ where: { id: photo.fileId } });
        await fileCleanupQueue.add("cleanup", { key: photo.file.key });
      } catch (cleanupErr) {
        console.warn("[drop-damage] Photo cleanup failed (non-fatal):", cleanupErr);
      }
    }

    const notes = report.notes as Record<string, unknown>;
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "DROP_DAMAGE_REMOVED",
      category: AuditCategory.VEHICLE,
      description: `Drop damage removed for booking ${booking.publicId}: ${String(notes.area ?? "")} (${report.severity}), ₹${new Decimal(report.estimatedCost.toString()).toFixed(2)}`,
      entity: "DamageReport",
      entityId: report.publicId,
      metadata: { bookingRef: booking.publicId, chargedAtDrop: report.chargedAtDrop },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.DAMAGE_REPORT,
      entityRef: report.publicId,
      description: `Drop damage ${report.publicId} removed from booking ${booking.publicId}`,
      metadata: { bookingRef: booking.publicId },
    });

    return res.status(StatusCode.OK).json({ message: "Damage removed" });
  } catch (err: any) {
    if (err instanceof DropDamageRejection) {
      return res.status(err.status).json(err.body);
    }
    console.error("DeleteDropDamage Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeDropDamage(report: any) {
  const notes = (report.notes ?? {}) as Record<string, unknown>;
  return {
    publicId: report.publicId,
    area: String(notes.area ?? ""),
    severity: report.severity,
    description: String(notes.description ?? ""),
    amount: new Decimal(report.estimatedCost.toString()).toFixed(2),
    chargeCustomer:
      typeof notes.chargeCustomer === "boolean"
        ? notes.chargeCustomer
        : report.chargeType === DamageChargeType.PENALTY,
    // true = on this drop bill; false with chargeCustomer = the manager will charge it
    billedAtDrop: report.chargedAtDrop,
    vehicle: report.vehicle
      ? {
          publicId: report.vehicle.publicId,
          make: report.vehicle.make,
          model: report.vehicle.model,
          regNo: report.vehicle.regNo,
        }
      : null,
    photos: (report.photos ?? []).map((p: any) => ({ publicId: p.file.publicId, url: publicFileUrl(p.file) })),
    createdAt: report.createdAt,
  };
}
