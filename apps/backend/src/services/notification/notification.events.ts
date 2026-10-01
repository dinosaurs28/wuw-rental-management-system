import { prisma, Role } from "@repo/database/client";
import type { NotificationApprovalKind, NotificationData } from "@repo/schemas";
import { TimezoneService } from "../timezone/timezone.service.js";
import { notify } from "./notification.service.js";

/**
 * One function per business event. Each takes the ids the caller already has,
 * loads what the message needs, and calls notify() for every audience.
 *
 * Callers invoke them AFTER their transaction commits, fire-and-forget:
 *   void notifyEvents.bookingConfirmed({ bookingId, actorUserId });
 * Every function swallows its own errors — a notification can never fail the
 * business flow that triggered it.
 *
 * Customers receive their own receipts (booking/extension confirmed) even when
 * they triggered the payment themselves; branch users are never notified about
 * an action they took.
 */

type Money = { toString(): string } | number | string | null | undefined;

const STAFF_AND_MANAGER: Role[] = [Role.STAFF, Role.MANAGER];
const MANAGER_ONLY: Role[] = [Role.MANAGER];
const STAFF_ONLY: Role[] = [Role.STAFF];

const inrFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: Money): string {
  const n = Number(value?.toString() ?? 0);
  return `₹${inrFormatter.format(Number.isFinite(n) ? n : 0)}`;
}

function when(date: Date): string {
  return TimezoneService.formatForDisplay(TimezoneService.fromJSDate(date), "full");
}

function ref(publicId: string): string {
  return `#${publicId.slice(-8).toUpperCase()}`;
}

function vehicleName(v: { make: string; model: string } | null | undefined): string {
  return v ? `${v.make} ${v.model}` : "your vehicle";
}

function vehicleLabel(v: { make: string; model: string; regNo: string } | null | undefined): string {
  return v ? `${v.make} ${v.model} (${v.regNo})` : "vehicle";
}

/** Runs an event body and logs instead of throwing. */
async function safely(event: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    console.error(`[notifyEvents.${event}] failed:`, error);
  }
}

async function resolveActorId(
  actorUserId?: number | null,
  actorPublicId?: string | null,
): Promise<number | null> {
  if (actorUserId) return actorUserId;
  if (!actorPublicId) return null;
  const user = await prisma.user.findUnique({
    where: { publicId: actorPublicId },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function actorName(actorUserId: number | null | undefined): Promise<string> {
  if (!actorUserId) return "A team member";
  const user = await prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } });
  return user?.name ?? "A team member";
}

async function loadBooking(bookingId: number) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      publicId: true,
      branchId: true,
      status: true,
      startAt: true,
      endAt: true,
      createdById: true,
      totalFinal: true,
      isAdvancePayment: true,
      advanceAmount: true,
      requiresManagerConfirmation: true,
      customer: { select: { userId: true, user: { select: { name: true } } } },
      items: {
        take: 1,
        select: { vehicle: { select: { make: true, model: true, regNo: true } } },
      },
    },
  });
}

type BookingCtx = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

function bookingData(booking: BookingCtx, extra: NotificationData = {}): NotificationData {
  return { bookingPublicId: booking.publicId, entity: "Booking", entityPublicId: booking.publicId, ...extra };
}

const APPROVAL_LABELS: Record<NotificationApprovalKind, string> = {
  MANUAL_DISCOUNT: "Manual discount",
  CHARGE_OVERRIDE: "Charge waiver",
  SAFETY_DEPOSIT: "Safety deposit",
  REFUND: "Refund",
  CASH_PAYMENT: "Cash payment",
  PICKUP: "Pickup",
  RETURN: "Return",
};

const APPROVAL_DEDUPE: Record<NotificationApprovalKind, string> = {
  MANUAL_DISCOUNT: "discount",
  CHARGE_OVERRIDE: "override",
  SAFETY_DEPOSIT: "sdr",
  REFUND: "refund",
  CASH_PAYMENT: "cash",
  PICKUP: "pickup",
  RETURN: "return",
};

export const notifyEvents = {
  /** HOLD → CONFIRMED after payment (online, walk-in cash/UPI, manager recheck). */
  bookingConfirmed(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("bookingConfirmed", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking || booking.status === "CANCELLED") return;
      const vehicle = booking.items[0]?.vehicle;
      const dedupeKey = `booking-confirmed:${booking.publicId}`;
      const base = {
        type: "BOOKING_CONFIRMED" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking),
        dedupeKey,
      };
      const paid = booking.isAdvancePayment
        ? ` Advance of ${money(booking.advanceAmount)} received.`
        : "";

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Booking confirmed",
        body: `Your booking ${ref(booking.publicId)} for the ${vehicleName(vehicle)} is confirmed. Pickup on ${when(booking.startAt)}.${paid}`,
      });
      await notify({
        ...base,
        recipients: [{ branchId: booking.branchId, roles: STAFF_AND_MANAGER }],
        actorUserId: args.actorUserId,
        title: "New booking",
        body: `${ref(booking.publicId)} · ${vehicleLabel(vehicle)} for ${booking.customer.user.name} — pickup ${when(booking.startAt)}.`,
      });
    });
  },

  /** Money was captured but the booking/extension can no longer be confirmed. */
  paymentNeedsRefund(args: {
    bookingId: number;
    transactionId: string;
    extensionId?: number | null;
  }): Promise<void> {
    return safely("paymentNeedsRefund", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking) return;
      const extension = args.extensionId
        ? await prisma.bookingExtension.findUnique({
            where: { id: args.extensionId },
            select: { publicId: true, additionalAmount: true, extensionStatus: true },
          })
        : null;
      const amount = extension
        ? extension.additionalAmount
        : booking.isAdvancePayment
          ? booking.advanceAmount
          : booking.totalFinal;
      const what = extension ? "extension" : "booking";
      const data = bookingData(booking, extension ? { extensionPublicId: extension.publicId } : {});
      const base = {
        type: "PAYMENT_NEEDS_REFUND" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data,
        dedupeKey: `refund-required:${args.transactionId}`,
      };

      await notify({
        ...base,
        recipients: [{ branchId: booking.branchId, roles: MANAGER_ONLY }],
        title: "Refund needed",
        body: extension
          ? `${money(amount)} was paid online for an extension of ${ref(booking.publicId)} after it was ${extension.extensionStatus === "REJECTED" ? "rejected" : "cancelled"}. Refund the customer (order ${args.transactionId}).`
          : `${money(amount)} was paid online for ${ref(booking.publicId)} after the booking was cancelled. Refund the customer (order ${args.transactionId}).`,
      });
      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Payment received — refund due",
        body: `We received ${money(amount)} for your ${what} on booking ${ref(booking.publicId)}, but it could not be confirmed. The branch has been asked to refund it.`,
      });
    });
  },

  /** Extension finalised (customer online payment, counter collection, cash confirmation, session). */
  extensionConfirmed(args: {
    extensionId: number;
    actorUserId?: number | null;
    /** Also tell branch STAFF + MANAGER — used when the customer extended it themselves. */
    notifyBranch?: boolean;
  }): Promise<void> {
    return safely("extensionConfirmed", async () => {
      const extension = await prisma.bookingExtension.findUnique({
        where: { id: args.extensionId },
        select: {
          publicId: true,
          bookingId: true,
          extensionStatus: true,
          additionalAmount: true,
          requestedEndAt: true,
          actualNewEndAt: true,
        },
      });
      if (!extension || extension.extensionStatus !== "CONFIRMED") return;
      const booking = await loadBooking(extension.bookingId);
      if (!booking) return;
      const newEnd = extension.actualNewEndAt ?? extension.requestedEndAt;
      const base = {
        type: "EXTENSION_CONFIRMED" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, {
          extensionPublicId: extension.publicId,
          entity: "BookingExtension",
          entityPublicId: extension.publicId,
        }),
        dedupeKey: `ext-confirmed:${extension.publicId}`,
      };

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Trip extended",
        body: `Booking ${ref(booking.publicId)} now ends on ${when(newEnd)}.`,
      });
      if (args.notifyBranch) {
        await notify({
          ...base,
          recipients: [{ branchId: booking.branchId, roles: STAFF_AND_MANAGER }],
          actorUserId: args.actorUserId,
          title: "Booking extended",
          body: `${booking.customer.user.name} extended ${ref(booking.publicId)} (${vehicleLabel(booking.items[0]?.vehicle)}) to ${when(newEnd)} — paid ${money(extension.additionalAmount)} online.`,
        });
      }
    });
  },

  /** Extension rejected (its counter cash payment was rejected by the manager). */
  extensionRejected(args: { extensionId: number; actorUserId?: number | null }): Promise<void> {
    return safely("extensionRejected", async () => {
      const extension = await prisma.bookingExtension.findUnique({
        where: { id: args.extensionId },
        select: { publicId: true, bookingId: true, extensionStatus: true, oldEndAt: true },
      });
      if (!extension || extension.extensionStatus !== "REJECTED") return;
      const booking = await loadBooking(extension.bookingId);
      if (!booking) return;
      await notify({
        type: "EXTENSION_REJECTED",
        recipients: [booking.customer.userId],
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, {
          extensionPublicId: extension.publicId,
          entity: "BookingExtension",
          entityPublicId: extension.publicId,
        }),
        dedupeKey: `ext-rejected:${extension.publicId}`,
        title: "Extension not confirmed",
        body: `The extension of booking ${ref(booking.publicId)} was not confirmed because its payment could not be verified. Your return time stays ${when(booking.endAt)}.`,
      });
    });
  },

  /** Booking cancelled (no-show — manual or the 06:00 auto-cancel — or a displaced booking cancelled). */
  bookingCancelled(args: {
    bookingId: number;
    actorUserId?: number | null;
    actorPublicId?: string | null;
    /** Shown to the customer and staff. */
    reason?: string | null;
    /** System cancellations also go to the branch manager. */
    bySystem?: boolean;
  }): Promise<void> {
    return safely("bookingCancelled", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking || booking.status !== "CANCELLED") return;
      const actorId = await resolveActorId(args.actorUserId, args.actorPublicId);
      const reason = args.reason?.trim() ? `: ${args.reason.trim()}` : ".";
      const vehicle = booking.items[0]?.vehicle;
      const base = {
        type: "BOOKING_CANCELLED" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking),
        dedupeKey: `cancelled:${booking.publicId}`,
      };

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Booking cancelled",
        body: `Your booking ${ref(booking.publicId)} for the ${vehicleName(vehicle)} (pickup ${when(booking.startAt)}) was cancelled${reason}`,
      });
      await notify({
        ...base,
        recipients: [
          { branchId: booking.branchId, roles: args.bySystem ? STAFF_AND_MANAGER : STAFF_ONLY },
        ],
        actorUserId: actorId,
        title: "Booking cancelled",
        body: `${ref(booking.publicId)} · ${vehicleLabel(vehicle)} for ${booking.customer.user.name} was cancelled${reason}`,
      });
    });
  },

  /** A future booking's car was reassigned because another booking was extended. */
  bookingDisplaced(args: {
    affectedBookingPublicId: string;
    extensionId: number;
    actorUserId?: number | null;
  }): Promise<void> {
    return safely("bookingDisplaced", async () => {
      const affected = await prisma.booking.findUnique({
        where: { publicId: args.affectedBookingPublicId },
        select: { id: true },
      });
      const extension = await prisma.bookingExtension.findUnique({
        where: { id: args.extensionId },
        select: { publicId: true, booking: { select: { publicId: true } } },
      });
      if (!affected || !extension) return;
      const booking = await loadBooking(affected.id);
      if (!booking) return;
      const vehicle = booking.items[0]?.vehicle;
      const base = {
        type: "BOOKING_DISPLACED" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { extensionPublicId: extension.publicId }),
        dedupeKey: `displaced:${booking.publicId}:${extension.publicId}`,
      };

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Your car has changed",
        body: `Your booking ${ref(booking.publicId)} (pickup ${when(booking.startAt)}) is now assigned a ${vehicleName(vehicle)} because the earlier car is unavailable.`,
      });
      await notify({
        ...base,
        recipients: [{ branchId: booking.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        title: "Booking displaced",
        body: `${ref(booking.publicId)} for ${booking.customer.user.name} was moved to ${vehicleLabel(vehicle)} because ${ref(extension.booking.publicId)} was extended. Confirm the swap or cancel it.`,
      });
    });
  },

  /** A refund request was disbursed. */
  refundCompleted(args: { refundRequestId: number; actorUserId?: number | null }): Promise<void> {
    return safely("refundCompleted", async () => {
      const refund = await prisma.refundRequest.findUnique({
        where: { id: args.refundRequestId },
        select: { publicId: true, bookingId: true, amount: true, method: true, status: true },
      });
      if (!refund || refund.status !== "COMPLETED") return;
      const booking = await loadBooking(refund.bookingId);
      if (!booking) return;
      await notify({
        type: "REFUND_COMPLETED",
        recipients: [booking.customer.userId],
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { entity: "RefundRequest", entityPublicId: refund.publicId }),
        dedupeKey: `refund-done:${refund.publicId}`,
        title: "Refund processed",
        body: `${money(refund.amount)} has been refunded for booking ${ref(booking.publicId)} (${refund.method === "CASH" ? "cash" : "online"}).`,
      });
    });
  },

  /** The car was handed over (booking is PICKED_UP). */
  pickupCompleted(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("pickupCompleted", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking || booking.status !== "PICKED_UP") return;
      await notify({
        type: "PICKUP_COMPLETED",
        recipients: [booking.customer.userId],
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking),
        dedupeKey: `pickup:${booking.publicId}`,
        title: "Trip started",
        body: `Enjoy your ${vehicleName(booking.items[0]?.vehicle)}! Please return it by ${when(booking.endAt)} (booking ${ref(booking.publicId)}).`,
      });
    });
  },

  /** Staff sent a pickup to the manager for confirmation. */
  pickupApprovalRequested(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("pickupApprovalRequested", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking) return;
      await notify({
        type: "PICKUP_APPROVAL_REQUESTED",
        recipients: [{ branchId: booking.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { approvalKind: "PICKUP" }),
        dedupeKey: `pickup-approval:${booking.publicId}`,
        title: "Pickup needs your confirmation",
        body: `${await actorName(args.actorUserId)} sent the pickup of ${ref(booking.publicId)} (${vehicleLabel(booking.items[0]?.vehicle)}, ${booking.customer.user.name}) for confirmation.`,
      });
    });
  },

  /** The car is back (booking is RETURNED). */
  returnCompleted(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("returnCompleted", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking || booking.status !== "RETURNED") return;
      await notify({
        type: "RETURN_COMPLETED",
        recipients: [booking.customer.userId],
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking),
        dedupeKey: `return:${booking.publicId}`,
        title: "Trip completed",
        body: `Your trip ${ref(booking.publicId)} with the ${vehicleName(booking.items[0]?.vehicle)} is complete. Thank you!`,
      });
    });
  },

  /** Staff sent a return to the manager for confirmation. */
  returnApprovalRequested(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("returnApprovalRequested", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking) return;
      await notify({
        type: "RETURN_APPROVAL_REQUESTED",
        recipients: [{ branchId: booking.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { approvalKind: "RETURN" }),
        dedupeKey: `return-approval:${booking.publicId}`,
        title: "Return needs your confirmation",
        body: `${await actorName(args.actorUserId)} sent the return of ${ref(booking.publicId)} (${vehicleLabel(booking.items[0]?.vehicle)}, ${booking.customer.user.name}) for confirmation.`,
      });
    });
  },

  /** Damage reports on a booking await the manager's review. */
  damageReported(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("damageReported", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking) return;
      const pending = await prisma.damageReport.findMany({
        where: { bookingId: booking.id, status: "PENDING" },
        select: { publicId: true },
        orderBy: { id: "asc" },
      });
      if (pending.length === 0) return;
      const latest = pending[pending.length - 1]!;
      await notify({
        type: "DAMAGE_REPORTED",
        recipients: [{ branchId: booking.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { entity: "DamageReport", entityPublicId: latest.publicId }),
        // A later report on the same booking changes the key and alerts again.
        dedupeKey: `damage:${booking.publicId}:${pending.length}:${latest.publicId}`,
        title: "Damage reported",
        body: `${pending.length === 1 ? "A damage report" : `${pending.length} damage reports`} on ${ref(booking.publicId)} (${vehicleLabel(booking.items[0]?.vehicle)}) ${pending.length === 1 ? "needs" : "need"} your review.`,
      });
    });
  },

  /** A manager charged the customer for damage. */
  damageCharged(args: {
    damageReportId: number;
    amount: Money;
    actorUserId?: number | null;
  }): Promise<void> {
    return safely("damageCharged", async () => {
      const report = await prisma.damageReport.findUnique({
        where: { id: args.damageReportId },
        select: { publicId: true, bookingId: true },
      });
      if (!report || Number(args.amount?.toString() ?? 0) <= 0) return;
      const booking = await loadBooking(report.bookingId);
      if (!booking) return;
      await notify({
        type: "DAMAGE_CHARGED",
        recipients: [booking.customer.userId],
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { entity: "DamageReport", entityPublicId: report.publicId }),
        dedupeKey: `damage-closed:${report.publicId}`,
        title: "Damage charge added",
        body: `A damage charge of ${money(args.amount)} was added to booking ${ref(booking.publicId)}.`,
      });
    });
  },

  /** The booking's car was swapped (mid-rental, before pickup, or by an extension). */
  vehicleSwapped(args: { swapId: number; actorUserId?: number | null }): Promise<void> {
    return safely("vehicleSwapped", async () => {
      const swap = await prisma.vehicleSwap.findUnique({
        where: { id: args.swapId },
        select: {
          publicId: true,
          bookingId: true,
          swappedById: true,
          originalVehicle: { select: { make: true, model: true, regNo: true } },
          newVehicle: { select: { make: true, model: true, regNo: true } },
        },
      });
      if (!swap) return;
      const booking = await loadBooking(swap.bookingId);
      if (!booking) return;
      const actorId = args.actorUserId ?? swap.swappedById;
      const base = {
        type: "VEHICLE_SWAPPED" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking, { entity: "VehicleSwap", entityPublicId: swap.publicId }),
        dedupeKey: `swap:${swap.publicId}`,
      };

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Your car has changed",
        body: `Booking ${ref(booking.publicId)} is now on a ${vehicleLabel(swap.newVehicle)}.`,
      });
      await notify({
        ...base,
        recipients: [{ branchId: booking.branchId, roles: STAFF_AND_MANAGER }],
        actorUserId: actorId,
        title: "Vehicle swapped",
        body: `${ref(booking.publicId)} moved from ${vehicleLabel(swap.originalVehicle)} to ${vehicleLabel(swap.newVehicle)} by ${await actorName(actorId)}.`,
      });
    });
  },

  /** Something waits in a manager approval queue. */
  approvalRequested(args: {
    kind: NotificationApprovalKind;
    entity: string;
    entityPublicId: string;
    branchId: number;
    bookingId?: number | null;
    amount?: Money;
    reason?: string | null;
    actorUserId?: number | null;
  }): Promise<void> {
    return safely("approvalRequested", async () => {
      const booking = args.bookingId ? await loadBooking(args.bookingId) : null;
      const who = await actorName(args.actorUserId);
      const on = booking ? ` on ${ref(booking.publicId)}` : "";
      const why = args.reason?.trim() ? `: ${args.reason.trim()}` : ".";
      const amount = args.amount !== undefined && args.amount !== null ? money(args.amount) : null;
      const label = APPROVAL_LABELS[args.kind];
      const of = amount ? ` of ${amount}` : "";
      let body: string;
      switch (args.kind) {
        case "CHARGE_OVERRIDE":
          body = `${who} wants to waive ${amount ?? "a charge"}${on}${why}`;
          break;
        case "MANUAL_DISCOUNT":
          body = `${who} requested a discount${of}${on}${why}`;
          break;
        case "SAFETY_DEPOSIT":
          body = `${who} requested a safety deposit${of}${on}${why}`;
          break;
        case "REFUND":
          body = `${who} requested a refund${of}${on}${why}`;
          break;
        default:
          body = `${who} needs your approval for ${label.toLowerCase()}${of}${on}${why}`;
      }
      await notify({
        type: "APPROVAL_REQUESTED",
        recipients: [{ branchId: args.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        branchId: args.branchId,
        bookingId: booking?.id ?? null,
        data: {
          ...(booking ? { bookingPublicId: booking.publicId } : {}),
          entity: args.entity,
          entityPublicId: args.entityPublicId,
          approvalKind: args.kind,
        },
        dedupeKey: `approval:${APPROVAL_DEDUPE[args.kind]}:${args.entityPublicId}`,
        title: `${label} needs approval`,
        body,
      });
    });
  },

  /** A manager decided on something a staff member asked for. */
  approvalResolved(args: {
    kind: NotificationApprovalKind;
    entity: string;
    entityPublicId: string;
    branchId: number;
    approved: boolean;
    /** The requester; omit to tell every STAFF member of the branch. */
    recipientUserId?: number | null;
    bookingId?: number | null;
    amount?: Money;
    reason?: string | null;
    actorUserId?: number | null;
    actorPublicId?: string | null;
  }): Promise<void> {
    return safely("approvalResolved", async () => {
      const actorId = await resolveActorId(args.actorUserId, args.actorPublicId);
      const booking = args.bookingId ? await loadBooking(args.bookingId) : null;
      const label = APPROVAL_LABELS[args.kind];
      const verb =
        args.kind === "PICKUP" || args.kind === "RETURN" || args.kind === "CASH_PAYMENT"
          ? args.approved ? "confirmed" : "rejected"
          : args.approved ? "approved" : "rejected";
      const amount = args.amount !== undefined && args.amount !== null ? ` of ${money(args.amount)}` : "";
      const on = booking ? ` for ${ref(booking.publicId)}` : "";
      const why = !args.approved && args.reason?.trim() ? `: ${args.reason.trim()}` : ".";
      await notify({
        type: "APPROVAL_RESOLVED",
        recipients: args.recipientUserId
          ? [args.recipientUserId]
          : [{ branchId: args.branchId, roles: STAFF_ONLY }],
        actorUserId: actorId,
        branchId: args.branchId,
        bookingId: booking?.id ?? null,
        data: {
          ...(booking ? { bookingPublicId: booking.publicId } : {}),
          entity: args.entity,
          entityPublicId: args.entityPublicId,
          approvalKind: args.kind,
          approved: args.approved,
        },
        dedupeKey: `approval-result:${APPROVAL_DEDUPE[args.kind]}:${args.entityPublicId}`,
        title: `${label} ${verb}`,
        body: `${label}${amount}${on} was ${verb} by ${await actorName(actorId)}${why}`,
      });
    });
  },

  /** A safety deposit request on this booking waits for the manager. */
  safetyDepositRequested(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("safetyDepositRequested", async () => {
      const request = await prisma.safetyDepositRequest.findUnique({
        where: { bookingId: args.bookingId },
        select: { publicId: true, status: true, requestedAmount: true, reason: true, requestedById: true, booking: { select: { branchId: true } } },
      });
      if (!request || request.status !== "PENDING_APPROVAL") return;
      await notifyEvents.approvalRequested({
        kind: "SAFETY_DEPOSIT",
        entity: "SafetyDepositRequest",
        entityPublicId: request.publicId,
        branchId: request.booking.branchId,
        bookingId: args.bookingId,
        amount: request.requestedAmount,
        reason: request.reason,
        actorUserId: args.actorUserId ?? request.requestedById,
      });
    });
  },

  /** Every refund request on this booking still waiting for the manager. */
  refundApprovalsPending(args: { bookingId: number; actorUserId?: number | null }): Promise<void> {
    return safely("refundApprovalsPending", async () => {
      const refunds = await prisma.refundRequest.findMany({
        where: { bookingId: args.bookingId, status: "PENDING_APPROVAL" },
        select: { publicId: true, branchId: true, amount: true, reason: true, method: true, requestedById: true },
      });
      for (const refund of refunds) {
        await notifyEvents.approvalRequested({
          kind: "REFUND",
          entity: "RefundRequest",
          entityPublicId: refund.publicId,
          branchId: refund.branchId,
          bookingId: args.bookingId,
          amount: refund.amount,
          reason: `${refund.method === "CASH" ? "Cash" : "Online"} refund — ${refund.reason}`,
          actorUserId: args.actorUserId ?? refund.requestedById,
        });
      }
    });
  },

  /** A pickup / extension / return payment session reached COMPLETED. */
  paymentSessionCompleted(args: { sessionId: number; actorUserId?: number | null }): Promise<void> {
    return safely("paymentSessionCompleted", async () => {
      const session = await prisma.paymentSession.findUnique({
        where: { id: args.sessionId },
        select: { bookingId: true, sessionType: true, status: true },
      });
      if (!session || session.status !== "COMPLETED") return;
      const { bookingId } = session;

      if (session.sessionType === "PICKUP" || session.sessionType === "EXTENSION") {
        if (session.sessionType === "PICKUP") {
          await notifyEvents.pickupCompleted({ bookingId, actorUserId: args.actorUserId });
        }
        // Pickup and extension sessions confirm a pending extension on completion.
        const justConfirmed = await prisma.bookingExtension.findMany({
          where: {
            bookingId,
            extensionStatus: "CONFIRMED",
            updatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          },
          select: { id: true },
        });
        for (const extension of justConfirmed) {
          await notifyEvents.extensionConfirmed({ extensionId: extension.id, actorUserId: args.actorUserId });
        }
      } else if (session.sessionType === "RETURN") {
        await notifyEvents.returnCompleted({ bookingId, actorUserId: args.actorUserId });
        // Drop damages are only final once the drop closes (they can be deleted before).
        await notifyEvents.damageReported({ bookingId, actorUserId: args.actorUserId });
      }
      await notifyEvents.refundApprovalsPending({ bookingId, actorUserId: args.actorUserId });
    });
  },

  /** A cash shift closed with a discrepancy. */
  shiftDiscrepancy(args: { shiftId: number; actorUserId?: number | null }): Promise<void> {
    return safely("shiftDiscrepancy", async () => {
      const shift = await prisma.cashShift.findUnique({
        where: { id: args.shiftId },
        select: {
          publicId: true,
          branchId: true,
          status: true,
          discrepancy: true,
          discrepancyExplanation: true,
          employee: { select: { name: true } },
        },
      });
      if (!shift || shift.status !== "DISCREPANCY_FLAGGED") return;
      const diff = Number(shift.discrepancy.toString());
      const direction = diff < 0 ? "short" : "over";
      const why = shift.discrepancyExplanation?.trim() ? `: ${shift.discrepancyExplanation.trim()}` : ".";
      await notify({
        type: "SHIFT_DISCREPANCY",
        recipients: [{ branchId: shift.branchId, roles: MANAGER_ONLY }],
        actorUserId: args.actorUserId,
        branchId: shift.branchId,
        data: { entity: "CashShift", entityPublicId: shift.publicId },
        dedupeKey: `shift-discrepancy:${shift.publicId}`,
        title: "Cash shift discrepancy",
        body: `${shift.employee.name}'s shift closed ${money(Math.abs(diff))} ${direction}${why}`,
      });
    });
  },

  /** A PICKED_UP booking is past its return time (worker). Once per endAt. */
  returnOverdue(args: { bookingId: number }): Promise<void> {
    return safely("returnOverdue", async () => {
      const booking = await loadBooking(args.bookingId);
      if (!booking || booking.status !== "PICKED_UP") return;
      // Re-checked here: a return sent for confirmation or an extension may
      // have landed since the scan.
      if (booking.requiresManagerConfirmation || booking.endAt.getTime() > Date.now()) return;
      const vehicle = booking.items[0]?.vehicle;
      const base = {
        type: "RETURN_OVERDUE" as const,
        branchId: booking.branchId,
        bookingId: booking.id,
        data: bookingData(booking),
        // An extension moves endAt and re-arms the alert.
        dedupeKey: `overdue:${booking.publicId}:${booking.endAt.toISOString()}`,
      };

      await notify({
        ...base,
        recipients: [booking.customer.userId],
        title: "Return overdue",
        body: `Booking ${ref(booking.publicId)} was due back at ${when(booking.endAt)}. Please return the ${vehicleName(vehicle)} or extend your trip — late charges may apply.`,
      });
      await notify({
        ...base,
        recipients: [{ branchId: booking.branchId, roles: STAFF_AND_MANAGER }],
        title: "Return overdue",
        body: `${ref(booking.publicId)} · ${vehicleLabel(vehicle)} (${booking.customer.user.name}) was due back at ${when(booking.endAt)}.`,
      });
    });
  },

  /** Counter cash still unconfirmed past the branch threshold (worker). Once per transaction. */
  cashDelayed(args: { transactionId: number; thresholdHours: number }): Promise<void> {
    return safely("cashDelayed", async () => {
      const txn = await prisma.paymentTransaction.findUnique({
        where: { id: args.transactionId },
        select: {
          publicId: true,
          branchId: true,
          bookingId: true,
          status: true,
          totalAmount: true,
          collectedAt: true,
          collectedBy: { select: { name: true } },
          booking: { select: { publicId: true } },
        },
      });
      if (!txn || txn.status !== "COLLECTED") return;
      await notify({
        type: "CASH_DELAYED",
        recipients: [{ branchId: txn.branchId, roles: MANAGER_ONLY }],
        branchId: txn.branchId,
        bookingId: txn.bookingId,
        data: {
          bookingPublicId: txn.booking.publicId,
          entity: "PaymentTransaction",
          entityPublicId: txn.publicId,
          approvalKind: "CASH_PAYMENT",
        },
        dedupeKey: `delayed-cash:${txn.publicId}`,
        title: "Cash not yet confirmed",
        body: `${money(txn.totalAmount)} collected by ${txn.collectedBy?.name ?? "staff"} for ${ref(txn.booking.publicId)}${txn.collectedAt ? ` on ${when(txn.collectedAt)}` : ""} is still unconfirmed after ${args.thresholdHours}h.`,
      });
    });
  },
};
