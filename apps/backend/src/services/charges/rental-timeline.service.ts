/**
 * Rental timeline for the drop screen: the booked window as originally agreed,
 * the time added by formal extensions, any late return beyond the current end,
 * and the totals — all in whole minutes so Original + Extended = Total exactly.
 *
 * The original end is taken from the extension rows, not Booking.originalEndAt
 * alone: originalEndAt stays null while a cash extension awaits the manager
 * (PAYMENT_COLLECTED) and is not set on every confirmation path.
 *
 * Extensions that count:
 *   CONFIRMED          extended
 *   PAYMENT_COLLECTED  extended — cash taken, awaiting the manager
 *   PENDING_PAYMENT    extended but unpaid — only a committed hold (resolutionType
 *                      set and still the booking's activeExtensionId), whose end
 *                      is already on booking.endAt
 * Uncommitted quotes, CANCELLED and REJECTED rows are left out.
 */
import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import Decimal from "decimal.js";
import {
  resolveLateReturnPolicy,
  calculateLateReturnCharge,
  serializeLateReturn,
  type LateReturnCharge,
  type SerializedLateReturn,
} from "./late-return.service.js";
import type { TxClient } from "../payment/paymentSession.service.js";
import { extensionFreeKm, loadBookingFreeKmRates, type FreeKmRates } from "./extension-km.js";

export interface TimelineExtensionInput {
  id: number;
  publicId: string;
  oldEndAt: Date;
  requestedEndAt: Date;
  actualNewEndAt: Date | null;
  extensionStatus: ExtensionStatus;
  resolutionType: string | null;
  extensionTrigger: string;
  additionalAmount: { toString(): string };
  taxAmount: { toString(): string };
  createdAt: Date;
}

const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);

/** True for an extension row that is part of the booked window (see header). */
export function isLiveExtension(ext: TimelineExtensionInput, activeExtensionId: number | null): boolean {
  if (ext.extensionStatus === ExtensionStatus.CONFIRMED) return true;
  if (ext.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED) return true;
  return (
    ext.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
    ext.resolutionType != null &&
    ext.id === activeExtensionId
  );
}

export interface ActiveExtensionState {
  /** Committed but unpaid (its end is already on booking.endAt), or cash awaiting the manager. */
  blocking: { id: number; publicId: string; extensionStatus: ExtensionStatus } | null;
  /** A customer quote that was never committed — holds no slot and no money. */
  uncommittedQuoteId: number | null;
}

/**
 * The booking's active extension, sorted into what blocks a drop (a committed
 * extension still unpaid must not earn free km or hide lateness) and an
 * abandoned customer quote, which only needs releasing. Used by the drop bill
 * and the legacy complete.
 */
export async function activeExtensionState(
  activeExtensionId: number | null,
  tx?: TxClient,
): Promise<ActiveExtensionState> {
  if (activeExtensionId == null) return { blocking: null, uncommittedQuoteId: null };
  const db = tx ?? prisma;
  const extension = await db.bookingExtension.findUnique({
    where: { id: activeExtensionId },
    select: {
      id: true,
      publicId: true,
      extensionStatus: true,
      resolutionType: true,
      gatewayTransactionId: true,
      paymentTransactionId: true,
    },
  });
  if (!extension) return { blocking: null, uncommittedQuoteId: null };
  const isOpen =
    extension.extensionStatus === ExtensionStatus.PENDING_PAYMENT ||
    extension.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED;
  // Same predicate as extensionService.evaluate uses to replace a stale quote
  const isUncommittedQuote =
    extension.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
    extension.resolutionType === null &&
    extension.gatewayTransactionId === null &&
    extension.paymentTransactionId === null;
  if (isUncommittedQuote) return { blocking: null, uncommittedQuoteId: extension.id };
  return {
    blocking: isOpen
      ? { id: extension.id, publicId: extension.publicId, extensionStatus: extension.extensionStatus }
      : null,
    uncommittedQuoteId: null,
  };
}

/**
 * Pure: booked window and extensions (no late return). With the vehicle's
 * slab free km (freeKmRates), each extension also carries the free km it adds
 * to the drop allowance (#7 rule, extension-km.ts); null when they're unknown.
 */
export function buildRentalPeriod(
  booking: { startAt: Date; endAt: Date; originalEndAt: Date | null; activeExtensionId: number | null },
  extensions: TimelineExtensionInput[],
  freeKmRates: FreeKmRates | null = null,
) {
  const live = extensions
    .filter((e) => isLiveExtension(e, booking.activeExtensionId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const earliestOldEnd = live.length > 0
    ? new Date(Math.min(...live.map((e) => e.oldEndAt.getTime())))
    : null;
  const originalEndAt = earliestOldEnd ?? booking.originalEndAt ?? booking.endAt;

  const totalMinutes = Math.max(0, minutesBetween(booking.startAt, booking.endAt));
  const originalMinutes = Math.min(totalMinutes, Math.max(0, minutesBetween(booking.startAt, originalEndAt)));
  const extendedMinutes = Math.max(0, totalMinutes - originalMinutes);

  // Free km each extension adds (#7) — the same figures the drop's km allowance sums
  const extensionKm = live.map((e) =>
    freeKmRates
      ? extensionFreeKm(Math.max(0, minutesBetween(e.oldEndAt, e.actualNewEndAt ?? e.requestedEndAt)), freeKmRates)
      : null,
  );

  return {
    startAt: booking.startAt.toISOString(),
    originalEndAt: originalEndAt.toISOString(),
    currentEndAt: booking.endAt.toISOString(),
    originalMinutes,
    extendedMinutes,
    totalMinutes,
    extensionCount: live.length,
    /** Σ free km the extensions add to the allowance; null when the vehicle's free km are unknown. */
    extensionFreeKmTotal: extensionKm.every((k) => k != null)
      ? extensionKm.reduce((sum, k) => sum + (k?.km ?? 0), 0)
      : null,
    extensions: live.map((e, index) => {
      const newEndAt = e.actualNewEndAt ?? e.requestedEndAt;
      return {
        publicId: e.publicId,
        oldEndAt: e.oldEndAt.toISOString(),
        newEndAt: newEndAt.toISOString(),
        minutes: Math.max(0, minutesBetween(e.oldEndAt, newEndAt)),
        status: e.extensionStatus,
        /** Committed but not paid yet — the drop bill stays blocked until it is collected or cancelled. */
        unpaid: e.extensionStatus === ExtensionStatus.PENDING_PAYMENT,
        /** Cash taken; the branch manager has not confirmed it yet. */
        awaitingConfirmation: e.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED,
        isPartial: e.resolutionType === "PARTIAL_EXTENSION",
        trigger: e.extensionTrigger,
        additionalAmount: new Decimal(e.additionalAmount.toString()).toFixed(2),
        taxAmount: new Decimal(e.taxAmount.toString()).toFixed(2),
        /** Free km this extension adds (whole 24 h → freeKm24Hour, a remaining ≥ 12 h → freeKm12Hour). */
        freeKm: extensionKm[index] ?? null,
      };
    }),
  };
}

type LatePreview = Pick<
  SerializedLateReturn,
  "hours" | "rate" | "taxable" | "cgst" | "sgst" | "gst" | "gstRate" | "total" | "status" | "graceApplied"
> & { gstUnavailableReason: string | null };

const toPreview = (late: SerializedLateReturn, gstUnavailableReason: string | null = null): LatePreview => ({
  hours: late.hours,
  rate: late.rate,
  taxable: late.taxable,
  cgst: late.cgst,
  sgst: late.sgst,
  gst: late.gst,
  gstRate: late.gstRate,
  total: late.total,
  status: late.status,
  graceApplied: late.graceApplied,
  gstUnavailableReason,
});

/**
 * Late charge preview. A late return is a recovery charge: billed at face value
 * with no GST (item 8), so gst/cgst/sgst are 0, gstRate null and total = amount.
 */
async function priceLateCharge(
  charge: LateReturnCharge,
  _branchId: number,
  _db: TxClient,
): Promise<LatePreview> {
  return toPreview(serializeLateReturn(charge));
}

/**
 * Full timeline for a booking (internal id). The late part is measured to:
 *  - opts.late, when the caller already billed it (the drop-bill compute)
 *  - PICKED_UP with Booking.returnedAt set (a legacy drop awaiting the
 *    manager's confirmation): that time — the late charge is already recorded
 *  - PICKED_UP: the returnedAt frozen on the open RETURN session (while the
 *    bill is still for the current endAt), else now
 *  - RETURNED: Booking.returnedAt (no preview — the bill is settled)
 */
export async function getRentalTimeline(
  bookingId: number,
  opts: { late?: SerializedLateReturn | null; now?: Date; tx?: TxClient } = {},
) {
  const db = opts.tx ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      startAt: true,
      endAt: true,
      originalEndAt: true,
      activeExtensionId: true,
      status: true,
      returnedAt: true,
      branchId: true,
      extensions: {
        where: {
          extensionStatus: {
            in: [ExtensionStatus.CONFIRMED, ExtensionStatus.PAYMENT_COLLECTED, ExtensionStatus.PENDING_PAYMENT],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          publicId: true,
          oldEndAt: true,
          requestedEndAt: true,
          actualNewEndAt: true,
          extensionStatus: true,
          resolutionType: true,
          extensionTrigger: true,
          additionalAmount: true,
          taxAmount: true,
          createdAt: true,
        },
      },
    },
  });
  if (!booking) throw new Error("Booking not found");

  // The vehicle's slab free km, for the km each extension adds (missing rates → no km figures)
  const freeKmRates = booking.extensions.length > 0
    ? await loadBookingFreeKmRates(bookingId, db).catch((err) => {
        console.warn(`[rental-timeline] Free km rates unavailable for booking ${bookingId}:`, err);
        return null;
      })
    : null;
  const period = buildRentalPeriod(booking, booking.extensions as TimelineExtensionInput[], freeKmRates);

  let late: {
    returnedAt: string | null;
    lateMinutes: number;
    graceMinutes: number;
    graceType: string | null;
    gracePolicyEnabled: boolean;
    graceApplied: boolean;
    extraTimeEnabled: boolean;
    lateChargePreview: LatePreview | null;
    lateChargePreviewWithGrace: LatePreview | null;
  } = {
    returnedAt: null,
    lateMinutes: 0,
    graceMinutes: 0,
    graceType: null,
    gracePolicyEnabled: false,
    graceApplied: false,
    extraTimeEnabled: false,
    lateChargePreview: null,
    lateChargePreviewWithGrace: null,
  };

  if (opts.late) {
    late = {
      returnedAt: opts.late.returnedAt,
      lateMinutes: opts.late.lateMinutes,
      graceMinutes: opts.late.graceMinutes,
      graceType: opts.late.graceType,
      gracePolicyEnabled: opts.late.gracePolicyEnabled,
      graceApplied: opts.late.graceApplied,
      extraTimeEnabled: opts.late.extraTimeEnabled,
      lateChargePreview: toPreview(opts.late),
      lateChargePreviewWithGrace: null,
    };
  } else if (booking.status === BookingStatus.PICKED_UP || booking.status === BookingStatus.RETURNED) {
    const policy = await resolveLateReturnPolicy(bookingId, db);
    let asOf: Date | null = null;
    let billed: SerializedLateReturn | null = null;

    if (booking.status === BookingStatus.PICKED_UP && booking.returnedAt) {
      // Legacy drop sent for the manager's confirmation: the vehicle is already back
      asOf = booking.returnedAt;
    } else if (booking.status === BookingStatus.PICKED_UP) {
      const openReturn = await db.paymentSession.findFirst({
        where: {
          bookingId,
          sessionType: PaymentSessionType.RETURN,
          status: {
            in: [
              PaymentSessionStatus.OPEN,
              PaymentSessionStatus.COMPUTING,
              PaymentSessionStatus.AWAITING_PAYMENT,
              PaymentSessionStatus.PAYMENT_INITIATED,
            ],
          },
        },
        select: { metadata: true },
      });
      const meta = (openReturn?.metadata ?? null) as Record<string, any> | null;
      const billCurrent = meta?.bookingEndAt && new Date(meta.bookingEndAt).getTime() === booking.endAt.getTime();
      if (billCurrent && meta?.returnedAt) asOf = new Date(meta.returnedAt);
      if (billCurrent && meta?.late) billed = meta.late as SerializedLateReturn;
      asOf ??= opts.now ?? new Date();
    } else {
      asOf = booking.returnedAt;
    }

    if (asOf) {
      const charge = calculateLateReturnCharge(booking.endAt, asOf, policy);
      late = {
        returnedAt: asOf.toISOString(),
        lateMinutes: charge.lateMinutes,
        graceMinutes: charge.graceMinutes,
        graceType: charge.graceType,
        gracePolicyEnabled: charge.gracePolicyEnabled,
        graceApplied: billed ? billed.graceApplied : charge.graceApplied,
        extraTimeEnabled: charge.extraTimeEnabled,
        lateChargePreview: null,
        lateChargePreviewWithGrace: null,
      };
      // No preview once the drop is recorded (RETURNED, or awaiting the manager) — it is billed
      if (booking.status === BookingStatus.PICKED_UP && !booking.returnedAt) {
        late.lateChargePreview = billed ? toPreview(billed) : await priceLateCharge(charge, booking.branchId, db);
        // MANUAL grace: staff can tick "Apply grace" — show what that would bill
        if (!billed && policy.gracePolicyEnabled && policy.graceType === "MANUAL" && charge.lateMinutes > 0) {
          const withGrace = calculateLateReturnCharge(booking.endAt, asOf, policy, { applyGrace: true });
          late.lateChargePreviewWithGrace = await priceLateCharge(withGrace, booking.branchId, db);
        }
      }
    }
  }

  return {
    ...period,
    ...late,
    /** Booked total plus any late time (what the customer actually had the vehicle for). */
    totalWithLateMinutes: period.totalMinutes + late.lateMinutes,
  };
}

export type RentalTimeline = Awaited<ReturnType<typeof getRentalTimeline>>;
