/**
 * Return Session controller — session-driven ledger flow for vehicle return.
 *
 * Endpoints:
 *   POST /employee/bookings/:bookingId/return/session/compute
 *   GET  /employee/bookings/:bookingId/return/session
 *
 * Flow:
 *  1. Check no committed extension is still unpaid (an uncommitted customer
 *     quote doesn't block — it is cancelled under the lock)
 *  2. Build drop charges: extra km (server-computed from the plan's free-km
 *     allowance, summed across mid-rental swaps that recorded readings; a
 *     staff-entered figure only after a swap without readings), late return
 *     (automatic EXTRA_TIME line unless waived with a reason), vehicle-swap
 *     difference, fuel, FASTag, other charges and damage billed at drop
 *  3. Classify each line under the canonical GST rule and store its GST
 *     (taxable lines are GST-exclusive; damage and FASTag are not taxed)
 *  4. Apply the optional drop discount — pre-tax, split pro-rata between taxable
 *     and non-taxable charges, capped at the drop charges
 *  5. With the booking row locked: create/return the one open RETURN session,
 *     void previous entries and re-add every line — a recompute is a full rebuild
 *  6. Apply safety deposit credit as a PAYMENT entry (reduces netPayable)
 *  7. Store chargeBreakdown / bill / km / late / discount / billed endAt and the
 *     frozen return time in session.metadata
 *  8. Transition session to AWAITING_PAYMENT
 *  9. Return session with full charge + GST + balance breakdown
 *
 * The return time is the server time of the first compute, kept on the session
 * so the late charge doesn't grow while staff inspect the car; it resets only
 * when booking.endAt changes (an extension). The driving-licence-returned tick
 * was removed from the drop: `licenseReturned` is accepted and ignored.
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
  getOdometerSegments,
  serializeKmCharge,
  KmAllowanceUnavailableError,
  type KmAllowance,
} from "../../services/charges/km-allowance.service.js";
import {
  DROP_DAMAGE_REF,
  DROP_DISCOUNT_REF,
  dropDamageAmount,
  lockBookingForDrop,
} from "../../services/damage/drop-damage.service.js";
import {
  resolveLateReturnPolicy,
  calculateLateReturnCharge,
  lateReturnLabel,
  serializeLateReturn,
  LateReturnRateUnavailableError,
  type SerializedLateReturn,
} from "../../services/charges/late-return.service.js";
import {
  buildDropBill,
  serializeDropBill,
  isTaxableDropLine,
  OTHER_CHARGE_REF,
  LATE_RETURN_REF,
  VEHICLE_SWAP_REF,
  type DropChargeLine,
} from "../../services/charges/drop-bill.service.js";
import { getRentalTimeline, activeExtensionState } from "../../services/charges/rental-timeline.service.js";
import {
  getBranchGstRates,
  GstRuleMissingError,
  type BranchGstRates,
} from "../../services/tax/gst.service.js";

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
  // Deprecated: the driving-licence-returned tick was removed from the drop.
  // Older app builds still send it — accepted and ignored.
  licenseReturned: z.boolean().optional(),
  discount: z
    .object({
      amount: z.coerce.number().positive("Discount must be more than ₹0"),
      reason: z.string().trim().min(3, "Give a reason for the discount (at least 3 characters)"),
    })
    .nullable()
    .optional(),
  // Late return: "Apply grace" for branches on MANUAL grace (ignored otherwise)
  applyGrace: z.boolean().optional(),
  // Late return: staff waive the automatic late charge — the reason is audit-logged
  waiveLateCharge: z
    .object({
      reason: z.string().trim().min(3, "Give a reason for waiving the late charge (at least 3 characters)"),
    })
    .nullable()
    .optional(),
  // Extra km typed by staff — used only after a mid-rental swap recorded without odometer readings
  manualExtraKm: z.coerce
    .number()
    .int("Extra km must be a whole number")
    .min(0, "Extra km can't be negative")
    .max(100000, "Extra km looks too large — check the figure")
    .nullable()
    .optional(),
});

/** Request fields whose validation message is shown to staff as-is. */
const MESSAGE_FIELDS = new Set(["discount", "waiveLateCharge", "manualExtraKm"]);

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

/** 409 body while a committed extension is unpaid or its cash awaits the manager. */
function extensionPendingBody(extension: { publicId: string; extensionStatus: ExtensionStatus }) {
  return {
    code: "EXTENSION_PENDING",
    message:
      extension.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED
        ? "The extension's cash payment is waiting for the branch manager to confirm it. Ask them to confirm it, then compute the drop bill."
        : "Collect or cancel the pending extension before computing the drop bill.",
    pendingExtensionPublicId: extension.publicId,
    pendingExtensionStatus: extension.extensionStatus,
  };
}

/** 409 body for a legacy drop already sent for the manager's confirmation. */
const RETURN_AWAITING_MANAGER_BODY = {
  code: "RETURN_AWAITING_MANAGER",
  message: "This return is already recorded and is waiting for the branch manager to confirm it.",
};

const GST_RULE_MISSING_BODY = (err: GstRuleMissingError) => ({
  code: err.code,
  message: "GST rates aren't set up for this branch, so taxable drop charges can't be billed. Ask the branch manager to set the GST rule.",
});

/** Taxable lines need the branch GST rule; a bill with none taxable doesn't. */
async function ratesFor(lines: DropChargeLine[], branchId: number, tx: TxClient): Promise<BranchGstRates | null> {
  if (!lines.some((l) => isTaxableDropLine(l))) return null;
  return getBranchGstRates(branchId, tx);
}

// ── POST /employee/bookings/:bookingId/return/session/compute ──────────────────

export const ComputeReturnSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = computeReturnSessionSchema.safeParse(req.body);
    if (!validation.success) {
      const shownIssue = validation.error.issues.find((i) => MESSAGE_FIELDS.has(String(i.path[0])));
      return res.status(StatusCode.BAD_REQUEST).json({
        message: shownIssue?.message ?? "Validation failed",
        errors: validation.error.format(),
      });
    }
    const {
      endOdometer,
      returnImageIds,
      returnFuelLevel,
      fuelCharge,
      fastagAmount,
      fastagNotes,
      otherCharges,
      discount,
      applyGrace,
      waiveLateCharge,
      manualExtraKm,
    } = validation.data;
    // The moment the vehicle came back, unless an earlier compute of this bill already fixed it
    const requestTime = new Date();

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

    // A drop already recorded and sent for the manager's confirmation is not billed again
    if (booking.requiresManagerConfirmation) {
      return res.status(StatusCode.CONFLICT).json(RETURN_AWAITING_MANAGER_BODY);
    }

    // Feature flag check
    const usePaymentSessions = booking.branch?.chargeConfig?.usePaymentSessions ?? false;
    if (!usePaymentSessions) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Payment session flow is not enabled for this branch. Use the legacy return-charges endpoint.",
      });
    }

    // A committed-but-unpaid extension has already moved endAt — it must not earn free km
    const extensionState = await activeExtensionState(booking.activeExtensionId);
    if (extensionState.blocking) {
      return res.status(StatusCode.CONFLICT).json(extensionPendingBody(extensionState.blocking));
    }

    // Km across mid-rental swaps: each swap with readings closes a segment on the
    // old car. A swap recorded without readings makes km unmeasurable — then only
    // a staff-entered extra km is billed.
    const segments = await getOdometerSegments(booking.id);
    const vehicleSwapped = !segments.complete;

    if (!vehicleSwapped && segments.currentStartOdometer != null && endOdometer < segments.currentStartOdometer) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "END_ODOMETER_TOO_LOW",
        message: segments.swapCount > 0
          ? `End odometer can't be less than the replacement vehicle's reading at the swap (${segments.currentStartOdometer} km).`
          : `End odometer can't be less than the pickup reading (${segments.currentStartOdometer} km).`,
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
    const km = calculateKmCharge(segments.currentStartOdometer, endOdometer, allowance, vehicleSwapped, {
      priorKm: segments.priorKm,
      manualExtraKm: vehicleSwapped ? manualExtraKm ?? null : null,
    });

    // Late return — the policy and rate are read now; the minutes are worked out under
    // the lock against the return time frozen on the session
    const latePolicy = await resolveLateReturnPolicy(booking.id);

    // Drop charge lines from the request (skip zero-amount entries); late, swap and
    // damage lines are added under the lock. Taxable lines carry their taxable value.
    const requestCharges: DropChargeLine[] = [];
    if (km.extraKmCharge.gt(0)) {
      requestCharges.push({
        type: LedgerEntryType.EXTRA_KM,
        label: km.kmSource === "STAFF_ENTERED"
          ? `Extra km (entered at drop, vehicle swapped): ${km.extraKm} km × ₹${km.extraKmRate.toFixed(2)}`
          : `Extra km: ${km.extraKm} km × ₹${km.extraKmRate.toFixed(2)}`,
        amount: km.extraKmCharge,
        referenceType: LedgerEntryType.EXTRA_KM,
        metadata: {
          kmSource: km.kmSource,
          extraKm: km.extraKm,
          rate: km.extraKmRate.toFixed(2),
          kmDriven: km.kmDriven,
          includedKm: km.includedKm,
        },
      });
    }
    if (fuelCharge && fuelCharge > 0) {
      requestCharges.push({ type: LedgerEntryType.FUEL, label: "Fuel deficit charge", amount: new Decimal(fuelCharge).toDecimalPlaces(2), referenceType: LedgerEntryType.FUEL });
    }
    if (fastagAmount && fastagAmount > 0) {
      requestCharges.push({ type: LedgerEntryType.FASTAG, label: fastagNotes ? `FASTag: ${fastagNotes}` : "FASTag charges", amount: new Decimal(fastagAmount).toDecimalPlaces(2), referenceType: LedgerEntryType.FASTAG });
    }
    // Free-form "other charges" are service charges (taxable), kept on the DAMAGE ledger
    // type for older readers but told apart from real damage by their reference type
    for (const other of otherCharges ?? []) {
      if (other.amount > 0) {
        requestCharges.push({ type: LedgerEntryType.DAMAGE, label: other.label, amount: new Decimal(other.amount).toDecimalPlaces(2), referenceType: OTHER_CHARGE_REF });
      }
    }

    const kmData = serializeKmCharge(km, segments);

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
          safetyDeposit: true,
        },
      });
      if (locked.status !== BookingStatus.PICKED_UP) {
        throw new ComputeRejection(StatusCode.BAD_REQUEST, {
          message: `Cannot compute return session. Booking status: ${locked.status}`,
        });
      }
      const lockedExtension = await activeExtensionState(locked.activeExtensionId, tx as any);
      if (lockedExtension.blocking) {
        throw new ComputeRejection(StatusCode.CONFLICT, extensionPendingBody(lockedExtension.blocking));
      }
      if (locked.endAt.getTime() !== allowance.periodEndAt.getTime()) {
        throw new ComputeRejection(StatusCode.CONFLICT, {
          message: "The rental period changed while the drop bill was being computed. Try again.",
        });
      }
      // A customer quote that was never committed holds no slot and no money —
      // release it so it can't be paid for after the vehicle is back.
      if (lockedExtension.uncommittedQuoteId != null) {
        await tx.bookingExtension.update({
          where: { id: lockedExtension.uncommittedQuoteId },
          data: {
            extensionStatus: ExtensionStatus.CANCELLED,
            rejectionReason: "Released at drop: the vehicle was returned before the quote was paid",
          },
        });
        await tx.booking.update({ where: { id: booking.id }, data: { activeExtensionId: null } });
      }

      // Create or return the booking's open RETURN session — under the lock there is only ever one
      const session = await paymentSessionService.createSession(
        booking.id,
        booking.branchId,
        PaymentSessionType.RETURN,
        actor.id,
        tx as any,
      );
      const previousMeta = (session.metadata ?? null) as Record<string, any> | null;
      const previousDiscount = (previousMeta?.discount ?? null) as { amount: string; reason: string } | null;
      const previousLate = (previousMeta?.late ?? null) as SerializedLateReturn | null;
      const previousManualExtraKm = (previousMeta?.km?.manualExtraKm ?? null) as number | null;

      // Return time — fixed at the first compute of this bill so the late charge doesn't
      // grow while staff inspect the car; a changed endAt (extension) restarts it.
      const billStillCurrent =
        previousMeta?.bookingEndAt != null &&
        new Date(previousMeta.bookingEndAt).getTime() === locked.endAt.getTime();
      const returnedAt = billStillCurrent && previousMeta?.returnedAt
        ? new Date(previousMeta.returnedAt)
        : requestTime;

      // Late return beyond endAt without a formal extension
      const late = calculateLateReturnCharge(locked.endAt, returnedAt, latePolicy, {
        applyGrace: applyGrace === true,
        waive: waiveLateCharge != null,
      });
      if (late.status === "RATE_UNAVAILABLE") {
        const rateErr = new LateReturnRateUnavailableError();
        throw new ComputeRejection(StatusCode.CONFLICT, {
          code: rateErr.code,
          message: rateErr.message,
          lateMinutes: late.lateMinutes,
        });
      }
      const lateWaiver = late.status === "WAIVED" && waiveLateCharge ? { reason: waiveLateCharge.reason } : null;

      const manualCharges: DropChargeLine[] = [...requestCharges];
      if (late.status === "CHARGED" && late.amount.gt(0)) {
        manualCharges.push({
          type: LedgerEntryType.EXTRA_TIME,
          label: lateReturnLabel(late),
          amount: late.amount,
          referenceType: LATE_RETURN_REF,
          metadata: {
            dueAt: late.dueAt.toISOString(),
            returnedAt: late.returnedAt.toISOString(),
            lateMinutes: late.lateMinutes,
            graceMinutes: late.graceMinutes,
            graceApplied: late.graceApplied,
            hours: late.hours,
            rate: late.rate?.toFixed(2) ?? null,
          },
        });
      }

      // Vehicle-swap difference staff chose to bill at the swap (pre-GST, one line per swap)
      const chargedSwaps = await tx.vehicleSwap.findMany({
        where: { bookingId: booking.id, chargeDifference: true, priceDifference: { gt: 0 } },
        orderBy: { swappedAt: "asc" },
        select: {
          publicId: true,
          priceDifference: true,
          originalVehicle: { select: { regNo: true } },
          newVehicle: { select: { regNo: true } },
        },
      });
      for (const swap of chargedSwaps) {
        manualCharges.push({
          type: LedgerEntryType.VEHICLE_SWAP,
          label: `Vehicle upgrade: ${swap.originalVehicle.regNo} → ${swap.newVehicle.regNo}`,
          amount: new Decimal(swap.priceDifference.toString()),
          referenceType: VEHICLE_SWAP_REF,
          referenceId: swap.publicId,
        });
      }

      // Damage the customer agreed to pay at drop (recorded via /return/damages)
      const dropDamages = await tx.damageReport.findMany({
        where: { bookingId: booking.id, chargedAtDrop: true },
        select: { publicId: true, severity: true, notes: true, finalCost: true, estimatedCost: true },
        orderBy: { createdAt: "asc" },
      });

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

      // GST rates frozen onto this bill's lines — only needed when a line is taxable
      let rates: BranchGstRates | null;
      try {
        rates = await ratesFor(manualCharges, booking.branchId, tx as any);
      } catch (ratesErr) {
        if (ratesErr instanceof GstRuleMissingError) {
          throw new ComputeRejection(StatusCode.CONFLICT, GST_RULE_MISSING_BODY(ratesErr));
        }
        throw ratesErr;
      }

      const totalManualCharges = manualCharges.reduce((sum, c) => sum.plus(c.amount), new Decimal(0));

      // Drop discount — pre-tax, re-applied on every compute from what the client sends,
      // capped at the drop charges (before GST)
      const discountAmount = discount ? new Decimal(discount.amount).toDecimalPlaces(2) : new Decimal(0);
      if (discountAmount.gt(totalManualCharges)) {
        throw new ComputeRejection(StatusCode.BAD_REQUEST, {
          code: "DISCOUNT_EXCEEDS_CHARGES",
          message: `Discount can't be more than the drop charges before GST (₹${totalManualCharges.toFixed(2)}).`,
        });
      }
      const discountData = discount && discountAmount.gt(0)
        ? { amount: discountAmount.toFixed(2), reason: discount.reason }
        : null;

      const bill = buildDropBill(manualCharges, discountData ? discountAmount : new Decimal(0), rates);
      const billData = serializeDropBill(bill);
      const lateLine = bill.lines.find((l) => l.referenceType === LATE_RETURN_REF);
      const lateData = serializeLateReturn(
        late,
        lateLine && rates ? { cgst: lateLine.cgst, sgst: lateLine.sgst, gst: lateLine.gst, rate: new Decimal(rates.rate) } : null,
        lateWaiver,
      );
      // What the drop charges come to, GST included and after the discount
      const netDropCharges = bill.total;

      const safetyDeposit = new Decimal(locked.safetyDeposit?.toString() ?? "0");

      // Build chargeBreakdown for metadata / display (the drop discount shows as waived).
      // subtotal / waivedTotal / finalTotal are before GST; gstAmount and totalWithGst add it.
      const chargeBreakdown = {
        subtotal: bill.subtotal.toFixed(2),
        waivedTotal: bill.discount ? bill.discount.amount.toFixed(2) : "0.00",
        finalTotal: bill.subtotal.minus(bill.discount?.amount ?? 0).toFixed(2),
        gstAmount: bill.gst.toFixed(2),
        totalWithGst: bill.total.toFixed(2),
        charges: bill.lines.map((c) => ({
          chargeType: c.type,
          moduleKey: c.type.toLowerCase(),
          label: c.label,
          originalAmount: c.amount.toFixed(2),
          finalAmount: c.amount.toFixed(2),
          quantity: null,
          unitRate: null,
          isOverridden: false,
          notes: null,
          referenceType: c.referenceType,
          referenceId: c.referenceId ?? null,
          taxable: c.taxable,
          cgst: c.cgst.toFixed(2),
          sgst: c.sgst.toFixed(2),
          gstAmount: c.gst.toFixed(2),
          totalWithGst: c.total.toFixed(2),
        })),
      };

      // Void every previously computed entry (recompute case) — read inside this transaction
      const existingEntries = session.entries?.filter((e: any) => !e.isVoided) ?? [];
      for (const e of existingEntries) {
        await ledgerService.voidEntry(e.publicId, actor.id, "Return charges recomputed", tx as any);
      }

      // Add drop charge entries — a taxable line's amount is its taxable value and its
      // GST (rate frozen in metadata) sits in gstAmount on top
      for (const [index, charge] of bill.lines.entries()) {
        const gstMeta = charge.taxable && rates
          ? {
              cgst: charge.cgst.toFixed(2),
              sgst: charge.sgst.toFixed(2),
              cgstRate: rates.cgstRate,
              sgstRate: rates.sgstRate,
            }
          : null;
        const metadata = charge.metadata || gstMeta ? { ...(charge.metadata ?? {}), ...(gstMeta ?? {}) } : undefined;
        await ledgerService.addEntry(
          session.id,
          booking.id,
          charge.type,
          charge.taxable ? LedgerEntryClassification.TAXABLE : LedgerEntryClassification.NON_TAXABLE,
          charge.amount,
          charge.label,
          actor.id,
          String(actor.role),
          {
            baseAmount: charge.amount,
            gstAmount: charge.gst,
            idempotencyKey: `return:${session.id}:${computeRef}:charge:${index}`,
            referenceType: charge.referenceType,
            referenceId: charge.referenceId,
            metadata,
          },
          tx as any,
        );
      }

      // Drop discount — a pre-tax discount capped at the drop charges above, so it never eats
      // into the deposit refund. Same convention as the counter coupon: amount = −(discount +
      // the GST it takes off) so netPayable is right, baseAmount = −the share that reduced
      // taxable charges, gstAmount = −GST taken off; the non-taxable share is the rest
      // (|amount| − |baseAmount| − |gstAmount|, also in metadata.nonTaxableShare).
      if (discountData && bill.discount) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.DISCOUNT,
          LedgerEntryClassification.DISCOUNT,
          bill.discount.amount.plus(bill.discount.gst).negated(),
          bill.discount.gst.gt(0)
            ? `Drop discount: ${discountData.reason} (₹${bill.discount.amount.toFixed(2)} + GST ₹${bill.discount.gst.toFixed(2)})`
            : `Drop discount: ${discountData.reason}`,
          actor.id,
          String(actor.role),
          {
            baseAmount: bill.discount.taxableShare.negated(),
            gstAmount: bill.discount.gst.negated(),
            idempotencyKey: `return:${session.id}:${computeRef}:discount`,
            referenceType: DROP_DISCOUNT_REF,
            metadata: {
              reason: discountData.reason,
              taxableShare: bill.discount.taxableShare.toFixed(2),
              nonTaxableShare: bill.discount.nonTaxableShare.toFixed(2),
              cgst: bill.discount.cgst.negated().toFixed(2),
              sgst: bill.discount.sgst.negated().toFixed(2),
              ...(rates && { cgstRate: rates.cgstRate, sgstRate: rates.sgstRate }),
            },
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

      // Store chargeBreakdown / bill / km / late / discount in session metadata for page-reload
      // restoration, plus the rental period billed (a later extension marks the bill stale) and
      // the frozen return time (reused by recomputes, written to Booking.returnedAt at completion).
      await (tx as any).paymentSession.update({
        where: { id: session.id },
        data: {
          metadata: {
            chargeBreakdown,
            bill: billData,
            km: kmData,
            late: lateData,
            discount: discountData,
            applyGrace: applyGrace === true,
            bookingEndAt: locked.endAt.toISOString(),
            returnedAt: returnedAt.toISOString(),
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
          // Unknown after a mid-rental swap recorded without readings
          totalKmDriven: km.autoKmSkipped ? null : km.kmDriven,
          freeKmLimit: km.includedKm,
          extraKmCharged: km.extraKm,
        },
      });

      return {
        session,
        previousDiscount,
        previousLate,
        previousManualExtraKm,
        dropDamages,
        manualCharges,
        totalManualCharges,
        discountData,
        netDropCharges,
        safetyDeposit,
        chargeBreakdown,
        billData,
        lateData,
        chargedSwaps,
        releasedQuoteId: lockedExtension.uncommittedQuoteId,
      };
    }, { timeout: 30000 });

    const {
      session,
      previousDiscount,
      previousLate,
      previousManualExtraKm,
      dropDamages,
      manualCharges,
      totalManualCharges,
      discountData,
      netDropCharges,
      safetyDeposit,
      chargeBreakdown,
      billData,
      lateData,
      chargedSwaps,
      releasedQuoteId,
    } = computed;

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
        gstAmount: billData.gst,
        finalTotal: netDropCharges.toFixed(2),
        safetyDepositCredit: safetyDeposit.toFixed(2),
        chargeCount: manualCharges.length,
        km: kmData,
        late: lateData,
        vehicleSwapLines: chargedSwaps.map((s) => s.publicId),
        dropDamages: dropDamages.map((d) => d.publicId),
        ...(releasedQuoteId != null && { releasedExtensionQuoteId: releasedQuoteId }),
      },
    });

    // Late-charge waiver is audit-logged with its reason whenever it is given, changed or removed
    const waiverChanged =
      lateData.waived !== (previousLate?.waived ?? false) ||
      (lateData.waived &&
        (lateData.waiverReason !== previousLate?.waiverReason || lateData.waivedAmount !== previousLate?.waivedAmount));
    if (waiverChanged) {
      await auditService.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: lateData.waived ? "RETURN_LATE_CHARGE_WAIVED" : "RETURN_LATE_CHARGE_WAIVER_REMOVED",
        category: AuditCategory.CHARGE,
        description: lateData.waived
          ? `Late return charge of ₹${lateData.waivedAmount} (${lateData.hours} hr, before GST) waived on booking ${booking.publicId}: ${lateData.waiverReason}`
          : `Late return charge waiver removed on booking ${booking.publicId}`,
        entity: "PaymentSession",
        entityId: session.publicId,
        metadata: { late: lateData, previousLate },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: lateData.waived ? StaffActionType.OVERRIDDEN : StaffActionType.UPDATED,
        entityType: StaffEntityType.PAYMENT_SESSION,
        entityRef: session.publicId,
        description: lateData.waived
          ? `Late return charge ₹${lateData.waivedAmount} waived on booking ${bookingId}: ${lateData.waiverReason}`
          : `Late return charge waiver removed on booking ${bookingId}`,
        metadata: { lateMinutes: lateData.lateMinutes, hours: lateData.hours, waiverReason: lateData.waiverReason },
      });
    }

    // Staff-entered extra km (after a swap without readings) is audit-logged when it changes
    if (kmData.kmSource === "STAFF_ENTERED" && kmData.manualExtraKm !== previousManualExtraKm) {
      await auditService.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: "RETURN_MANUAL_EXTRA_KM",
        category: AuditCategory.CHARGE,
        description: `Extra km entered by staff on booking ${booking.publicId} (vehicle swapped without odometer readings): ${kmData.manualExtraKm} km × ₹${kmData.extraKmRate} = ₹${kmData.extraKmCharge} before GST`,
        entity: "PaymentSession",
        entityId: session.publicId,
        metadata: { km: kmData, previousManualExtraKm },
      });
    }

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
    const rentalTimeline = await getRentalTimeline(booking.id, { late: lateData });
    return res.status(StatusCode.OK).json({
      message: "Return session computed",
      data: {
        session: serializeReturnSession(updatedSession!),
        chargeBreakdown,
        km: kmData,
        discount: discountData,
        late: lateData,
        bill: billData,
        rentalTimeline,
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
      select: { id: true, endAt: true },
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

    // Read chargeBreakdown / bill / km / late / discount stored in metadata during compute
    // (may be null for sessions computed before they were stored)
    const meta = session.metadata as any;
    const chargeBreakdown = meta?.chargeBreakdown ?? null;
    // The bill is stale once endAt moved (an extension) — the client must recompute
    const billStale = meta?.bookingEndAt != null && new Date(meta.bookingEndAt).getTime() !== booking.endAt.getTime();
    const rentalTimeline = await getRentalTimeline(booking.id, { late: billStale ? null : meta?.late ?? null });

    return res.status(StatusCode.OK).json({
      message: "Return session fetched",
      data: {
        session: serializeReturnSession(session),
        chargeBreakdown,
        km: meta?.km ? { autoKmSkipped: null, ...meta.km } : null,
        discount: meta?.discount ?? null,
        late: meta?.late ?? null,
        bill: meta?.bill ?? null,
        returnedAt: meta?.returnedAt ?? null,
        billStale,
        rentalTimeline,
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
      baseAmount: new Decimal(e.baseAmount?.toString() ?? "0").toFixed(2),
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      cgst: e.metadata?.cgst ?? "0.00",
      sgst: e.metadata?.sgst ?? "0.00",
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}
