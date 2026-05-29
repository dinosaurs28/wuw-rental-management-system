import Decimal from "decimal.js";
import type { ChargeType, GraceType } from "@repo/database/client";

// ── Frozen charge config ──────────────────────────────────────────────────────

/**
 * Immutable snapshot of BranchChargeConfig stored on each booking at creation.
 * Mirrors BranchChargeConfig fields exactly so no DB join is needed at runtime.
 */
export interface FrozenChargeConfig {
  extraKmEnabled: boolean;
  extraTimeEnabled: boolean;
  fuelModuleEnabled: boolean;
  fastagModuleEnabled: boolean;
  gracePolicyEnabled: boolean;
  damageModuleEnabled: boolean;
  graceType: GraceType;
  graceMinutes: number;
  employeeOverrideEnabled: boolean;
  maxOverridePercent: number | null;
  overrideRequiresApproval: boolean;
  overrideApprovalThreshold: number | null;
  safetyDepositEnabled: boolean;
  safetyDepositRequiresApproval: boolean;
}

export const DEFAULT_FROZEN_CHARGE_CONFIG: FrozenChargeConfig = {
  extraKmEnabled: true,
  extraTimeEnabled: true,
  fuelModuleEnabled: false,
  fastagModuleEnabled: false,
  gracePolicyEnabled: false,
  damageModuleEnabled: true,
  graceType: "AUTOMATIC",
  graceMinutes: 15,
  employeeOverrideEnabled: false,
  maxOverridePercent: null,
  overrideRequiresApproval: false,
  overrideApprovalThreshold: null,
  safetyDepositEnabled: false,
  safetyDepositRequiresApproval: true,
};

// ── Charge computation inputs ─────────────────────────────────────────────────

/** Vehicle pricing snapshot used by the engine — avoids repeated DB lookups. */
export interface VehiclePricingSnapshot {
  vehicleId: number;
  hasFastag: boolean;
  fastagNumber: string | null;
  extraKmRate: Decimal;
  extraHourRate: Decimal;
  freeKmLimit: number;
}

/** All input data required to run a full charge computation for a booking. */
export interface ChargeContext {
  // Booking identifiers (internal IDs for DB, publicId for logs/responses)
  bookingId: number;
  bookingPublicId: string;
  branchId: number;

  // Frozen config (snapshot stored on booking — not live branch config)
  frozenConfig: FrozenChargeConfig;

  // Vehicle pricing
  vehiclePricing: VehiclePricingSnapshot;

  // Base pricing (already computed by booking creation / pricing engine)
  baseAmount: Decimal;

  // Time metrics
  startAt: Date;
  endAt: Date;           // planned end
  actualReturnAt: Date;  // actual return time (set at return)
  actualHours: number;   // computed: actual hours of rental
  billableHours: number; // computed: hours the plan charges for

  // Distance metrics
  startOdometer: number;
  endOdometer: number;
  totalKmDriven: number; // endOdometer - startOdometer

  // Grace module input (only relevant when graceType = MANUAL)
  applyGrace?: boolean;

  // Fuel module input (only relevant when fuelModuleEnabled = true)
  pickupFuelLevel?: string;
  returnFuelLevel?: string;
  fuelDeficitCharge?: Decimal;  // employee-entered custom charge
  fuelSkipReason?: string;      // mandatory if deficit but charge skipped

  // Fastag module input
  fastagAmount?: Decimal;
  fastagNotes?: string;

  // Actor performing return (for persisting ChargeEntry records)
  actorId: number;
}

// ── Module output ─────────────────────────────────────────────────────────────

/** Output of a single charge module. Zero-amount entries are still included. */
export interface ChargeResult {
  chargeType: ChargeType;
  moduleKey: string;   // stable key used as upsert key per booking
  label: string;       // human-readable label for invoice line items
  originalAmount: Decimal;
  finalAmount: Decimal;
  quantity?: Decimal;  // e.g. excess km, extra hours
  unitRate?: Decimal;  // e.g. rate per extra km / hour
  isOverridden?: boolean;
  notes?: string;
  skip?: boolean;      // when true, engine does not persist a ChargeEntry
}

// ── Engine output ─────────────────────────────────────────────────────────────

/** Full charge breakdown returned by ChargeEngineService.computeCharges(). */
export interface ChargeBreakdown {
  bookingId: number;
  results: ChargeResult[];

  // Aggregates
  subtotal: Decimal;     // sum of originalAmount across all non-skipped results
  waivedTotal: Decimal;  // sum of (originalAmount - finalAmount) for overridden entries
  finalTotal: Decimal;   // sum of finalAmount across all non-skipped results
}

// ── Settlement ────────────────────────────────────────────────────────────────

export type SettlementOutcomeType =
  | "FULL_REFUND"
  | "PARTIAL_REFUND"
  | "ADDITIONAL_PAYMENT_REQUIRED"
  | "BALANCED";

/** Result of the settlement computation — feeds into payment collection. */
export interface SettlementOutcome {
  outcomeType: SettlementOutcomeType;
  totalCharges: Decimal;    // finalTotal from ChargeBreakdown
  depositPaid: Decimal;     // totalDeposit + safetyDeposit collected so far
  amountDue: Decimal;       // > 0 means customer owes more
  refundAmount: Decimal;    // > 0 means customer gets money back
  breakdown: ChargeBreakdown;
}

// ── Module interface ──────────────────────────────────────────────────────────

/** Contract every charge module plug-in must implement. */
export interface ChargeModuleInterface {
  /**
   * Returns true if this module should participate in the current computation.
   * Must be pure — no side effects, no DB calls.
   */
  isApplicable(context: ChargeContext): boolean;

  /**
   * Compute the charge for this module.
   * May be async for modules that need DB lookups (e.g. DamageModule).
   */
  compute(context: ChargeContext): Promise<ChargeResult>;
}
