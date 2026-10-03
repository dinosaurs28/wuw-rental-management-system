/**
 * Late return — the automatic charge for a vehicle dropped after booking.endAt
 * without a formal extension.
 *
 *   charge = vehicle extraHourRate × ceil(late minutes left after grace / 60)
 *
 * It is an EXTRA_TIME line billed at face value with NO GST — a recovery
 * charge (item 8, Oct 3 2026; it used to carry the branch GST). Lateness is
 * measured from booking.endAt, which already carries any committed extension,
 * so extending at the counter before the drop replaces the late charge.
 *
 * Grace follows the booking's frozen charge config (falling back to the live
 * branch config, then the system defaults):
 *   - grace policy off → no grace
 *   - AUTOMATIC        → graceMinutes always deducted
 *   - MANUAL           → deducted only when staff tick "Apply grace"
 *
 * Used by the drop bill (return session compute), the legacy CompleteReturn and
 * the employee booking detail preview — one formula for all three.
 */
import { prisma } from "@repo/database/client";
import type { GraceType } from "@repo/database/client";
import Decimal from "decimal.js";
import {
  DEFAULT_FROZEN_CHARGE_CONFIG,
  type FrozenChargeConfig,
} from "../../types/charge-engine.types.js";
import type { TxClient } from "../payment/paymentSession.service.js";

export interface LateReturnPolicy {
  extraTimeEnabled: boolean;
  gracePolicyEnabled: boolean;
  graceType: GraceType;
  graceMinutes: number;
  /** Per-hour rate of the booking's current vehicle; null when no pricing is configured. */
  extraHourRate: Decimal | null;
}

/**
 *  - ON_TIME           returned at or before endAt
 *  - WITHIN_GRACE      late, but the grace applied covers it
 *  - CHARGED           billed (amount may be ₹0 if the rate is ₹0)
 *  - WAIVED            staff waived it with a reason
 *  - DISABLED          the branch has extra-time charges turned off
 *  - RATE_UNAVAILABLE  late, but the vehicle has no extra-hour rate configured
 */
export type LateReturnStatus =
  | "ON_TIME"
  | "WITHIN_GRACE"
  | "CHARGED"
  | "WAIVED"
  | "DISABLED"
  | "RATE_UNAVAILABLE";

export interface LateReturnCharge {
  dueAt: Date;
  returnedAt: Date;
  /** Whole minutes after dueAt (0 when on time). */
  lateMinutes: number;
  /** The policy's grace minutes (whether or not they were applied). */
  graceMinutes: number;
  graceApplied: boolean;
  /** Late minutes left after grace. */
  chargeableMinutes: number;
  /** ceil(chargeableMinutes / 60) */
  hours: number;
  rate: Decimal | null;
  /** Pre-GST amount billed: rate × hours when CHARGED, else 0. */
  amount: Decimal;
  /** Pre-GST amount staff waived (status WAIVED), else 0. */
  waivedAmount: Decimal;
  status: LateReturnStatus;
  extraTimeEnabled: boolean;
  gracePolicyEnabled: boolean;
  graceType: GraceType;
}

/** Late, chargeable, not waived — but the vehicle has no extra-hour rate to bill with. */
export class LateReturnRateUnavailableError extends Error {
  code = "LATE_RATE_UNAVAILABLE";
  constructor() {
    super(
      "The vehicle's extra-hour rate isn't set up, so the late return can't be billed. Set the vehicle's pricing, or waive the late charge with a reason.",
    );
    this.name = "LateReturnRateUnavailableError";
  }
}

/**
 * Policy for a booking (internal Booking.id): extra-time switch and grace from
 * frozenChargeConfig ?? BranchChargeConfig ?? defaults; the rate from the current
 * vehicle's custom pricing (when enabled) else the branch category defaults —
 * the same sources the pricing engine reads.
 */
export async function resolveLateReturnPolicy(bookingId: number, tx?: TxClient): Promise<LateReturnPolicy> {
  const db = tx ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      branchId: true,
      frozenChargeConfig: true,
      branch: {
        select: {
          chargeConfig: {
            select: { extraTimeEnabled: true, gracePolicyEnabled: true, graceType: true, graceMinutes: true },
          },
        },
      },
      items: {
        orderBy: { id: "asc" },
        take: 1,
        select: {
          vehicle: {
            select: {
              categoryId: true,
              customPricing: { select: { enabled: true, extraHourRate: true } },
            },
          },
        },
      },
    },
  });
  if (!booking) throw new Error("Booking not found");

  const frozen = (booking.frozenChargeConfig ?? null) as Partial<FrozenChargeConfig> | null;
  const live = booking.branch.chargeConfig;
  const pick = <K extends keyof FrozenChargeConfig>(key: K): FrozenChargeConfig[K] =>
    (frozen?.[key] ?? (live as Partial<FrozenChargeConfig> | null)?.[key] ?? DEFAULT_FROZEN_CHARGE_CONFIG[key]) as FrozenChargeConfig[K];

  let extraHourRate: Decimal | null = null;
  const vehicle = booking.items[0]?.vehicle;
  if (vehicle?.customPricing?.enabled) {
    extraHourRate = new Decimal(vehicle.customPricing.extraHourRate.toString());
  } else if (vehicle) {
    const defaults = await db.branchPricingDefaults.findUnique({
      where: { branchId_categoryId: { branchId: booking.branchId, categoryId: vehicle.categoryId } },
      select: { extraHourRate: true },
    });
    if (defaults) extraHourRate = new Decimal(defaults.extraHourRate.toString());
  }

  return {
    extraTimeEnabled: Boolean(pick("extraTimeEnabled")),
    gracePolicyEnabled: Boolean(pick("gracePolicyEnabled")),
    graceType: pick("graceType"),
    graceMinutes: Math.max(0, Number(pick("graceMinutes")) || 0),
    extraHourRate,
  };
}

/**
 * Pure late-return maths. `applyGrace` only matters for MANUAL grace; `waive`
 * drops a charge that would otherwise be billed (the caller records the reason).
 */
export function calculateLateReturnCharge(
  dueAt: Date,
  returnedAt: Date,
  policy: LateReturnPolicy,
  opts: { applyGrace?: boolean; waive?: boolean } = {},
): LateReturnCharge {
  const lateMinutes = Math.max(0, Math.floor((returnedAt.getTime() - dueAt.getTime()) / 60_000));
  const graceApplied =
    lateMinutes > 0 &&
    policy.gracePolicyEnabled &&
    policy.graceMinutes > 0 &&
    (policy.graceType === "AUTOMATIC" || opts.applyGrace === true);
  const chargeableMinutes = Math.max(0, lateMinutes - (graceApplied ? policy.graceMinutes : 0));
  const hours = Math.ceil(chargeableMinutes / 60);
  const fullAmount = policy.extraHourRate
    ? policy.extraHourRate.mul(hours).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);

  let status: LateReturnStatus;
  if (lateMinutes === 0) status = "ON_TIME";
  else if (chargeableMinutes === 0) status = "WITHIN_GRACE";
  else if (!policy.extraTimeEnabled) status = "DISABLED";
  else if (opts.waive) status = "WAIVED";
  else if (policy.extraHourRate == null) status = "RATE_UNAVAILABLE";
  else status = "CHARGED";

  return {
    dueAt,
    returnedAt,
    lateMinutes,
    graceMinutes: policy.graceMinutes,
    graceApplied,
    chargeableMinutes,
    hours,
    rate: policy.extraHourRate,
    amount: status === "CHARGED" ? fullAmount : new Decimal(0),
    waivedAmount: status === "WAIVED" ? fullAmount : new Decimal(0),
    status,
    extraTimeEnabled: policy.extraTimeEnabled,
    gracePolicyEnabled: policy.gracePolicyEnabled,
    graceType: policy.graceType,
  };
}

/** Ledger / charge line label, e.g. "Late return: 3 hr × ₹100/hr (due 01 Oct, 06:05 pm)". */
export function lateReturnLabel(charge: LateReturnCharge): string {
  const due = charge.dueAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `Late return: ${charge.hours} hr × ₹${(charge.rate ?? new Decimal(0)).toFixed(2)}/hr (due ${due})`;
}

/** JSON shape sent to clients and stored in RETURN session metadata (Decimals as strings). */
export function serializeLateReturn(
  charge: LateReturnCharge,
  gst?: { cgst: Decimal; sgst: Decimal; gst: Decimal; rate: Decimal } | null,
  waiver?: { reason: string } | null,
) {
  const gstAmount = gst?.gst ?? new Decimal(0);
  return {
    dueAt: charge.dueAt.toISOString(),
    returnedAt: charge.returnedAt.toISOString(),
    lateMinutes: charge.lateMinutes,
    graceMinutes: charge.graceMinutes,
    graceApplied: charge.graceApplied,
    gracePolicyEnabled: charge.gracePolicyEnabled,
    graceType: charge.graceType,
    extraTimeEnabled: charge.extraTimeEnabled,
    chargeableMinutes: charge.chargeableMinutes,
    hours: charge.hours,
    rate: charge.rate ? charge.rate.toFixed(2) : null,
    status: charge.status,
    taxable: charge.amount.toFixed(2),
    cgst: (gst?.cgst ?? new Decimal(0)).toFixed(2),
    sgst: (gst?.sgst ?? new Decimal(0)).toFixed(2),
    gst: gstAmount.toFixed(2),
    gstRate: gst ? gst.rate.toFixed(2) : null,
    total: charge.amount.plus(gstAmount).toFixed(2),
    waived: charge.status === "WAIVED",
    waivedAmount: charge.waivedAmount.toFixed(2),
    waiverReason: charge.status === "WAIVED" ? waiver?.reason ?? null : null,
  };
}

export type SerializedLateReturn = ReturnType<typeof serializeLateReturn>;
