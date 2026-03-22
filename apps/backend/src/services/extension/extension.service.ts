import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  ExtensionTrigger,
  ExtensionResolutionType,
  PaymentPurpose,
  PaymentMethod,
  Role,
} from "@repo/database/client";
import type { BookingExtension } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { AuditSeverity } from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { paymentTransactionService, type RecordPaymentInput } from "../payment/payment-transaction.service.js";
import { branchPaymentConfigService } from "../payment/index.js";
import { extensionAvailabilityService } from "./extension-availability.service.js";
import { extensionPricingService, type ExtensionPricingResult } from "./extension-pricing.service.js";
import { extensionConflictResolverService, type ConflictResolutionOptions } from "./extension-conflict-resolver.service.js";
import { extensionVehicleAllocatorService } from "./extension-vehicle-allocator.service.js";
import { extensionLockService } from "./extension-lock.service.js";

export interface ActorContext {
  actorId: number;
  actorPublicId: string;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  branchName: string;
}

export interface ExtensionEvaluation {
  extensionPublicId: string;
  bookingPublicId: string;
  oldEndAt: Date;
  requestedEndAt: Date;
  pricing: ExtensionPricingResult;
  resolutionOptions: ConflictResolutionOptions;
}

export interface CommitExtensionInput {
  extensionPublicId: string;
  resolutionType: "SAME_VEHICLE" | "SWAP_CURRENT_TO_OTHER" | "SWAP_FUTURE_BOOKING" | "PARTIAL_EXTENSION";
  selectedVehiclePublicId?: string;
  affectedBookingSwaps?: Array<{ bookingPublicId: string; newVehiclePublicId: string }>;
  partialNewEndAt?: string;
  paymentMethod: "CASH" | "ONLINE" | "SPLIT";
  totalAmount: number;
  cashAmount?: number;
  onlineAmount?: number;
  onlineTransactionRef?: string;
  onlineGateway?: string;
  idempotencyKey: string;
  notes?: string;
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

    return {
      extensionPublicId: extension.publicId,
      bookingPublicId: booking.publicId,
      oldEndAt: booking.endAt,
      requestedEndAt: newEndAt,
      pricing,
      resolutionOptions,
    };
  }

  /**
   * Commit an extension: acquire locks, re-validate availability (stale data check),
   * execute vehicle allocation, record payment, and update booking.
   */
  async commit(input: CommitExtensionInput, actor: ActorContext): Promise<BookingExtension> {
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

      // Record payment transaction
      const paymentInput: RecordPaymentInput = {
        bookingPublicId: booking.publicId,
        purpose: PaymentPurpose.EXTENSION,
        method: input.paymentMethod as PaymentMethod,
        totalAmount: finalAdditionalAmount.toNumber(),
        cashAmount: input.cashAmount,
        onlineAmount: input.onlineAmount,
        onlineTransactionRef: input.onlineTransactionRef,
        onlineGateway: input.onlineGateway,
        idempotencyKey: input.idempotencyKey,
        notes: input.notes ?? `Extension payment — new end date: ${effectiveNewEndAt.toISOString()}`,
      };

      const paymentTxn = await paymentTransactionService.record(paymentInput, {
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: actor.actorBranchId,
        actorPublicId: actor.actorPublicId,
        branchName: actor.branchName,
      });

      // Determine extension status based on payment status
      const config = await branchPaymentConfigService.getConfig(actor.actorBranchId);
      const isPaymentPending =
        config.cashConfirmationEnabled &&
        (paymentTxn.status === "COLLECTED");

      const newExtensionStatus = isPaymentPending
        ? ExtensionStatus.PAYMENT_COLLECTED
        : ExtensionStatus.CONFIRMED;

      // DB transaction: update booking + extension atomically
      const updatedExtension = await prisma.$transaction(async (tx) => {
        // Handle SWAP_FUTURE_BOOKING inside transaction
        if (
          input.resolutionType === "SWAP_FUTURE_BOOKING" &&
          input.affectedBookingSwaps &&
          input.affectedBookingSwaps.length > 0
        ) {
          for (const swap of input.affectedBookingSwaps) {
            const affectedBooking = await tx.booking.findUnique({
              where: { publicId: swap.bookingPublicId },
              select: { id: true },
            });
            if (!affectedBooking) {
              throw new Error(`Affected booking ${swap.bookingPublicId} not found`);
            }
            await extensionVehicleAllocatorService.swapFutureBookingVehicle(
              affectedBooking.id,
              swap.newVehiclePublicId,
              extension.id,
              actor,
              tx,
            );
          }
        }

        // Build updated affectedBookingIds
        const affectedBookingIds =
          input.resolutionType === "SWAP_FUTURE_BOOKING" && input.affectedBookingSwaps
            ? await Promise.all(
                input.affectedBookingSwaps.map(async (s) => {
                  const b = await tx.booking.findUnique({
                    where: { publicId: s.bookingPublicId },
                    select: { id: true },
                  });
                  return b?.id ?? 0;
                }),
              )
            : [];

        // Update Booking: new endAt, extension tracking fields
        const isFirstExtension = booking.extensionCount === 0;
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            endAt: effectiveNewEndAt,
            originalEndAt: isFirstExtension ? booking.endAt : undefined,
            extensionCount: { increment: 1 },
            lastExtendedAt: new Date(),
            totalBase: finalNewTotalFinal, // update total on booking
            totalFinal: finalNewTotalFinal,
            activeExtensionId: newExtensionStatus === ExtensionStatus.CONFIRMED ? null : extension.id,
          },
        });

        // Update BookingItem pricing
        await tx.bookingItem.updateMany({
          where: { bookingId: booking.id },
          data: { finalTotal: finalNewTotalFinal },
        });

        // Update the extension record
        const updated = await tx.bookingExtension.update({
          where: { id: extension.id },
          data: {
            extensionStatus: newExtensionStatus,
            actualNewEndAt: newExtensionStatus === ExtensionStatus.CONFIRMED ? effectiveNewEndAt : undefined,
            resolutionType: input.resolutionType as ExtensionResolutionType,
            vehicleSwapOccurred: input.resolutionType !== "SAME_VEHICLE",
            vehicleSwapId: vehicleSwapId,
            paymentTransactionId: paymentTxn.id,
            additionalAmount: finalAdditionalAmount,
            newTotalFinal: finalNewTotalFinal,
            affectedBookingIds: affectedBookingIds.filter((id) => id > 0),
          },
        });

        return updated;
      });

      // Audit + staff activity
      await Promise.all([
        auditService.log({
          actorId: actor.actorId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          actorBranchId: actor.actorBranchId,
          action: newExtensionStatus === ExtensionStatus.CONFIRMED ? "Extension confirmed" : "Extension payment collected — pending confirmation",
          category: AuditCategory.BOOKING,
          severity: AuditSeverity.INFO,
          entity: "BookingExtension",
          entityId: updatedExtension.publicId,
          description: `Booking ${booking.publicId} extended to ${effectiveNewEndAt.toISOString()}`,
          before: { endAt: booking.endAt, totalFinal: booking.totalFinal },
          after: { endAt: effectiveNewEndAt, totalFinal: finalNewTotalFinal, resolutionType: input.resolutionType },
        }),
        staffActivityService.log({
          actorPublicId: actor.actorPublicId,
          actorName: actor.actorName,
          actorRole: actor.actorRole,
          branchId: actor.actorBranchId,
          branchName: actor.branchName,
          actionType: StaffActionType.EXTENDED,
          entityType: StaffEntityType.BOOKING_EXTENSION,
          entityRef: updatedExtension.publicId,
          description: `Booking ${booking.publicId} extended to ${effectiveNewEndAt.toISOString()} via ${input.resolutionType}`,
        }),
      ]);

      return updatedExtension;
    } catch (error) {
      // Rollback: if extension was not yet committed, cancel it and clear activeExtensionId
      await prisma.bookingExtension.update({
        where: { id: extension.id },
        data: { extensionStatus: ExtensionStatus.CANCELLED },
      });
      await prisma.booking.update({
        where: { id: booking.id },
        data: { activeExtensionId: null },
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
   * Cancel a pending extension — reverts activeExtensionId on the booking.
   */
  async cancel(extensionPublicId: string, actor: ActorContext, reason?: string): Promise<void> {
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      select: { id: true, bookingId: true, extensionStatus: true },
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
      await tx.booking.update({
        where: { id: extension.bookingId },
        data: { activeExtensionId: null },
      });
    });

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

    const [extensions, total] = await Promise.all([
      prisma.bookingExtension.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.bookingExtension.count({ where }),
    ]);

    return { extensions, total, page, pageSize };
  }

  async getDisplacedBookingsForBranch(branchId: number): Promise<
    Array<{
      id: number;
      publicId: string;
      extensionDisplacedAt: Date | null;
      displacedByExtensionId: number | null;
      status: string;
    }>
  > {
    return prisma.booking.findMany({
      where: {
        branchId,
        extensionDisplacedAt: { not: null },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
      },
      select: {
        id: true,
        publicId: true,
        extensionDisplacedAt: true,
        displacedByExtensionId: true,
        status: true,
      },
      orderBy: { extensionDisplacedAt: "desc" },
    });
  }
}

export const extensionService = new ExtensionService();
