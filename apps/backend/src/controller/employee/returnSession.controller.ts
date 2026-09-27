/**
 * Return Session controller — session-driven ledger flow for vehicle return.
 *
 * Endpoints:
 *   POST /employee/bookings/:bookingId/return/session/compute
 *   GET  /employee/bookings/:bookingId/return/session
 *
 * Flow:
 *  1. Check the original driving licence went back to the customer (if collected)
 *     and no committed extension is still unpaid
 *  2. Build drop charges: extra km (server-computed from the plan's free-km
 *     allowance; skipped after a mid-rental vehicle swap), fuel, FASTag, other
 *     charges and damage billed at drop
 *  3. Apply the optional drop discount (capped at the drop charges)
 *  4. With the booking row locked: create/return the one open RETURN session,
 *     void previous entries and re-add every line — a recompute is a full rebuild
 *  5. Apply safety deposit credit as a PAYMENT entry (reduces netPayable)
 *  6. Store chargeBreakdown / km / discount / billed endAt in session.metadata
 *  7. Transition session to AWAITING_PAYMENT
 *  8. Return session with full charge + balance breakdown
 *
 * Only active when BranchChargeConfig.usePaymentSessions = true.
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  BookingPhotoType,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentSessionType,
  PaymentSessionStatus,
  ExtensionStatus,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { paymentSessionService } from "../../services/payment/paymentSession.service.js";
import type { TxClient } from "../../services/payment/paymentSession.service.js";
import { ledgerService } from "../../services/payment/ledger.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";
import {
  resolveKmAllowance,
  calculateKmCharge,
  wasVehicleSwappedAfterPickup,
  KmAllowanceUnavailableError,
  type KmAllowance,
} from "../../services/charges/km-allowance.service.js";
import {
  DROP_DAMAGE_REF,
  DROP_DISCOUNT_REF,
  dropDamageAmount,
  lockBookingForDrop,
} from "../../services/damage/drop-damage.service.js";

// Extra km is computed on the server from the plan's free-km allowance — a
// client-sent `extraKmCharge` is stripped by zod and ignored.
const computeReturnSessionSchema = z.object({
  endOdometer: z.coerce.number().int().min(0),
  returnFuelLevel: z.string().regex(/^([1-9]|10)$/).optional(),
  fuelCharge: z.coerce.number().min(0).optional(),
  fastagAmount: z.coerce.number().min(0).optional(),
  fastagNotes: z.string().optional(),
  otherCharges: z.array(z.object({ label: z.string().min(1), amount: z.coerce.number().min(0) })).optional(),
  returnImageIds: z.array(z.string()).optional(),
  licenseReturned: z.boolean().optional(),
  discount: z
    .object({
      amount: z.coerce.number().positive("Discount must be more than ₹0"),
      reason: z.string().trim().min(3, "Give a reason for the discount (at least 3 characters)"),
    })
    .nullable()
    .optional(),
});

interface DropChargeLine {
  type: LedgerEntryType;
  label: string;
  amount: Decimal;
  referenceType: string;
  referenceId?: string;
}

/** A precondition that failed inside the compute transaction — sent to the client as-is. */
class ComputeRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "ComputeRejection";
  }
}

const EXTENSION_PENDING = {
  code: "EXTENSION_PENDING",
  message: "Collect or cancel the pending extension before computing the drop bill.",
};

const LICENSE_NOT_RETURNED = {
  code: "LICENSE_NOT_RETURNED",
  message: "Return the customer's original driving licence before closing the drop.",
};

/**
 * True while the booking's active extension is committed but not yet paid — its
 * requested end is already on booking.endAt as the vehicle hold, and it must not
 * earn free km until it is confirmed.
 */
async function hasUnpaidExtension(activeExtensionId: number | null, tx?: TxClient): Promise<boolean> {
  if (activeExtensionId == null) return false;
  const db = tx ?? prisma;
  const extension = await db.bookingExtension.findUnique({
    where: { id: activeExtensionId },
    select: { extensionStatus: true },
  });
  return (
    extension?.extensionStatus === ExtensionStatus.PENDING_PAYMENT ||
    extension?.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED
  );
}

// ── POST /employee/bookings/:bookingId/return/session/compute ──────────────────

export const ComputeReturnSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = computeReturnSessionSchema.safeParse(req.body);
    if (!validation.success) {
      const discountIssue = validation.error.issues.find((i) => i.path[0] === "discount");
      return res.status(StatusCode.BAD_REQUEST).json({
        message: discountIssue?.message ?? "Validation failed",
        errors: validation.error.format(),
      });
    }
    const { endOdometer, returnImageIds, returnFuelLevel, fuelCharge, fastagAmount, fastagNotes, otherCharges, licenseReturned, discount } = validation.data;

    // Resolve actor
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    // Fetch booking with branch config and fuel record
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      include: {
        branch: {
          include: { chargeConfig: { select: { usePaymentSessions: true } } },
        },
        fuelRecord: true,
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot compute return session. Booking status: ${booking.status}`,
      });
    }

    // Feature flag check
    const usePaymentSessions = booking.branch?.chargeConfig?.usePaymentSessions ?? false;
    if (!usePaymentSessions) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Payment session flow is not enabled for this branch. Use the legacy return-charges endpoint.",
      });
    }

    // The original driving licence held since pickup must go back before the drop closes.
    // Bookings picked up before licences were collected (licenseCollectedAt = null) are exempt,
    // and so are staff phones on an app build that predates the tick (they omit the field);
    // an explicit `false` is always refused.
    if (booking.licenseCollectedAt != null && booking.licenseReturnedAt == null && licenseReturned === false) {
      return res.status(StatusCode.BAD_REQUEST).json(LICENSE_NOT_RETURNED);
    }

    // A committed-but-unpaid extension has already moved endAt — it must not earn free km
    if (await hasUnpaidExtension(booking.activeExtensionId)) {
      return res.status(StatusCode.CONFLICT).json(EXTENSION_PENDING);
    }

    // After a mid-rental vehicle swap the start odometer belongs to the old car,
    // so km driven can't be worked out and extra km isn't charged automatically.
    const vehicleSwapped = await wasVehicleSwappedAfterPickup(booking.id);

    if (!vehicleSwapped && booking.startOdometer != null && endOdometer < booking.startOdometer) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `End odometer can't be less than the pickup reading (${booking.startOdometer} km).`,
      });
    }

    // Validate return photos before touching the ledger so a bad id can't leave a half-saved drop
    const uniqueReturnImageIds = [...new Set(returnImageIds ?? [])];
    const returnFiles = uniqueReturnImageIds.length > 0
      ? await prisma.fileObject.findMany({
          where: { publicId: { in: uniqueReturnImageIds } },
          select: { id: true },
        })
      : [];
    if (returnFiles.length !== uniqueReturnImageIds.length) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "One or more returnImageIds are invalid" });
    }

    // Extra km — server-computed from the plan's free-km allowance
    let allowance: KmAllowance;
    try {
      allowance = await resolveKmAllowance(booking.id);
    } catch (allowanceErr) {
      if (allowanceErr instanceof KmAllowanceUnavailableError) {
        return res.status(StatusCode.CONFLICT).json({
          code: "KM_ALLOWANCE_UNAVAILABLE",
          message: allowanceErr.message,
        });
      }
      throw allowanceErr;
    }
    const km = calculateKmCharge(booking.startOdometer, endOdometer, allowance, vehicleSwapped);

    // Drop charge lines from the request (skip zero-amount entries); damage lines are added under the lock
    const requestCharges: DropChargeLine[] = [];
    if (km.extraKmCharge.gt(0)) {
      requestCharges.push({
        type: LedgerEntryType.EXTRA_KM,
        label: `Extra km: ${km.extraKm} km × ₹${km.extraKmRate.toString()}`,
        amount: km.extraKmCharge,
        referenceType: LedgerEntryType.EXTRA_KM,
      });
    }
    if (fuelCharge && fuelCharge > 0) {
      requestCharges.push({ type: LedgerEntryType.FUEL, label: "Fuel deficit charge", amount: new Decimal(fuelCharge), referenceType: LedgerEntryType.FUEL });
    }
    if (fastagAmount && fastagAmount > 0) {
      requestCharges.push({ type: LedgerEntryType.FASTAG, label: fastagNotes ? `FASTag: ${fastagNotes}` : "FASTag charges", amount: new Decimal(fastagAmount), referenceType: LedgerEntryType.FASTAG });
    }
    for (const other of otherCharges ?? []) {
      if (other.amount > 0) {
        requestCharges.push({ type: LedgerEntryType.DAMAGE, label: other.label, amount: new Decimal(other.amount), referenceType: LedgerEntryType.DAMAGE });
      }
    }

    const kmData = {
      startOdometer: km.startOdometer,
      endOdometer: km.endOdometer,
      kmDriven: km.kmDriven,
      includedKm: km.includedKm,
      extraKm: km.extraKm,
      extraKmRate: km.extraKmRate.toFixed(2),
      extraKmCharge: km.extraKmCharge.toFixed(2),
      extraKmEnabled: km.extraKmEnabled,
      autoKmSkipped: km.autoKmSkipped,
    };

    // Every line of this compute shares a fresh ref so its idempotency keys never
    // collide with the (voided) lines of an earlier compute on the same session.
    const computeRef = createID();

    // Atomically, with the booking row locked (so concurrent computes, damage changes
    // and payments on this booking run one at a time): re-check the booking, read the
    // drop damages, create/fetch the one open RETURN session, void its entries and
    // re-add every line, store metadata, transition to AWAITING_PAYMENT and save the
    // drop readings.
    const computed = await prisma.$transaction(async (tx) => {
      await lockBookingForDrop(tx as any, booking.id);

      const locked = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: {
          status: true,
          endAt: true,
          activeExtensionId: true,
          licenseCollectedAt: true,
          licenseReturnedAt: true,
          safetyDeposit: true,
        },
      });
      if (locked.status !== BookingStatus.PICKED_UP) {
        throw new ComputeRejection(StatusCode.BAD_REQUEST, {
          message: `Cannot compute return session. Booking status: ${locked.status}`,
        });
      }
      if (await hasUnpaidExtension(locked.activeExtensionId, tx as any)) {
        throw new ComputeRejection(StatusCode.CONFLICT, EXTENSION_PENDING);
      }
      if (locked.endAt.getTime() !== allowance.periodEndAt.getTime()) {
        throw new ComputeRejection(StatusCode.CONFLICT, {
          message: "The rental period changed while the drop bill was being computed. Try again.",
        });
      }
      const licenseDue = locked.licenseCollectedAt != null && locked.licenseReturnedAt == null;
      if (licenseDue && licenseReturned === false) {
        throw new ComputeRejection(StatusCode.BAD_REQUEST, LICENSE_NOT_RETURNED);
      }

      // Damage the customer agreed to pay at drop (recorded via /return/damages)
      const dropDamages = await tx.damageReport.findMany({
        where: { bookingId: booking.id, chargedAtDrop: true },
        select: { publicId: true, severity: true, notes: true, finalCost: true, estimatedCost: true },
        orderBy: { createdAt: "asc" },
      });

      const manualCharges: DropChargeLine[] = [...requestCharges];
      for (const damage of dropDamages) {
        const notes = (damage.notes ?? {}) as Record<string, unknown>;
        manualCharges.push({
          type: LedgerEntryType.DAMAGE,
          label: `Damage: ${String(notes.area ?? "Vehicle")} (${damage.severity})`,
          amount: dropDamageAmount(damage),
          referenceType: DROP_DAMAGE_REF,
          referenceId: damage.publicId,
        });
      }

      const totalManualCharges = manualCharges.reduce((sum, c) => sum.plus(c.amount), new Decimal(0));

      // Drop discount — re-applied on every compute from what the client sends; capped at the drop charges
      const discountAmount = discount ? new Decimal(discount.amount).toDecimalPlaces(2) : new Decimal(0);
      if (discountAmount.gt(totalManualCharges)) {
        throw new ComputeRejection(StatusCode.BAD_REQUEST, {
          code: "DISCOUNT_EXCEEDS_CHARGES",
          message: `Discount can't be more than the drop charges (₹${totalManualCharges.toFixed(2)}).`,
        });
      }
      const discountData = discount && discountAmount.gt(0)
        ? { amount: discountAmount.toFixed(2), reason: discount.reason }
        : null;
      const netDropCharges = totalManualCharges.minus(discountData ? discountAmount : 0);

      const safetyDeposit = new Decimal(locked.safetyDeposit?.toString() ?? "0");

      // Build chargeBreakdown for metadata / display (the drop discount shows as waived)
      const chargeBreakdown = {
        subtotal: totalManualCharges.toFixed(2),
        waivedTotal: discountData ? discountAmount.toFixed(2) : "0.00",
        finalTotal: netDropCharges.toFixed(2),
        charges: manualCharges.map((c) => ({
          chargeType: c.type,
          moduleKey: c.type.toLowerCase(),
          label: c.label,
          originalAmount: c.amount.toFixed(2),
          finalAmount: c.amount.toFixed(2),
          quantity: null,
          unitRate: null,
          isOverridden: false,
          notes: null,
        })),
      };

      // Create or return the booking's open RETURN session — under the lock there is only ever one
      const session = await paymentSessionService.createSession(
        booking.id,
        booking.branchId,
        PaymentSessionType.RETURN,
        actor.id,
        tx as any,
      );
      const previousDiscount = ((session.metadata as any)?.discount ?? null) as { amount: string; reason: string } | null;

      // Void every previously computed entry (recompute case) — read inside this transaction
      const existingEntries = session.entries?.filter((e: any) => !e.isVoided) ?? [];
      for (const e of existingEntries) {
        await ledgerService.voidEntry(e.publicId, actor.id, "Return charges recomputed", tx as any);
      }

      // Add drop charge entries
      for (const [index, charge] of manualCharges.entries()) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          charge.type,
          LedgerEntryClassification.NON_TAXABLE,
          charge.amount,
          charge.label,
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `return:${session.id}:${computeRef}:charge:${index}`,
            referenceType: charge.referenceType,
            referenceId: charge.referenceId,
          },
          tx as any,
        );
      }

      // Drop discount — capped at the drop charges above, so it never eats into the deposit refund
      if (discountData) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.DISCOUNT,
          LedgerEntryClassification.DISCOUNT,
          discountAmount.negated(),
          `Drop discount: ${discountData.reason}`,
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `return:${session.id}:${computeRef}:discount`,
            referenceType: DROP_DISCOUNT_REF,
            metadata: { reason: discountData.reason },
          },
          tx as any,
        );
      }

      // Apply safety deposit credit — reduces netPayable
      if (safetyDeposit.gt(0)) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.DEPOSIT,
          LedgerEntryClassification.PAYMENT,
          safetyDeposit.negated(),
          `Safety deposit credit (₹${safetyDeposit.toFixed(2)})`,
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `return:${booking.id}:deposit-credit:${session.id}:${computeRef}`,
            referenceType: "SAFETY_DEPOSIT_CREDIT",
          },
          tx as any,
        );
      }

      // Store chargeBreakdown / km / discount in session metadata for page-reload restoration,
      // plus the rental period billed so a later extension marks the bill stale.
      await (tx as any).paymentSession.update({
        where: { id: session.id },
        data: {
          metadata: {
            chargeBreakdown,
            km: kmData,
            discount: discountData,
            bookingEndAt: locked.endAt.toISOString(),
          },
        },
      });

      // Transition to AWAITING_PAYMENT (skip if already there — recompute case)
      if (session.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
        await paymentSessionService.updateStatus(
          session.id,
          PaymentSessionStatus.AWAITING_PAYMENT,
          {},
          tx as any,
        );
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          endOdometer,
          // Unknown after a mid-rental swap — the start reading is from the old car
          totalKmDriven: km.autoKmSkipped ? null : km.kmDriven,
          freeKmLimit: km.includedKm,
          extraKmCharged: km.extraKm,
          ...(licenseDue && licenseReturned === true && { licenseReturnedAt: new Date(), licenseReturnedById: actor.id }),
        },
      });

      return {
        session,
        previousDiscount,
        dropDamages,
        manualCharges,
        totalManualCharges,
        discountData,
        netDropCharges,
        safetyDeposit,
        chargeBreakdown,
        licenseDue,
      };
    }, { timeout: 30000 });

    const { session, previousDiscount, dropDamages, manualCharges, totalManualCharges, discountData, netDropCharges, safetyDeposit, chargeBreakdown, licenseDue } = computed;

    if (booking.fuelRecord && returnFuelLevel) {
      await prisma.fuelRecord.update({
        where: { bookingId: booking.id },
        data: { returnFuelLevel: returnFuelLevel as any, returnAt: new Date(), capturedByReturnId: actor.id },
      });
    }

    // Save POST_RETURN photos (outside transaction — non-critical). Skip files already
    // attached so a recompute with the same photos doesn't duplicate them.
    if (returnFiles.length > 0) {
      const alreadyAttached = await prisma.bookingPhoto.findMany({
        where: {
          bookingId: booking.id,
          type: BookingPhotoType.POST_RETURN,
          fileId: { in: returnFiles.map((f) => f.id) },
        },
        select: { fileId: true },
      });
      const attachedFileIds = new Set(alreadyAttached.map((p) => p.fileId));
      const newFiles = returnFiles.filter((f) => !attachedFileIds.has(f.id));
      if (newFiles.length > 0) {
        await prisma.bookingPhoto.createMany({
          data: newFiles.map((f) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.POST_RETURN,
          })),
          skipDuplicates: true,
        });
      }
    }

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "RETURN_SESSION_COMPUTED",
      category: AuditCategory.PAYMENT,
      description: `Return session computed for booking ${booking.publicId}: ₹${netDropCharges.toFixed(2)} additional charges`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: {
        subtotal: totalManualCharges.toFixed(2),
        discount: discountData,
        finalTotal: netDropCharges.toFixed(2),
        safetyDepositCredit: safetyDeposit.toFixed(2),
        chargeCount: manualCharges.length,
        km: kmData,
        dropDamages: dropDamages.map((d) => d.publicId),
        ...(licenseDue && licenseReturned === true && { licenseReturned: true }),
      },
    });

    // Discount is audit-logged with its reason whenever it is given, changed or removed
    const discountChanged =
      (previousDiscount?.amount ?? null) !== (discountData?.amount ?? null) ||
      (previousDiscount?.reason ?? null) !== (discountData?.reason ?? null);
    if (discountChanged) {
      await auditService.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: discountData ? "RETURN_DISCOUNT_APPLIED" : "RETURN_DISCOUNT_REMOVED",
        category: AuditCategory.DISCOUNT,
        description: discountData
          ? `Drop discount of ₹${discountData.amount} given on booking ${booking.publicId}: ${discountData.reason}`
          : `Drop discount removed on booking ${booking.publicId}`,
        entity: "PaymentSession",
        entityId: session.publicId,
        metadata: { discount: discountData, previousDiscount, dropCharges: totalManualCharges.toFixed(2) },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: discountData ? StaffActionType.APPLIED : StaffActionType.DELETED,
        entityType: StaffEntityType.PAYMENT_SESSION,
        entityRef: session.publicId,
        description: discountData
          ? `Drop discount ₹${discountData.amount} given on booking ${bookingId}: ${discountData.reason}`
          : `Drop discount removed on booking ${bookingId}`,
        metadata: { discount: discountData, previousDiscount },
      });
    }

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.RECALCULATED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Return charges computed for booking ${bookingId}: ₹${netDropCharges.toFixed(2)} additional charges`,
      metadata: { totalManualCharges: totalManualCharges.toFixed(2), discount: discountData, chargeCount: manualCharges.length },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Return session computed",
      data: {
        session: serializeReturnSession(updatedSession!),
        chargeBreakdown,
        km: kmData,
        discount: discountData,
      },
    });
  } catch (err: any) {
    if (err instanceof ComputeRejection) {
      return res.status(err.status).json(err.body);
    }
    console.error("ComputeReturnSession Error:", err);
    const isValidationError =
      err.message?.includes("required") || err.message?.includes("enabled");
    return res.status(
      err.status ?? (isValidationError ? StatusCode.BAD_REQUEST : StatusCode.INTERNAL_SERVER_ERROR),
    ).json({ message: err.message ?? "Internal server error" });
  }
};

// ── GET /employee/bookings/:bookingId/return/session ──────────────────────────

export const GetReturnSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, branchId: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true },
    });
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.RETURN,
        status: {
          in: [
            PaymentSessionStatus.OPEN,
            PaymentSessionStatus.AWAITING_PAYMENT,
            PaymentSessionStatus.PAYMENT_INITIATED,
          ],
        },
      },
      include: {
        entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active return session found" });
    }

    // Read chargeBreakdown / km / discount stored in metadata during compute (may be null for old sessions)
    const meta = session.metadata as any;
    const chargeBreakdown = meta?.chargeBreakdown ?? null;

    return res.status(StatusCode.OK).json({
      message: "Return session fetched",
      data: {
        session: serializeReturnSession(session),
        chargeBreakdown,
        km: meta?.km ? { autoKmSkipped: null, ...meta.km } : null,
        discount: meta?.discount ?? null,
      },
    });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeReturnSession(session: any) {
  const netPayable = new Decimal(session.netPayable.toString());
  return {
    publicId: session.publicId,
    sessionType: session.sessionType,
    status: session.status,
    netPayable: netPayable.toFixed(2),
    totalCharges: new Decimal(session.totalCharges.toString()).toFixed(2),
    totalDiscounts: new Decimal(session.totalDiscounts.toString()).toFixed(2),
    totalPaymentsRecorded: new Decimal(session.totalPaymentsRecorded.toString()).toFixed(2),
    taxableBase: new Decimal(session.taxableBase.toString()).toFixed(2),
    nonTaxableBase: new Decimal(session.nonTaxableBase.toString()).toFixed(2),
    gstAmount: new Decimal(session.gstAmount.toString()).toFixed(2),
    isRefund: netPayable.lt(0),
    entries: (session.entries ?? []).map((e: any) => ({
      publicId: e.publicId,
      entryType: e.entryType,
      classification: e.classification,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}
