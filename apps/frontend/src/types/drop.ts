/**
 * Drop / return shapes the server sends (D5): rental timeline, late return,
 * odometer segments across mid-rental swaps, vehicle-swap charges and the drop
 * bill with GST. Money is a 2-dp string; minutes are whole numbers; dates are ISO.
 */

import type { ExtensionFreeKm } from "@/services/extension.service";

/** ON_TIME · WITHIN_GRACE · UNDER_ONE_HOUR · CHARGED · WAIVED · DISABLED · RATE_UNAVAILABLE */
export type LateReturnStatus =
  | "ON_TIME"
  | "WITHIN_GRACE"
  /** Late past any grace by less than one whole hour — whole hours only, nothing billed. */
  | "UNDER_ONE_HOUR"
  | "CHARGED"
  | "WAIVED"
  | "DISABLED"
  | "RATE_UNAVAILABLE";

export type GraceType = "AUTOMATIC" | "MANUAL";

/** Late charge as it would be (or was) billed — GST added at the branch rate. */
export interface LateChargePreview {
  hours: number;
  /** Extra-hour rate; null when the vehicle has none. */
  rate: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  gst: string;
  /** null when nothing is billed or the branch has no GST rule. */
  gstRate: string | null;
  total: string;
  status: LateReturnStatus;
  graceApplied: boolean;
  /** "GST_RULE_MISSING" when the branch has no GST rule (the compute will refuse). */
  gstUnavailableReason?: string | null;
}

/** One formal extension that is part of the booked window. */
export interface RentalTimelineExtension {
  publicId: string;
  oldEndAt: string;
  newEndAt: string;
  minutes: number;
  status: "CONFIRMED" | "PAYMENT_COLLECTED" | "PENDING_PAYMENT";
  /** Committed but not paid yet (blocks the drop bill). */
  unpaid: boolean;
  /** Cash taken; the branch manager hasn't confirmed it yet (blocks the drop bill). */
  awaitingConfirmation: boolean;
  /** Partial extension (the full request couldn't be granted). */
  isPartial: boolean;
  trigger: string;
  /** GST-inclusive. */
  additionalAmount: string;
  taxAmount: string;
  /** Free km this extension adds to the allowance (#7); null when unknown, absent from older servers. */
  freeKm?: ExtensionFreeKm | null;
}

/** GET /employee/return/:id `rentalTimeline` (also on the drop-bill compute / GET). */
export interface RentalTimeline {
  startAt: string;
  originalEndAt: string;
  currentEndAt: string;
  originalMinutes: number;
  extendedMinutes: number;
  totalMinutes: number;
  extensionCount: number;
  extensions: RentalTimelineExtension[];
  /** Σ free km the extensions add (0 with none); null when the vehicle's free km are unknown. */
  extensionFreeKmTotal?: number | null;
  /** As-of time of the late figures (frozen return time on an open bill, else now); null before pickup. */
  returnedAt: string | null;
  lateMinutes: number;
  /** Policy grace (whether or not applied). */
  graceMinutes: number;
  graceType: GraceType | null;
  gracePolicyEnabled: boolean;
  graceApplied: boolean;
  extraTimeEnabled: boolean;
  /** totalMinutes + lateMinutes */
  totalWithLateMinutes: number;
  /** null unless PICKED_UP. When a bill is computed it IS the billed late line. */
  lateChargePreview: LateChargePreview | null;
  /** MANUAL grace, late and not yet billed: what "Apply grace" would bill. */
  lateChargePreviewWithGrace: LateChargePreview | null;
}

/** `late` on the drop-bill compute / GET and the legacy CompleteReturn response. */
export interface ReturnLateSummary {
  dueAt: string;
  returnedAt: string;
  lateMinutes: number;
  graceMinutes: number;
  graceApplied: boolean;
  gracePolicyEnabled: boolean;
  graceType: GraceType;
  extraTimeEnabled: boolean;
  chargeableMinutes: number;
  hours: number;
  rate: string | null;
  status: LateReturnStatus;
  taxable: string;
  cgst: string;
  sgst: string;
  gst: string;
  gstRate: string | null;
  total: string;
  waived: boolean;
  waivedAmount: string;
  waiverReason: string | null;
}

export interface OdometerSegment {
  /** Swap that ended this segment (null = the vehicle handed back now). */
  endedBySwapPublicId: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  /** null when a reading is missing */
  km: number | null;
  /** The swap that ended it (absent on older servers) */
  swappedAt?: string | null;
  /** The car handed back at the swap */
  vehicleRegNo?: string | null;
  /** The replacement and its start reading at the swap */
  replacementRegNo?: string | null;
  replacementStartOdometer?: number | null;
  /** This car's km recorded at the swap, by the drop's rule (null = not recorded) */
  recorded?: SwapKmRecorded | null;
  /** On a computed drop bill: this car's line of the one extra-km charge */
  billed?: SegmentKmBilled | null;
}

/** The returning car's km recorded at a mid-rental swap (money as 2-dp strings). */
export interface SwapKmRecorded {
  kmDriven: number;
  includedKm: number | null;
  /** Free km left for this car's segment */
  allowanceKm: number | null;
  extraKm: number | null;
  extraKmRate: string | null;
  extraKmCharge: string | null;
  extraKmEnabled: boolean | null;
}

/** A car's share of the drop bill's extra-km charge (they add up to the bill's line). */
export interface SegmentKmBilled {
  allowanceKm: number;
  extraKm: number;
  extraKmCharge: string;
}

/** The car handed back at the drop, after mid-rental swaps with readings. */
export interface CurrentKmSegment {
  startOdometer: number | null;
  endOdometer: number;
  km: number;
  billed: SegmentKmBilled | null;
}

/** GET /employee/return/:id `kmSegments` (null unless PICKED_UP). */
export interface KmSegments {
  swapCount: number;
  swapsMissingReadings: number;
  /** Every mid-rental swap has readings, so km can be measured. */
  complete: boolean;
  /** km on vehicles already handed back. */
  priorKm: number;
  /** The drop end odometer must be ≥ this (when complete). */
  currentStartOdometer: number | null;
  segments: OdometerSegment[];
}

/** A vehicle-swap difference that is billed on the drop bill (session branches). */
export interface SwapChargePreview {
  swapPublicId: string;
  swappedAt: string;
  label: string;
  taxable: string;
  /** null when the branch has no GST rule */
  cgst: string | null;
  sgst: string | null;
  gst: string | null;
  total: string | null;
  gstUnavailableReason: string | null;
}

export interface DropBillLine {
  type: string;
  label: string;
  referenceType: string;
  referenceId: string | null;
  taxable: boolean;
  /** Taxable value for a taxable line, the full amount otherwise. */
  amount: string;
  cgst: string;
  sgst: string;
  gst: string;
  total: string;
}

export interface DropBillGstRates {
  cgstRate: number;
  sgstRate: number;
  rate: number;
}

/** `bill` on the drop-bill compute / GET (null for sessions computed before GST on drop lines). */
export interface DropBill {
  /** null when no line is taxable */
  gstRates: DropBillGstRates | null;
  lines: DropBillLine[];
  /** Σ line amounts, before discount and GST */
  subtotal: string;
  taxableTotal: string;
  nonTaxableTotal: string;
  discount: {
    amount: string;
    taxableShare: string;
    nonTaxableShare: string;
    cgst: string;
    sgst: string;
    gst: string;
  } | null;
  taxableValue: string;
  nonTaxableValue: string;
  cgst: string;
  sgst: string;
  gst: string;
  /** taxableValue + gst + nonTaxableValue (before the safety-deposit credit) */
  total: string;
}

/** Legacy CompleteReturn `returnCharges` — collected later by the branch manager. */
export interface LegacyReturnCharges {
  collectedBy: "BRANCH_MANAGER";
  gstRates: DropBillGstRates | null;
  lines: {
    type: "EXTRA_KM" | "EXTRA_TIME" | "VEHICLE_SWAP" | "FASTAG";
    label: string;
    /** VEHICLE_SWAP: the swap's publicId (absent on older servers) */
    referenceId?: string | null;
    taxable: boolean;
    amount: string;
    cgst: string;
    sgst: string;
    gst: string;
    total: string;
  }[];
  total: string;
}

/**
 * FASTag balances (Oct 15 2026): read at pickup, at mid-rental swaps and at
 * the drop for cars with a FASTag; the usage in between is the drop bill's
 * FASTag line (no GST). `fastag` on the return details — absent on older servers.
 *  - READINGS  every reading so far is there: the server works the charge out
 *              (staff enter the balance now when the car coming back has a FASTag)
 *  - MANUAL    a reading is missing (older booking / app build): the typed charge
 *  - NONE      no car on the booking has a FASTag
 */
export interface FastagBeforeDrop {
  mode: "READINGS" | "MANUAL" | "NONE";
  currentHasFastag: boolean;
  /** Balance when the customer got the car coming back (pickup, or the last swap). */
  currentStartBalance: string | null;
  /** Usage on the cars already handed back at swaps. */
  priorUsage: string;
  priorRecharged: boolean;
  swapCount: number;
}

/** `fastag` on the drop-bill compute / GET and the legacy complete response. */
export interface FastagUsageSummary {
  /** COMPUTED: billed from the balances · READINGS_MISSING: the typed charge was used */
  status: "COMPUTED" | "READINGS_MISSING" | "NO_FASTAG";
  amount: string;
  /** e.g. "FASTag usage: ₹480 → ₹215" (COMPUTED only) */
  label: string | null;
  recharged: boolean;
  notes: string[];
  legs: {
    regNo: string | null;
    hasFastag: boolean;
    startBalance: string | null;
    endBalance: string | null;
    endedBySwapPublicId: string | null;
    usage: string | null;
    recharged: boolean;
  }[];
  pickupBalance?: string | null;
  returnBalance?: string | null;
}
