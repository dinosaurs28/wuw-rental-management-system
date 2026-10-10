import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  ExtensionTrigger,
  ExtensionResolutionType,
  Role,
  PaymentPurpose,
  RentalPeriodType,
} from "@repo/database/client";
import type { BookingExtension } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { AuditSeverity } from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { extensionAvailabilityService } from "./extension-availability.service.js";
import {
  extensionPricingService,
  extensionSplitData,
  extensionSplitView,
  type ExtensionPricingResult,
} from "./extension-pricing.service.js";
import { refreshInvoiceTotals } from "../invoice-totals.service.js";
import { displayEmail } from "../../utils/customer/identity.js";
import { extensionConflictResolverService, type ConflictResolutionOptions } from "./extension-conflict-resolver.service.js";
import { extensionVehicleAllocatorService } from "./extension-vehicle-allocator.service.js";
import { extensionLockService } from "./extension-lock.service.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { claimUtr } from "../payment/counter-guard.service.js";
import { claimCounterUpi, type CounterUpi } from "../payment/payment-proof.service.js";
import { addFleetCredit, voidPendingCreditOnCancel } from "../payment/customer-credit.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { discountApplicationService } from "../discount/discount-application.service.js";
import { assertExtensionWindow } from "../../utils/booking/bookingWindow.js";
import {
  loadBranchScheduleConfig,
  validateReturnTime,
  BranchScheduleError,
} from "../../utils/booking/branchScheduleValidator.js";
import { refreshBookingPeriodFields } from "../../utils/booking/rentalPeriod.js";
import { assertDlFree, lockAndAssertDlFree } from "../booking/dl-in-use.service.js";
import { assertExtensionQrsClosedForCancel } from "../payment/upi-qr.service.js";
import {
  extensionFreeKm,
  extensionMinutes,
  loadFreeKmRates,
  type ExtensionFreeKm,
} from "../charges/extension-km.js";

export interface ActorContext {
  actorId: number;
  actorPublicId: string;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  branchName: string;
}

export interface EvaluationResolutionOption {
  type: string;
  label: string;
  description: string;
  availableVehicles?: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  affectedBookings?: Array<{ bookingPublicId: string; newVehicle: { publicId: string; make: string; model: string; regNo: string } }>;
  partialNewEndAt?: string;
  additionalAmount: string;
  newTotalFinal: string;
  /** Free km this option's extension adds (#7) — for a partial option, up to partialNewEndAt. */
  extensionFreeKm?: ExtensionFreeKm | null;
}

export interface ExtensionEvaluation {
  extensionPublicId: string;
  bookingPublicId: string;
  oldEndAt: string;
  requestedEndAt: string;
  pricing: {
    originalDays: number;
    newDays: number;
    originalTotalFinal: string;
    newTotalFinal: string;
    additionalAmount: string;
    // GST split of additionalAmount (= taxableAmount + taxAmount)
    baseAmount: string;
    discountAmount: string;
    taxableAmount: string;
    taxAmount: string;
    cgstAmount: string;
    sgstAmount: string;
    taxRate: string;
    originalHours: number;
    extensionHours: number;
    /**
     * Free km the extension adds to the drop allowance (#7): whole 24 h →
     * freeKm24Hour, a remaining ≥ 12 h → freeKm12Hour, other hours → 0.
     * null when the vehicle's free km can't be read.
     */
    extensionFreeKm: ExtensionFreeKm | null;
  };
  resolutionOptions: EvaluationResolutionOption[];
  recommendedResolution: string;
}

export interface CommitExtensionInput {
  extensionPublicId: string;
  resolutionType: "SAME_VEHICLE" | "SWAP_CURRENT_TO_OTHER" | "SWAP_FUTURE_BOOKING" | "PARTIAL_EXTENSION";
  selectedVehiclePublicId?: string;
  affectedBookingSwaps?: Array<{ bookingPublicId: string; newVehiclePublicId: string }>;
  partialNewEndAt?: string;
  idempotencyKey: string;
  notes?: string;
}

export interface CommitExtensionResult {
  extension: BookingExtension;
  remainAmount: {
    extension: string;
  };
}

export interface CollectExtensionOptions {
  /** "UPI" for a counter UPI payment — `onlineTransactionRef` is then a validated UTR (or null with a proof photo). */
  onlineGateway?: string;
  /** Counter UPI backing (photo / UTR) already validated by the caller; claimed in the write (#3). */
  upi?: CounterUpi | null;
  /** SPLIT: the cash and UPI parts (they add up to the extension amount). */
  split?: { cash: Decimal; online: Decimal };
  /** CREDIT: the collateral held until the branch manager clears it (#11). */
  collateral?: string;
}

export interface CollectExtensionResult {
  remainAmount: {
    extension: string;
  };
  payment: "pending" | "confirmed";
  /** Set when the extension was put on customer credit (it is confirmed; the amount stays owed). */
  credit?: { creditEntryPublicId: string; sectionKey: string; amount: string; collateral: string } | null;
}

export interface PaginatedExtensions {
  extensions: BookingExtension[];
  total: number;
  page: number;
  pageSize: number;
}

// Extensions apply before pickup (CONFIRMED) and while the car is out (PICKED_UP)
const EXTENDABLE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

/** collect() refused: the charge is already on an open pickup payment session (409). */
export const EXTENSION_IN_SESSION = "EXTENSION_IN_SESSION";

/**
 * Evaluate refused because the booking already has a committed (vehicle held)
 * or paid-but-unconfirmed extension. Controllers answer 409 EXTENSION_PENDING
 * with the extension's id so staff can cancel a stale one and try again.
 */
export class ExtensionPendingError extends Error {
  readonly code = "EXTENSION_PENDING" as const;

  constructor(
    public readonly pendingExtensionPublicId: string,
    public readonly pendingExtensionStatus: ExtensionStatus,
  ) {
    super(
      pendingExtensionStatus === ExtensionStatus.PAYMENT_COLLECTED
        ? "A pending extension already exists for this booking — its payment is awaiting manager confirmation."
        : "A pending extension already exists for this booking. Complete or cancel it before creating a new one.",
    );
    this.name = "ExtensionPendingError";
  }

  toJSON() {
    return {
      message: this.message,
      code: this.code,
      pendingExtensionPublicId: this.pendingExtensionPublicId,
      pendingExtensionStatus: this.pendingExtensionStatus,
    };
  }
}

class ExtensionService {
  /**
   * Evaluate an extension request: check availability, compute pricing,
   * generate resolution options, and persist a PENDING_PAYMENT record.
   */
  async evaluate(
    bookingPublicId: string,
    newEndAtStr: string,
    trigger: ExtensionTrigger,
    actor: ActorContext,
    notes?: string,
  ): Promise<ExtensionEvaluation> {
    const newEndAt = new Date(newEndAtStr);

    // Load booking with first vehicle item
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      include: {
        items: {
          include: { vehicle: { include: { category: true } } },
        },
      },
    });

    if (!booking) throw new Error("Booking not found");

    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot extend a booking in status ${booking.status}. Extension is only allowed for CONFIRMED or PICKED_UP bookings.`,
      );
    }

    if (newEndAt <= booking.endAt) {
      throw new Error("New end date must be after the current end date");
    }

    // 15-day booking window (#15), measured from the original start so chained
    // extensions can't pass it. Monthly-plan bookings are only held to their
    // own maximum length. Throws BookingWindowError (400).
    assertExtensionWindow(booking.startAt, newEndAt, {
      monthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY,
    });

    // The new end must fall inside the branch's return window (#2) — an open
    // day, from opening to closing + grace. Throws BranchScheduleError (400).
    // Only the requested end is checked: a system-computed partial end
    // (PARTIAL_EXTENSION / narrowQuote) is never refused for office hours.
    const scheduleConfig = await loadBranchScheduleConfig(booking.branchId);
    if (scheduleConfig) {
      const returnVerdict = validateReturnTime(scheduleConfig, newEndAt);
      if (returnVerdict.status === "RETURN_OUTSIDE_HOURS") {
        throw new BranchScheduleError(returnVerdict);
      }
    }

    // One vehicle per driving licence (X3): the added time must not overlap
    // another active booking on the same DL. Throws DlInUseError (409).
    await assertDlFree({
      customerId: booking.customerId,
      mode: "extend",
      window: { startAt: booking.endAt, endAt: newEndAt },
      excludeBookingId: booking.id,
    });

    // Prevent concurrent extensions
    if (booking.activeExtensionId !== null) {
      const active = await prisma.bookingExtension.findUnique({
        where: { id: booking.activeExtensionId },
        select: {
          id: true,
          publicId: true,
          extensionStatus: true,
          resolutionType: true,
          gatewayTransactionId: true,
          paymentTransactionId: true,
        },
      });
      const isOpen =
        active?.extensionStatus === ExtensionStatus.PENDING_PAYMENT ||
        active?.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED;
      // A quote that was never committed holds no vehicle slot and no money —
      // a new quote replaces it instead of blocking the booking.
      const isUncommittedQuote =
        active?.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
        active.resolutionType === null &&
        active.gatewayTransactionId === null &&
        active.paymentTransactionId === null;
      if (active && isOpen && !isUncommittedQuote) {
        throw new ExtensionPendingError(active.publicId, active.extensionStatus);
      }
      if (active && isUncommittedQuote) {
        await prisma.$transaction([
          prisma.bookingExtension.update({
            where: { id: active.id },
            data: {
              extensionStatus: ExtensionStatus.CANCELLED,
              rejectionReason: "Superseded by a new extension quote",
            },
          }),
          prisma.booking.update({
            where: { id: booking.id },
            data: { activeExtensionId: null },
          }),
        ]);
      }
    }

    const firstItem = booking.items[0];
    if (!firstItem) throw new Error("Booking has no vehicle items");

    const currentVehicle = firstItem.vehicle;
    const categoryRank = currentVehicle.category.rank;

    // Compute pricing for new end date
    const pricing = await extensionPricingService.recalculate(booking.id, newEndAt);

    // Compute resolution options
    const resolutionOptions = await extensionConflictResolverService.resolve(
      booking.id,
      currentVehicle.id,
      categoryRank,
      booking.branchId,
      booking.endAt,
      newEndAt,
    );

    // Persist the pending extension record
    const extension = await prisma.bookingExtension.create({
      data: {
        publicId: createID(),
        bookingId: booking.id,
        branchId: booking.branchId,
        extensionTrigger: trigger,
        extensionStatus: ExtensionStatus.PENDING_PAYMENT,
        oldEndAt: booking.endAt,
        requestedEndAt: newEndAt,
        additionalAmount: pricing.additionalAmount,
        newTotalFinal: pricing.newTotalFinal,
        ...extensionSplitData(pricing),
        actorId: actor.actorId,
        actorPublicId: actor.actorPublicId,
        actorRole: actor.actorRole,
        notes,
      },
    });

    // Mark booking with active extension
    await prisma.booking.update({
      where: { id: booking.id },
      data: { activeExtensionId: extension.id },
    });

    // Audit + staff activity
    await Promise.all([
      auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: "Extension evaluated",
        category: AuditCategory.BOOKING,
        severity: AuditSeverity.INFO,
        entity: "BookingExtension",
        entityId: extension.publicId,
        description: `Extension evaluated for booking ${bookingPublicId} — new end ${newEndAt.toISOString()}`,
        after: {
          requestedEndAt: newEndAt,
          additionalAmount: pricing.additionalAmount.toFixed(2),
          recommendedResolution: resolutionOptions.recommendedOption,
        },
      }),
      staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.INITIATED,
        entityType: StaffEntityType.BOOKING_EXTENSION,
        entityRef: extension.publicId,
        description: `Extension evaluation initiated for booking ${bookingPublicId}`,
      }),
    ]);

    // Compute original booking duration for the pricing summary
    const originalDays = Math.max(1, Math.ceil(
      (booking.endAt.getTime() - booking.startAt.getTime()) / (1000 * 60 * 60 * 24)
    ));

    const resolutionLabels: Record<string, string> = {
      SAME_VEHICLE: "Same vehicle (no conflict)",
      SWAP_CURRENT_TO_OTHER: "Swap to an available equivalent vehicle",
      SWAP_FUTURE_BOOKING: "Reassign the conflicting booking's vehicle",
      PARTIAL_EXTENSION: "Partial extension (until last available date)",
      NO_RESOLUTION: "No extension available",
    };

    const additionalAmountStr = pricing.additionalAmount.toFixed(2);
    const newTotalFinalStr = pricing.newTotalFinal.toFixed(2);

    // Free km the extension adds (#7), at the current vehicle's slab free km.
    // Shown on the quote only — the price above is unaffected.
    const freeKmRates = await loadFreeKmRates(
      { vehicleId: currentVehicle.id, categoryId: currentVehicle.categoryId },
      booking.branchId,
    ).catch((err) => {
      console.warn(`[extension] Free km rates unavailable for booking ${bookingPublicId}:`, err);
      return null;
    });
    const freeKmUntil = (end: Date) =>
      freeKmRates ? extensionFreeKm(extensionMinutes(booking.endAt, end), freeKmRates) : null;

    return {
      extensionPublicId: extension.publicId,
      bookingPublicId: booking.publicId,
      oldEndAt: booking.endAt.toISOString(),
      requestedEndAt: newEndAt.toISOString(),
      pricing: {
        originalDays,
        newDays: pricing.newDays,
        originalTotalFinal: new Decimal(booking.totalFinal.toString()).toFixed(2),
        newTotalFinal: newTotalFinalStr,
        additionalAmount: additionalAmountStr,
        ...extensionSplitView(pricing),
        originalHours: pricing.originalHours,
        extensionHours: pricing.extensionHours,
        extensionFreeKm: freeKmUntil(newEndAt),
      },
      resolutionOptions: resolutionOptions.options.map(opt => ({
        type: opt.type,
        label: resolutionLabels[opt.type] ?? opt.type,
        description: opt.description,
        availableVehicles: opt.alternativeVehicles?.map(v => ({
          publicId: v.publicId,
          make: v.make,
          model: v.model,
          regNo: v.regNo,
        })),
        affectedBookings: opt.futureBookingSwaps?.map(swap => ({
          bookingPublicId: swap.bookingPublicId,
          newVehicle: {
            publicId: swap.alternatives[0]!.publicId,
            make: swap.alternatives[0]!.make,
            model: swap.alternatives[0]!.model,
            regNo: swap.alternatives[0]!.regNo,
          },
        })),
        partialNewEndAt: opt.partialNewEndAt?.toISOString(),
        additionalAmount: additionalAmountStr,
        newTotalFinal: newTotalFinalStr,
        extensionFreeKm: opt.type === "NO_RESOLUTION" ? null : freeKmUntil(opt.partialNewEndAt ?? newEndAt),
      })),
      recommendedResolution: resolutionOptions.recommendedOption,
    };
  }

  /**
   * Commit an extension: acquire locks, re-validate availability (stale data check),
   * execute vehicle allocation, record payment, and update booking.
   *
   * When branch has `usePaymentSessions=true`, skips PaymentTransaction creation and
   * instead creates an EXTENSION PaymentSession with a EXTENSION ledger entry.
   * The booking endAt is NOT updated yet — it is deferred to the session's post-completion hook.
   */
  async commit(input: CommitExtensionInput, actor: ActorContext): Promise<CommitExtensionResult> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: input.extensionPublicId },
      include: {
        booking: {
          include: {
            items: { include: { vehicle: { include: { category: true } } } },
          },
        },
      },
    });

    if (!extension) throw new Error("Extension not found");
    if (
      extension.extensionStatus !== ExtensionStatus.PENDING_PAYMENT
    ) {
      throw new Error(
        `Extension is in ${extension.extensionStatus} status and cannot be committed`,
      );
    }

    const booking = extension.booking;
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new Error(
        `Booking is ${booking.status} — the extension cannot be committed`,
      );
    }

    // Already committed (double submit): the hold and price are in place.
    // Re-running would re-price against the moved endAt and zero the charge.
    if (extension.resolutionType !== null) {
      if (extension.resolutionType !== input.resolutionType) {
        throw new Error(
          `Extension was already committed as ${extension.resolutionType} and cannot be committed again`,
        );
      }
      return {
        extension,
        remainAmount: {
          extension: new Decimal(extension.additionalAmount.toString()).toFixed(2),
        },
      };
    }

    // A partial extension must land strictly after the current end and no
    // later than what was quoted. Checked before any hold is written.
    if (input.resolutionType === "PARTIAL_EXTENSION" && input.partialNewEndAt) {
      const partialEnd = new Date(input.partialNewEndAt);
      if (partialEnd <= extension.oldEndAt || partialEnd > extension.requestedEndAt) {
        throw new Error(
          "Partial end must be after the current return time and no later than the requested one — the extension cannot be committed",
        );
      }
    }

    const firstItem = booking.items[0];
    if (!firstItem) throw new Error("Booking has no vehicle items");

    const currentVehicleId = firstItem.vehicleId;
    const vehicleIdsToLock = [currentVehicleId];

    // Additional vehicles that may be involved (swap targets)
    if (input.selectedVehiclePublicId) {
      const v = await prisma.vehicle.findUnique({
        where: { publicId: input.selectedVehiclePublicId },
        select: { id: true },
      });
      if (v) vehicleIdsToLock.push(v.id);
    }

    // Acquire Redis locks
    const lockResult = await extensionLockService.acquireMultipleLocks(vehicleIdsToLock);
    if (lockResult.failed.length > 0) {
      throw new Error(
        "Vehicle is currently being processed by another request. Please try again in a moment.",
      );
    }

    try {
      // Stale data check: re-validate availability after lock acquisition
      const effectiveNewEndAt =
        input.resolutionType === "PARTIAL_EXTENSION" && input.partialNewEndAt
          ? new Date(input.partialNewEndAt)
          : extension.requestedEndAt;

      // Driving licence still free for the added time (X3) — before any swap runs
      await assertDlFree({
        customerId: booking.customerId,
        mode: "extend",
        window: { startAt: booking.endAt, endAt: effectiveNewEndAt },
        excludeBookingId: booking.id,
      });

      if (
        input.resolutionType === "SAME_VEHICLE" ||
        input.resolutionType === "PARTIAL_EXTENSION"
      ) {
        const freshCheck = await extensionAvailabilityService.checkVehicleAvailability(
          currentVehicleId,
          booking.endAt,
          effectiveNewEndAt,
          booking.id,
        );
        if (!freshCheck.available) {
          throw new Error(
            "Vehicle availability changed during extension — please re-evaluate",
          );
        }
      }

      // Determine final amount to charge (may differ from stored if partial)
      let finalAdditionalAmount = extension.additionalAmount;
      let finalNewTotalFinal = extension.newTotalFinal;
      // GST split re-priced with the amount (left as stored when not partial)
      let finalSplit: ReturnType<typeof extensionSplitData> | undefined;

      if (input.resolutionType === "PARTIAL_EXTENSION" && input.partialNewEndAt) {
        const partialPricing = await extensionPricingService.recalculate(
          booking.id,
          effectiveNewEndAt,
        );
        finalAdditionalAmount = partialPricing.additionalAmount;
        finalNewTotalFinal = partialPricing.newTotalFinal;
        finalSplit = extensionSplitData(partialPricing);
      }

      // Handle SWAP_CURRENT_TO_OTHER before the DB transaction
      // (vehicleSwapService runs its own transaction internally)
      let vehicleSwapId: number | null = null;
      if (input.resolutionType === "SWAP_CURRENT_TO_OTHER" && input.selectedVehiclePublicId) {
        const newVehicle = await prisma.vehicle.findUnique({
          where: { publicId: input.selectedVehiclePublicId },
          select: { id: true },
        });
        if (!newVehicle) throw new Error("Selected replacement vehicle not found");

        const vehicleSwap = await extensionVehicleAllocatorService.swapCurrentBookingVehicle(
          booking.publicId,
          newVehicle.id,
          actor,
          effectiveNewEndAt,
        );
        vehicleSwapId = vehicleSwap.id;
      }

      // Handle SWAP_FUTURE_BOOKING
      if (
        input.resolutionType === "SWAP_FUTURE_BOOKING" &&
        input.affectedBookingSwaps &&
        input.affectedBookingSwaps.length > 0
      ) {
        await prisma.$transaction(async (tx) => {
          for (const swap of input.affectedBookingSwaps!) {
            const affectedBooking = await tx.booking.findUnique({
              where: { publicId: swap.bookingPublicId },
              select: { id: true },
            });
            if (!affectedBooking) throw new Error(`Affected booking ${swap.bookingPublicId} not found`);
            await extensionVehicleAllocatorService.swapFutureBookingVehicle(
              affectedBooking.id,
              swap.newVehiclePublicId,
              extension.id,
              actor,
              tx,
            );
          }
        });
      }

      // ── Vehicle hold ──────────────────────────────────────────────────────
      // Update booking.endAt immediately so the vehicle slot is blocked for
      // other bookings while payment is pending. Reverted in the catch block
      // if the commit rolls back. The driving licence is re-checked under its
      // lock (X3) so a booking made since the quote can't end up overlapping.
      await prisma.$transaction(async (tx) => {
        await lockAndAssertDlFree(
          {
            customerId: booking.customerId,
            mode: "extend",
            window: { startAt: booking.endAt, endAt: effectiveNewEndAt },
            excludeBookingId: booking.id,
          },
          tx,
        );
        await tx.booking.update({
          where: { id: booking.id },
          data: { endAt: effectiveNewEndAt },
        });
      });

      // Persist extension resolution details. requestedEndAt becomes the end
      // actually held (the partial end for PARTIAL_EXTENSION) — every finalizer
      // extends the booking to requestedEndAt.
      const updatedExtension = await prisma.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.PENDING_PAYMENT,
          requestedEndAt: effectiveNewEndAt,
          resolutionType: input.resolutionType as ExtensionResolutionType,
          vehicleSwapOccurred: input.resolutionType !== "SAME_VEHICLE",
          vehicleSwapId: vehicleSwapId,
          additionalAmount: finalAdditionalAmount,
          newTotalFinal: finalNewTotalFinal,
          ...(finalSplit ?? {}),
        },
      });

      await Promise.all([
        auditService.log({
          actorId: actor.actorId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          actorBranchId: actor.actorBranchId,
          action: "Extension committed — vehicle held, awaiting payment collection",
          category: AuditCategory.BOOKING,
          severity: AuditSeverity.INFO,
          entity: "BookingExtension",
          entityId: updatedExtension.publicId,
          description: `Extension committed for booking ${booking.publicId}. ₹${finalAdditionalAmount.toFixed(2)} due. Vehicle held until ${effectiveNewEndAt.toISOString()}.`,
          after: {
            amount: finalAdditionalAmount.toFixed(2),
            newEndAt: effectiveNewEndAt,
            quotedEndAt: extension.requestedEndAt,
          },
        }),
        staffActivityService.log({
          actorPublicId: actor.actorPublicId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          branchId: actor.actorBranchId,
          branchName: actor.branchName,
          actionType: StaffActionType.INITIATED,
          entityType: StaffEntityType.BOOKING_EXTENSION,
          entityRef: updatedExtension.publicId,
          description: `Extension committed for booking ${booking.publicId} — ₹${finalAdditionalAmount.toFixed(2)} pending collection`,
        }),
      ]);

      if (input.resolutionType === "SWAP_FUTURE_BOOKING") {
        for (const swap of input.affectedBookingSwaps ?? []) {
          void notifyEvents.bookingDisplaced({
            affectedBookingPublicId: swap.bookingPublicId,
            extensionId: extension.id,
            actorUserId: actor.actorId,
          });
        }
      }

      return {
        extension: updatedExtension,
        remainAmount: {
          extension: finalAdditionalAmount.toFixed(2),
        },
      };
    } catch (error) {
      // Rollback: cancel extension, clear activeExtensionId, and revert vehicle hold
      await prisma.bookingExtension.update({
        where: { id: extension.id },
        data: { extensionStatus: ExtensionStatus.CANCELLED },
      });
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          activeExtensionId: null,
          endAt: booking.endAt, // revert vehicle hold
        },
      });
      throw error;
    } finally {
      // Always release locks
      await extensionLockService.releaseMultipleLocks(vehicleIdsToLock);
    }
  }

  /**
   * Re-price an uncommitted quote to an earlier end — a customer's partial
   * extension, since customers can't pick a resolution. The amount charged and
   * the end every finalizer writes (requestedEndAt) then match what's free.
   */
  async narrowQuote(extensionPublicId: string, newEndAt: Date): Promise<ExtensionPricingResult> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      select: {
        id: true,
        bookingId: true,
        oldEndAt: true,
        requestedEndAt: true,
        extensionStatus: true,
        resolutionType: true,
      },
    });
    if (
      !extension ||
      extension.extensionStatus !== ExtensionStatus.PENDING_PAYMENT ||
      extension.resolutionType !== null
    ) {
      throw new Error("Extension not found or no longer an open quote");
    }
    if (newEndAt <= extension.oldEndAt || newEndAt > extension.requestedEndAt) {
      throw new Error("Partial end must be after the current return time and no later than the requested one");
    }

    const pricing = await extensionPricingService.recalculate(extension.bookingId, newEndAt);
    await prisma.bookingExtension.update({
      where: { id: extension.id },
      data: {
        requestedEndAt: newEndAt,
        additionalAmount: pricing.additionalAmount,
        newTotalFinal: pricing.newTotalFinal,
        ...extensionSplitData(pricing),
      },
    });
    return pricing;
  }

  /**
   * Called by paymentTransactionService.confirmCash() when the linked
   * PaymentTransaction is confirmed — finalizes the booking date update.
   */
  async finalizeAfterPayment(extensionPublicId: string, actor: ActorContext): Promise<void> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: { booking: true },
    });

    if (!extension || extension.extensionStatus !== ExtensionStatus.PAYMENT_COLLECTED) return;

    const effectiveEndAt = extension.requestedEndAt;

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: extension.bookingId },
        data: {
          endAt: effectiveEndAt,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
          totalFinal: { increment: extension.additionalAmount },
          activeExtensionId: null,
          originalEndAt:
            extension.booking.extensionCount === 0 ? extension.oldEndAt : undefined,
        },
      });
      // days / rentalPeriodType / hours follow the new end (#5/#17)
      await refreshBookingPeriodFields(extension.bookingId, tx);

      await tx.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.CONFIRMED,
          actualNewEndAt: effectiveEndAt,
        },
      });
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "Extension finalized after cash confirmation",
      category: AuditCategory.BOOKING,
      severity: AuditSeverity.INFO,
      entity: "BookingExtension",
      entityId: extension.publicId,
      description: `Extension confirmed after cash payment verified. Booking extended to ${effectiveEndAt.toISOString()}`,
    });

    void notifyEvents.extensionConfirmed({ extensionId: extension.id, actorUserId: actor.actorId });
  }

  /**
   * Cancel a pending extension — reverts booking.endAt to oldEndAt and releases the vehicle hold.
   */
  async cancel(extensionPublicId: string, actor: ActorContext, reason?: string): Promise<void> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      select: {
        id: true,
        bookingId: true,
        extensionStatus: true,
        oldEndAt: true,
        paymentTransaction: { select: { status: true } },
        booking: { select: { activeExtensionId: true, items: { select: { vehicleId: true } } } },
      },
    });

    if (!extension) throw new Error("Extension not found");
    if (extension.extensionStatus === ExtensionStatus.CONFIRMED) {
      throw new Error("Cannot cancel a confirmed extension");
    }
    // Already closed — nothing is held. Reverting endAt here could undo a
    // later extension, so this is a no-op.
    if (
      extension.extensionStatus === ExtensionStatus.CANCELLED ||
      extension.extensionStatus === ExtensionStatus.REJECTED
    ) {
      return;
    }
    // Cash already collected for it: cancelling would orphan that money.
    // The manager rejects the payment first, which releases the extension.
    const paymentStatus = extension.paymentTransaction?.status;
    if (paymentStatus === "COLLECTED" || paymentStatus === "CONFIRMED") {
      throw new Error(
        "Cannot cancel an extension whose payment has been collected — a manager must reject the payment first",
      );
    }

    // The customer may be paying it by UPI QR (#2): close those codes first. A
    // captured QR payment confirms the extension instead (409 UPI_QR_ALREADY_PAID);
    // a code Razorpay wouldn't close keeps it open (502 GATEWAY_UNAVAILABLE).
    // Throws UpiQrError — callers answer with its status + toJSON().
    await assertExtensionQrsClosedForCancel(extension.id);

    await prisma.$transaction(async (tx) => {
      await tx.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.CANCELLED,
          rejectionReason: reason,
        },
      });
      // Revert vehicle hold: restore the original endAt — only when the hold
      // is this extension's (it is the booking's active extension)
      if (extension.booking.activeExtensionId === extension.id) {
        await tx.booking.update({
          where: { id: extension.bookingId },
          data: {
            activeExtensionId: null,
            endAt: extension.oldEndAt,
          },
        });
      }
    });

    // Invalidate vehicle availability cache so the reverted slot shows as available again
    const vehicleIds = extension.booking.items.map((i) => i.vehicleId);
    if (vehicleIds.length > 0) {
      try {
        await invalidateVehicleAvailability(redis, vehicleIds);
      } catch {
        // non-fatal
      }
    }

    await Promise.all([
      auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: "Extension cancelled",
        category: AuditCategory.BOOKING,
        severity: AuditSeverity.WARNING,
        entity: "BookingExtension",
        entityId: extensionPublicId,
        description: reason ?? "Extension cancelled by actor",
      }),
      staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.CANCELLED,
        entityType: StaffEntityType.BOOKING_EXTENSION,
        entityRef: extensionPublicId,
        description: `Extension ${extensionPublicId} cancelled`,
      }),
    ]);
  }

  /**
   * Collect payment for a PENDING_PAYMENT extension.
   * CASH → PaymentTransaction COLLECTED (awaits manager confirmation).
   * ONLINE → PaymentTransaction CONFIRMED + extension immediately finalized.
   * Nothing due (₹0) → extension finalized without a PaymentTransaction.
   * Counter payments (CASH, UPI) are linked to the collector's open cash shift.
   */
  async collect(
    extensionPublicId: string,
    method: "CASH" | "ONLINE" | "SPLIT" | "CREDIT",
    actor: ActorContext,
    onlineTransactionRef?: string,
    options: CollectExtensionOptions = {},
  ): Promise<CollectExtensionResult> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: { booking: true },
    });

    if (!extension) throw new Error("Extension not found");
    if (extension.extensionStatus !== ExtensionStatus.PENDING_PAYMENT) {
      throw new Error(`Extension is already in ${extension.extensionStatus} status`);
    }

    const booking = extension.booking;
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new Error(`Booking is already in ${booking.status} status — extension payment cannot be collected`);
    }

    // Deferred to an open pickup payment session (EXTENSION ledger line): the
    // session collects it, so collecting here too would charge the customer twice.
    const inOpenSession = await prisma.ledgerEntry.findFirst({
      where: {
        referenceId: extension.publicId,
        entryType: "EXTENSION",
        isVoided: false,
        session: { status: { in: ["OPEN", "COMPUTING", "AWAITING_PAYMENT", "PAYMENT_INITIATED"] } },
      },
      select: { id: true },
    });
    if (inOpenSession) {
      throw Object.assign(
        new Error("This extension's charge is on the open pickup payment session — collect it there."),
        { code: EXTENSION_IN_SESSION },
      );
    }

    const additionalAmount = new Decimal(extension.additionalAmount.toString());
    const isUpi = method === "ONLINE" && options.onlineGateway === "UPI";

    // ₹0 due — a zero PaymentTransaction would only pollute reports
    if (additionalAmount.lte(0)) {
      const confirmed = await prisma.$transaction(async (tx) => {
        // Conditional flip so a double submit confirms (and counts) only once
        const { count } = await tx.bookingExtension.updateMany({
          where: { id: extension.id, extensionStatus: ExtensionStatus.PENDING_PAYMENT },
          data: {
            extensionStatus: ExtensionStatus.CONFIRMED,
            actualNewEndAt: extension.requestedEndAt,
          },
        });
        if (count === 0) return false;
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            endAt: extension.requestedEndAt,
            activeExtensionId: null,
            extensionCount: { increment: 1 },
            lastExtendedAt: new Date(),
            totalFinal: { increment: extension.additionalAmount },
            ...(booking.extensionCount === 0 && { originalEndAt: extension.oldEndAt }),
          },
        });
        await refreshBookingPeriodFields(booking.id, tx);
        return true;
      });

      if (!confirmed) {
        const latest = await prisma.bookingExtension.findUnique({
          where: { id: extension.id },
          select: { extensionStatus: true },
        });
        if (latest?.extensionStatus === ExtensionStatus.CONFIRMED) {
          return { remainAmount: { extension: "0.00" }, payment: "confirmed" };
        }
        throw new Error(`Extension is already in ${latest?.extensionStatus ?? "an unknown"} status`);
      }

      await auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: "Extension confirmed (nothing to collect)",
        category: AuditCategory.BOOKING,
        severity: AuditSeverity.INFO,
        entity: "BookingExtension",
        entityId: extension.publicId,
        description: `Extension ${extension.publicId} confirmed with no additional charge`,
      });

      void notifyEvents.extensionConfirmed({ extensionId: extension.id, actorUserId: actor.actorId });

      // The new return time belongs on the invoice: no amount moves, so force
      // the fresh PDF (the cached one still shows the old period)
      refreshInvoiceTotals(booking.id, { forceRegenerate: true }).catch((err) =>
        console.error("[extension.collect] Invoice refresh error:", err),
      );

      return { remainAmount: { extension: "0.00" }, payment: "confirmed" };
    }

    // CREDIT (#11): the extension is confirmed now (its time is already held) and
    // its amount stays owed against the collateral — no PaymentTransaction. The
    // branch manager clears it on the Customer Credit page when the money arrives.
    if (method === "CREDIT") {
      const collateral = options.collateral;
      if (!collateral) throw new Error("Collateral is required to put an extension on credit");
      const credit = await prisma.$transaction(async (tx) => {
        const { count } = await tx.bookingExtension.updateMany({
          where: { id: extension.id, extensionStatus: ExtensionStatus.PENDING_PAYMENT },
          data: {
            extensionStatus: ExtensionStatus.CONFIRMED,
            actualNewEndAt: extension.requestedEndAt,
          },
        });
        if (count === 0) {
          throw new Error("Extension is already in a closed status — credit not recorded");
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            endAt: extension.requestedEndAt,
            activeExtensionId: null,
            extensionCount: { increment: 1 },
            lastExtendedAt: new Date(),
            totalFinal: { increment: extension.additionalAmount },
            ...(booking.extensionCount === 0 && { originalEndAt: extension.oldEndAt }),
          },
        });
        await refreshBookingPeriodFields(booking.id, tx);
        return addFleetCredit(tx, {
          bookingId: booking.id,
          amount: additionalAmount,
          purpose: PaymentPurpose.EXTENSION,
          label: "Extension on credit",
          collateral,
          reference: { type: "EXTENSION", publicId: extension.publicId },
          actor: { id: actor.actorId, name: actor.actorName },
        });
      });

      await Promise.all([
        auditService.log({
          actorId: actor.actorId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          actorBranchId: actor.actorBranchId,
          action: "Extension confirmed on credit",
          category: AuditCategory.PAYMENT,
          severity: AuditSeverity.INFO,
          entity: "BookingExtension",
          entityId: extension.publicId,
          description: `Extension ${extension.publicId} confirmed with ₹${additionalAmount.toFixed(2)} on customer credit (collateral: ${collateral})`,
          metadata: { collateral, creditEntryPublicId: credit.creditEntryPublicId },
        }),
        staffActivityService.log({
          actorPublicId: actor.actorPublicId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          branchId: actor.actorBranchId,
          branchName: actor.branchName,
          actionType: StaffActionType.CONFIRMED,
          entityType: StaffEntityType.BOOKING_EXTENSION,
          entityRef: extension.publicId,
          description: `Extension ₹${additionalAmount.toFixed(2)} put on credit (collateral: ${collateral})`,
        }),
      ]);

      void notifyEvents.extensionConfirmed({ extensionId: extension.id, actorUserId: actor.actorId });
      refreshInvoiceTotals(booking.id, { forceRegenerate: true }).catch((err) =>
        console.error("[extension.collect] Invoice refresh error:", err),
      );

      return {
        remainAmount: { extension: additionalAmount.toFixed(2) },
        payment: "confirmed",
        credit: {
          creditEntryPublicId: credit.creditEntryPublicId,
          sectionKey: credit.sectionKey,
          amount: additionalAmount.toFixed(2),
          collateral,
        },
      };
    }

    // Counter money waits for the branch manager: cash, a counter UPI (merchant QR)
    // payment (#12) and a split are COLLECTED and the extension PAYMENT_COLLECTED
    // until the BM confirms it in Cash Confirmations (confirmCash finalizes it).
    // Only an online gateway other than counter UPI confirms at once.
    const isOnline = method === "ONLINE" && !isUpi;
    const isSplit = method === "SPLIT";
    const cashPart = isSplit
      ? (options.split?.cash ?? new Decimal(0))
      : method === "CASH" ? additionalAmount : new Decimal(0);
    const onlinePart = additionalAmount.sub(cashPart);
    const upiPart = isUpi || (isSplit && onlinePart.gt(0));

    await prisma.$transaction(async (tx) => {
      // The UTR / payment photo was validated by the caller; re-checked here so
      // two collections can't claim the same transfer.
      if (options.upi) {
        await claimCounterUpi(options.upi, tx);
      } else if (upiPart && onlineTransactionRef) {
        await claimUtr(onlineTransactionRef, tx);
      }

      // Money taken at the counter (cash or UPI) lands in the collector's open shift
      const activeShift = !isOnline
        ? await tx.cashShift.findFirst({
            where: { employeeId: actor.actorId, status: "OPEN" },
            select: { id: true },
          })
        : null;

      // COLLECTED for counter money (manager confirms later), CONFIRMED for a gateway payment
      const txn = await (tx as any).paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `ext:collect:${extension.id}`,
          bookingId: booking.id,
          branchId: booking.branchId,
          purpose: PaymentPurpose.EXTENSION,
          method,
          status: isOnline ? "CONFIRMED" : "COLLECTED",
          totalAmount: additionalAmount.toFixed(2),
          cashAmount: cashPart.toFixed(2),
          onlineAmount: onlinePart.toFixed(2),
          onlineTransactionRef: onlinePart.gt(0) ? (onlineTransactionRef ?? null) : null,
          onlineGateway: onlinePart.gt(0) ? (upiPart ? "UPI" : (options.onlineGateway ?? null)) : null,
          proofFileId: options.upi?.proof?.id ?? null,
          collectedById: actor.actorId,
          collectedAt: new Date(),
          cashShiftId: activeShift?.id ?? null,
          ...(isOnline && { confirmedById: actor.actorId, confirmedAt: new Date() }),
        },
      });

      // Update extension: link to PaymentTransaction + set status. Conditional,
      // so an extension cancelled meanwhile rolls the payment back.
      const { count } = await tx.bookingExtension.updateMany({
        where: { id: extension.id, extensionStatus: ExtensionStatus.PENDING_PAYMENT },
        data: {
          extensionStatus: isOnline ? ExtensionStatus.CONFIRMED : ExtensionStatus.PAYMENT_COLLECTED,
          paymentTransactionId: txn.id,
          ...(isOnline && { actualNewEndAt: extension.requestedEndAt }),
        },
      });
      if (count === 0) {
        throw new Error("Extension is already in a closed status — payment not recorded");
      }

      // Gateway payment: immediately finalize booking
      if (isOnline) {
        await (tx as any).booking.update({
          where: { id: booking.id },
          data: {
            endAt: extension.requestedEndAt,
            activeExtensionId: null,
            extensionCount: { increment: 1 },
            lastExtendedAt: new Date(),
            totalFinal: { increment: extension.additionalAmount },
            ...(booking.extensionCount === 0 && { originalEndAt: extension.oldEndAt }),
          },
        });
        await refreshBookingPeriodFields(booking.id, tx);
      }
    });

    await Promise.all([
      auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: isOnline
          ? "Extension payment confirmed (online)"
          : `Extension payment collected (${isUpi ? "UPI" : isSplit ? "cash + UPI" : "cash"} — pending manager confirmation)`,
        category: AuditCategory.PAYMENT,
        severity: AuditSeverity.INFO,
        entity: "BookingExtension",
        entityId: extension.publicId,
        description: `₹${additionalAmount.toFixed(2)} collected for extension ${extension.publicId} via ${isUpi ? (options.upi?.proof ? "UPI (payment photo)" : "UPI (UTR)") : isSplit ? `split (₹${cashPart.toFixed(2)} cash + ₹${onlinePart.toFixed(2)} UPI)` : method}`,
      }),
      staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.COLLECTED,
        entityType: StaffEntityType.BOOKING_EXTENSION,
        entityRef: extension.publicId,
        description: `Extension payment ₹${additionalAmount.toFixed(2)} collected via ${isUpi ? "UPI" : isSplit ? "cash + UPI" : method}`,
      }),
    ]);

    if (isOnline) void notifyEvents.extensionConfirmed({ extensionId: extension.id, actorUserId: actor.actorId });

    // Confirmed now (gateway): its taxable value and GST join the invoice.
    // Counter money waits for the manager's confirmation, which refreshes it then.
    if (isOnline) {
      refreshInvoiceTotals(booking.id).catch((err) =>
        console.error("[extension.collect] Invoice refresh error:", err),
      );
    }

    return {
      remainAmount: { extension: additionalAmount.toFixed(2) },
      payment: isOnline ? "confirmed" : "pending",
    };
  }

  async getByPublicId(publicId: string): Promise<BookingExtension | null> {
    return prisma.bookingExtension.findUnique({ where: { publicId } });
  }

  async listForBranch(
    branchId: number,
    filters: {
      page?: number;
      pageSize?: number;
      status?: ExtensionStatus;
      bookingPublicId?: string;
      trigger?: ExtensionTrigger;
    },
  ): Promise<PaginatedExtensions> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    let bookingId: number | undefined;
    if (filters.bookingPublicId) {
      const b = await prisma.booking.findUnique({
        where: { publicId: filters.bookingPublicId },
        select: { id: true },
      });
      bookingId = b?.id;
    }

    const where = {
      branchId,
      ...(filters.status ? { extensionStatus: filters.status } : {}),
      ...(bookingId ? { bookingId } : {}),
      ...(filters.trigger ? { extensionTrigger: filters.trigger } : {}),
    };

    const [raw, total] = await Promise.all([
      prisma.bookingExtension.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          booking: { select: { publicId: true } },
        },
      }),
      prisma.bookingExtension.count({ where }),
    ]);

    const extensions = raw.map(({ booking, ...ext }) => ({
      ...ext,
      bookingPublicId: booking.publicId,
    }));

    return { extensions, total, page, pageSize };
  }

  async getDisplacedBookingsForBranch(branchId: number): Promise<
    Array<{
      publicId: string;
      extensionDisplacedAt: Date | null;
      displacedByExtensionId: number | null;
      status: string;
      startAt: Date;
      endAt: Date;
      customer: { name: string; phone: string | null; email: string | null };
      newVehicle: { regNo: string; make: string; model: string } | null;
      displacingExtension: { publicId: string; requestedEndAt: Date } | null;
    }>
  > {
    const bookings = await prisma.booking.findMany({
      where: {
        branchId,
        extensionDisplacedAt: { not: null },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
      },
      select: {
        publicId: true,
        extensionDisplacedAt: true,
        displacedByExtensionId: true,
        status: true,
        startAt: true,
        endAt: true,
        customer: {
          select: {
            user: { select: { name: true, phone: true, email: true } },
          },
        },
        items: {
          select: {
            vehicle: { select: { regNo: true, make: true, model: true } },
          },
          take: 1,
        },
      },
      orderBy: { extensionDisplacedAt: "desc" },
    });

    // Fetch displacing extension details for display
    const extensionIds = bookings
      .map((b) => b.displacedByExtensionId)
      .filter((id): id is number => id !== null);

    const extensions =
      extensionIds.length > 0
        ? await prisma.bookingExtension.findMany({
            where: { id: { in: extensionIds } },
            select: { id: true, publicId: true, requestedEndAt: true },
          })
        : [];

    const extensionMap = new Map(extensions.map((e) => [e.id, e]));

    return bookings.map((b) => ({
      publicId: b.publicId,
      extensionDisplacedAt: b.extensionDisplacedAt,
      displacedByExtensionId: b.displacedByExtensionId,
      status: b.status,
      startAt: b.startAt,
      endAt: b.endAt,
      customer: {
        name: b.customer.user.name,
        phone: b.customer.user.phone ?? null,
        // Walk-in placeholder addresses are never shown (D1)
        email: displayEmail(b.customer.user.email),
      },
      newVehicle: b.items[0]?.vehicle ?? null,
      displacingExtension: b.displacedByExtensionId
        ? (extensionMap.get(b.displacedByExtensionId) ?? null)
        : null,
    }));
  }

  /**
   * Resolve a displaced booking:
   * CONFIRM_SWAP   — swap is already done, mark resolved
   * CANCEL_WITH_REFUND — cancel the booking and issue a refund request
   * CANCEL_NO_REFUND   — cancel the booking without refund
   */
  async resolveDisplacedBooking(
    bookingPublicId: string,
    action: "CONFIRM_SWAP" | "CANCEL_WITH_REFUND" | "CANCEL_NO_REFUND",
    actor: ActorContext,
    refundAmount?: number,
    refundMethod?: "CASH" | "ONLINE",
    notes?: string,
  ): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      select: {
        id: true,
        publicId: true,
        branchId: true,
        status: true,
        extensionDisplacedAt: true,
      },
    });

    if (!booking) throw new Error("Booking not found");
    if (!booking.extensionDisplacedAt) throw new Error("Booking is not displaced");
    if (booking.branchId !== actor.actorBranchId) throw new Error("Access denied");

    if (action === "CONFIRM_SWAP") {
      // Swap was already done — clear the displaced flag to remove from dashboard
      await prisma.booking.update({
        where: { id: booking.id },
        data: { extensionDisplacedAt: null },
      });

      await auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: "Displaced booking swap confirmed by manager",
        category: AuditCategory.BOOKING,
        severity: AuditSeverity.INFO,
        entity: "Booking",
        entityId: bookingPublicId,
        description: notes ?? "Customer agreed to vehicle swap",
      });
      return;
    }

    // Cancel the booking
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          extensionDisplacedAt: null,
        },
      });

      // Cancelled for a business reason (vehicle displaced) — give the coupon use back
      await discountApplicationService.releaseUsage(booking.id, tx);
      // Nothing is owed on a cancelled booking — close any credit pending on it (#11)
      await voidPendingCreditOnCancel(tx, booking.id, "Booking cancelled: vehicle displaced by an extension");

      // The vehicle's status is left alone: the displaced booking never picked
      // it up, and the car is still out with the extending customer.

      if (action === "CANCEL_WITH_REFUND" && refundAmount && refundMethod) {
        await tx.refundRequest.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            branchId: booking.branchId,
            requestedById: actor.actorId,
            amount: new Decimal(refundAmount),
            method: refundMethod,
            reason: notes ?? "Vehicle displaced by extension — customer declined swap",
            status: "APPROVED",
          },
        });
      }
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: action === "CANCEL_WITH_REFUND"
        ? "Displaced booking cancelled with refund"
        : "Displaced booking cancelled without refund",
      category: AuditCategory.BOOKING,
      severity: AuditSeverity.WARNING,
      entity: "Booking",
      entityId: bookingPublicId,
      description: notes ?? "Customer declined vehicle swap",
    });

    void notifyEvents.bookingCancelled({
      bookingId: booking.id,
      actorUserId: actor.actorId,
      reason:
        action === "CANCEL_WITH_REFUND" && refundAmount && refundMethod
          ? "the reserved car is no longer available. A refund has been approved."
          : "the reserved car is no longer available.",
    });
  }
}

export const extensionService = new ExtensionService();
