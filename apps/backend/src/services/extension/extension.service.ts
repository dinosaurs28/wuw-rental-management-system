import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  ExtensionTrigger,
  ExtensionResolutionType,
  Role,
  PaymentPurpose,
  VehicleStatus,
} from "@repo/database/client";
import type { BookingExtension } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { AuditSeverity } from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { extensionAvailabilityService } from "./extension-availability.service.js";
import { extensionPricingService, type ExtensionPricingResult } from "./extension-pricing.service.js";
import { extensionConflictResolverService, type ConflictResolutionOptions } from "./extension-conflict-resolver.service.js";
import { extensionVehicleAllocatorService } from "./extension-vehicle-allocator.service.js";
import { extensionLockService } from "./extension-lock.service.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";

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

export interface CollectExtensionResult {
  remainAmount: {
    extension: string;
  };
  payment: "pending" | "confirmed";
}

export interface PaginatedExtensions {
  extensions: BookingExtension[];
  total: number;
  page: number;
  pageSize: number;
}

const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.RETURNED,
  BookingStatus.CANCELLED,
  BookingStatus.HOLD_EXPIRED,
];

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

    if (TERMINAL_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot extend a booking in status ${booking.status}. Extension is only allowed for CONFIRMED or PICKED_UP bookings.`,
      );
    }

    if (newEndAt <= booking.endAt) {
      throw new Error("New end date must be after the current end date");
    }

    // Prevent concurrent extensions
    if (booking.activeExtensionId !== null) {
      throw new Error(
        "A pending extension already exists for this booking. Complete or cancel it before creating a new one.",
      );
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

      if (input.resolutionType === "SAME_VEHICLE") {
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

      if (input.resolutionType === "PARTIAL_EXTENSION" && input.partialNewEndAt) {
        const partialPricing = await extensionPricingService.recalculate(
          booking.id,
          effectiveNewEndAt,
        );
        finalAdditionalAmount = partialPricing.additionalAmount;
        finalNewTotalFinal = partialPricing.newTotalFinal;
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
      // if the commit rolls back.
      await prisma.booking.update({
        where: { id: booking.id },
        data: { endAt: effectiveNewEndAt },
      });

      // Persist extension resolution details
      const updatedExtension = await prisma.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.PENDING_PAYMENT,
          resolutionType: input.resolutionType as ExtensionResolutionType,
          vehicleSwapOccurred: input.resolutionType !== "SAME_VEHICLE",
          vehicleSwapId: vehicleSwapId,
          additionalAmount: finalAdditionalAmount,
          newTotalFinal: finalNewTotalFinal,
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
          after: { amount: finalAdditionalAmount.toFixed(2), newEndAt: effectiveNewEndAt },
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
          totalFinal: extension.newTotalFinal,
          activeExtensionId: null,
          originalEndAt:
            extension.booking.extensionCount === 0 ? extension.oldEndAt : undefined,
        },
      });

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
  }

  /**
   * Cancel a pending extension — reverts booking.endAt to oldEndAt and releases the vehicle hold.
   */
  async cancel(extensionPublicId: string, actor: ActorContext, reason?: string): Promise<void> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      select: { id: true, bookingId: true, extensionStatus: true, oldEndAt: true, booking: { select: { items: { select: { vehicleId: true } } } } },
    });

    if (!extension) throw new Error("Extension not found");
    if (extension.extensionStatus === ExtensionStatus.CONFIRMED) {
      throw new Error("Cannot cancel a confirmed extension");
    }

    await prisma.$transaction(async (tx) => {
      await tx.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.CANCELLED,
          rejectionReason: reason,
        },
      });
      // Revert vehicle hold: restore the original endAt
      await tx.booking.update({
        where: { id: extension.bookingId },
        data: {
          activeExtensionId: null,
          endAt: extension.oldEndAt,
        },
      });
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
   */
  async collect(
    extensionPublicId: string,
    method: "CASH" | "ONLINE",
    actor: ActorContext,
    onlineTransactionRef?: string,
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
    const isOnline = method === "ONLINE";
    const additionalAmount = new Decimal(extension.additionalAmount.toString());

    await prisma.$transaction(async (tx) => {
      // Create PaymentTransaction — COLLECTED for cash (manager confirms later), CONFIRMED for online
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
          cashAmount: isOnline ? "0.00" : additionalAmount.toFixed(2),
          onlineAmount: isOnline ? additionalAmount.toFixed(2) : "0.00",
          onlineTransactionRef: onlineTransactionRef ?? null,
          collectedById: actor.actorId,
          collectedAt: new Date(),
          ...(isOnline && { confirmedById: actor.actorId, confirmedAt: new Date() }),
        },
      });

      // Update extension: link to PaymentTransaction + set status
      await (tx as any).bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: isOnline ? ExtensionStatus.CONFIRMED : ExtensionStatus.PAYMENT_COLLECTED,
          paymentTransactionId: txn.id,
          ...(isOnline && { actualNewEndAt: extension.requestedEndAt }),
        },
      });

      // For online payment: immediately finalize booking
      if (isOnline) {
        await (tx as any).booking.update({
          where: { id: booking.id },
          data: {
            endAt: extension.requestedEndAt,
            activeExtensionId: null,
            extensionCount: { increment: 1 },
            lastExtendedAt: new Date(),
            totalFinal: extension.newTotalFinal,
            ...(booking.extensionCount === 0 && { originalEndAt: extension.oldEndAt }),
          },
        });
      }
    });

    await Promise.all([
      auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        action: isOnline ? "Extension payment confirmed (online)" : "Extension payment collected (cash — pending manager confirmation)",
        category: AuditCategory.PAYMENT,
        severity: AuditSeverity.INFO,
        entity: "BookingExtension",
        entityId: extension.publicId,
        description: `₹${additionalAmount.toFixed(2)} collected for extension ${extension.publicId} via ${method}`,
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
        description: `Extension payment ₹${additionalAmount.toFixed(2)} collected via ${method}`,
      }),
    ]);

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
        email: b.customer.user.email ?? null,
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

      // Free up the vehicle
      const items = await tx.bookingItem.findMany({
        where: { bookingId: booking.id },
        select: { vehicleId: true },
      });
      if (items.length > 0) {
        await tx.vehicle.updateMany({
          where: { id: { in: items.map((i) => i.vehicleId) } },
          data: { status: VehicleStatus.AVAILABLE },
        });
      }

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
  }
}

export const extensionService = new ExtensionService();
