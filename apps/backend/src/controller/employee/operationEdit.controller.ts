/**
 * Completed pickups / returns (client item 1, Oct 2026): a read-only summary,
 * and Edit Pickup / Edit Return — the full pickup / drop flow, editable, money
 * included ("Full Pickup and Drop Flow should be editable").
 *
 * Endpoints (own branch only):
 *   GET   /employee/pickup/:bookingId/summary        (+ pending / settled edit differences)
 *   GET   /employee/return/:bookingId/summary        (+ editState: what the drop recorded)
 *   POST  /employee/pickup/:bookingId/edit/preview   the money difference — nothing saved
 *   POST  /employee/return/:bookingId/edit/preview   the edited drop bill and its difference
 *   PATCH /employee/pickup/:bookingId   odometer, fuel, FASTag balance, safety deposit, DL status, DL number, photos
 *   PATCH /employee/return/:bookingId   readings, fuel / FASTag / other charges, drop discount, late grace /
 *                                       waiver, damage amounts / notes / photos, deposit handling, photos
 *
 * A pickup / return counts as completed once it is done or sent to the branch
 * manager (utils/booking/completedQueue.ts). Edits run with the booking row
 * locked (like the drop bill and its payments) and write an audit entry and a
 * staff-activity entry with the before / after of every changed field and the
 * money difference.
 *
 * Money: the operation's bill is worked out again with the edited inputs
 * (services/booking/drop-edit.service.ts — the same billing helpers as the
 * drop; km at the free km / rate the drop billed with) and compared line by line
 * with what is billed now. The difference goes on an ADJUSTMENT session
 * (services/booking/operation-edit-money.service.ts) settled with the usual
 * record-payment / record-refund endpoints; a legacy drop's return charges are
 * rewritten for the branch manager's Settlements. Past payments and ledger
 * lines are never changed. A pickup edit that corrects readings the completed
 * drop billed from (odometer, FASTag balance) re-prices the drop in the same
 * step. Rent (coupons, extensions) is not re-priced here. The pickup FASTag
 * balance is accepted for any car; the drop's only for a car that counts as a
 * FASTag car for the booking (marked, or read at pickup / the swap); swap
 * readings (VehicleSwap) are not edited here.
 * A money-moving save needs the previewed difference (expectedDelta) and
 * replaces an earlier edit's unsettled difference; a lower bill comes off the
 * booking's counter credit before anything is refunded. The preview is worked
 * out exactly as the save (same lock and steps) and rolled back.
 *
 * Photos taken off a completed pickup / return are only unlinked from the
 * booking — the file is kept as evidence (the audit entry names it). New photos
 * must be this branch's own unused uploads of the right kind; ones staff took
 * during an edit and then dropped are deleted by the app.
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  Prisma,
  BookingPhotoType,
  BookingStatus,
  ChargeType,
  DamageReportStatus,
  LedgerEntryClassification,
  LedgerEntryType,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import { DL_STATUS_DEPOSIT_REMOVED_MESSAGE, SAFETY_DEPOSIT_HANDLING } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { isPrivateFile, resolveFileUrl } from "../../utils/file-url.js";
import { bookingListTypeOf } from "../../utils/booking/bookingTypeFilter.js";
import {
  pickupQueueState,
  returnQueueState,
  type QueueItemState,
} from "../../utils/booking/completedQueue.js";
import {
  completionMarkerSelect,
  loadCompletionInfo,
  serializeCompletion,
} from "../../services/booking/operation-completion.service.js";
import {
  changedFields,
  emptiedRequiredSlots,
  photosEmptied,
  pickupOdometerProblem,
} from "../../services/booking/operation-edit-guard.js";
import {
  depositAdjustmentLine,
  serializeDeltaLine,
  type AdjustmentDeltaLine,
  type AdjustmentPart,
} from "../../services/booking/operation-adjustment.js";
import {
  AdjustmentChangedError,
  AdjustmentPaymentStartedError,
  AdjustmentPendingError,
  EditConfirmationRequiredError,
  abandonSuperseded,
  assertExpectedDelta,
  createAdjustmentSession,
  creditOffsetLine,
  findPendingAdjustment,
  linkSuperseded,
  pendingToSupersede,
  serializeAdjustmentPlan,
  type AdjustmentPlan,
  type SupersededAdjustment,
} from "../../services/booking/operation-edit-money.service.js";
import { computeBookingOwed } from "../../services/payment/booking-owed.service.js";
import {
  DropEditError,
  changedDropCategories,
  computeDropEdit,
  loadDropEditState,
  serializeDropInputs,
  writeLegacyDropRows,
  type DropEditInputs,
  type DropEditResult,
  type DropEditState,
  type DropFlow,
} from "../../services/booking/drop-edit.service.js";
import { getOdometerSegments } from "../../services/charges/km-allowance.service.js";
import { LEGACY_RETURN_CHARGE_TYPES } from "../../services/charges/legacy-return-charges.service.js";
import { calculateFastagUsage, fastagBalanceField } from "../../services/charges/fastag-usage.js";
import { recordDepositHandling } from "../../services/payment/safety-deposit.service.js";
import type { TxClient } from "../../services/payment/paymentSession.service.js";
import { getBookingCreditSummary } from "../../services/payment/customer-credit.service.js";
import { finalizeInvoice, syncLegacyReturnInvoice } from "../../services/invoice-finalization.service.js";
import { serializeSession } from "./paymentSession.controller.js";
import { getFastagLegs } from "../../services/charges/fastag-usage.service.js";
import { dropDamageAmount, isDropDamage, lockBookingForDrop } from "../../services/damage/drop-damage.service.js";
import { uploadedFromBranch } from "../../services/booking-photo-file.service.js";
import {
  STAFF_DL_EDITABLE_STATUSES,
  DlStatusError,
  dlStatusUpdateData,
  invalidateDlStatusListCaches,
} from "../../services/booking/dl-status.service.js";
import {
  parsePickupDlNumber,
  resolvePickupDlNumber,
  savePickupDlNumber,
  logPickupDlNumber,
  PickupDlNumberError,
  type PickupDlNumber,
} from "../../services/booking/pickup-dl-number.service.js";
import { assertDlFree, DlInUseError } from "../../services/booking/dl-in-use.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

// ── Request bodies ────────────────────────────────────────────────────────────

const FUEL_LEVEL = z.string().regex(/^([1-9]|10)$/, "Fuel level must be 1 to 10");
const fileIdList = (max: number) => z.array(z.string().trim().min(1)).max(max);

const editPickupSchema = z.object({
  odo: z.coerce
    .number()
    .int("The odometer reading must be a whole number")
    .min(1, "Enter the odometer reading")
    .optional(),
  pickupFuelLevel: FUEL_LEVEL.optional(),
  // ₹ on the pickup car's FASTag (any car; required by the clients when it's marked as having one)
  pickupFastagBalance: fastagBalanceField,
  // Licence custody (#3): Collected / Not collected (DEPOSIT was removed)
  dlStatus: z.string().optional(),
  // Customer's DL number (X2) — raw input, validated like the pickup's
  drivingLicenceNumber: z.string().optional(),
  // New photos, uploaded first via POST /employee/pickup/upload; label = capture slot
  addPhotos: z
    .array(z.object({ fileId: z.string().trim().min(1), label: z.string().trim().min(1).max(80).nullish() }))
    .max(40)
    .optional(),
  // FileObject publicIds of saved photos to take off the pickup
  removeFileIds: fileIdList(60).optional(),
  // New safety deposit total (car still out, nothing recorded at the drop yet)
  safetyDeposit: z.coerce.number().min(0, "The deposit can't be negative").max(1_000_000).optional(),
  // The money difference the screen showed (preview) — 409 EDIT_DELTA_CHANGED when it moved
  expectedDelta: z.coerce.number().optional(),
});

const editReturnSchema = z.object({
  endOdometer: z.coerce
    .number()
    .int("End odometer must be a whole number")
    .min(0, "End odometer can't be negative")
    .optional(),
  returnFuelLevel: FUEL_LEVEL.optional(),
  // ₹ on the returned car's FASTag at the drop (a car that counts as a FASTag car for the booking)
  returnFastagBalance: fastagBalanceField,
  // New photos, uploaded first via POST /employee/return/upload
  addPhotos: z.array(z.object({ fileId: z.string().trim().min(1) })).max(40).optional(),
  removeFileIds: fileIdList(60).optional(),
  // Damage recorded at the drop: what it says and its photos (never its amount or who pays)
  damages: z
    .array(
      z.object({
        publicId: z.string().trim().min(1),
        area: z.string().trim().min(1, "Enter the damaged area").max(120).optional(),
        description: z.string().trim().min(3, "Describe the damage (at least 3 characters)").max(1000).optional(),
        severity: z.enum(["Minor", "Moderate", "Severe"], { error: "Choose the damage severity" }).optional(),
        // New damage photos, uploaded first via POST /employee/damage/upload
        addPhotoIds: fileIdList(20).optional(),
        removeFileIds: fileIdList(20).optional(),
        // What the customer pays for it (damage charged at drop, unreviewed)
        amount: z.coerce.number().min(0, "Damage cost can't be negative").max(10_000_000).optional(),
      }),
    )
    .max(20)
    .optional(),
  // ── Drop bill inputs (absent = as recorded) ──
  // Extra km typed after a swap recorded without readings
  manualExtraKm: z.coerce.number().int("Extra km must be a whole number").min(0).max(100000).nullable().optional(),
  // Fuel line (₹; 0 = none)
  fuelCharge: z.coerce.number().min(0, "Fuel charge can't be negative").max(1_000_000).optional(),
  // Typed FASTag charge when the balances can't measure the usage (₹; 0 = none)
  fastagAmount: z.coerce.number().min(0, "FASTag charge can't be negative").max(1_000_000).optional(),
  fastagNotes: z.string().trim().max(200).nullable().optional(),
  otherCharges: z
    .array(z.object({ label: z.string().trim().min(1, "Name the charge").max(120), amount: z.coerce.number().min(0).max(1_000_000) }))
    .max(20)
    .optional(),
  // Drop discount (null removes it)
  discount: z
    .object({
      amount: z.coerce.number().positive("Discount must be more than ₹0"),
      reason: z.string().trim().min(3, "Give a reason for the discount (at least 3 characters)"),
    })
    .nullable()
    .optional(),
  applyGrace: z.boolean().optional(),
  // Late charge waived with a reason (null removes the waiver)
  waiveLateCharge: z
    .object({ reason: z.string().trim().min(3, "Give a reason for waiving the late charge (at least 3 characters)") })
    .nullable()
    .optional(),
  safetyDepositHandling: z.enum(SAFETY_DEPOSIT_HANDLING).optional(),
  // The money difference the screen showed (preview) — 409 EDIT_DELTA_CHANGED when it moved
  expectedDelta: z.coerce.number().optional(),
});

/** A refusal raised while editing (mapped to its HTTP response). */
class EditRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "EditRejection";
  }
}

const NOT_COMPLETED = {
  PICKUP: {
    code: "PICKUP_NOT_COMPLETED",
    message: "This pickup isn't completed yet — finish it from the pickup screen.",
  },
  RETURN: {
    code: "RETURN_NOT_COMPLETED",
    message: "This return isn't completed yet — finish it from the return screen.",
  },
} as const;

const isDone = (state: QueueItemState | null) => state === "COMPLETED" || state === "AWAITING_MANAGER";

function validationBody(error: z.ZodError) {
  const issue = error.issues[0];
  return {
    code: "VALIDATION_FAILED",
    message: issue?.message ?? "Check the details and try again.",
    field: issue?.path.join(".") || null,
    errors: error.format(),
  };
}

function sendError(res: Response, error: unknown, where: string) {
  if (error instanceof EditRejection) return res.status(error.status).json(error.body);
  if (error instanceof DlStatusError) return res.status(error.status).json(error.toJSON());
  if (error instanceof PickupDlNumberError) return res.status(error.status).json(error.toJSON());
  if (error instanceof DlInUseError) return res.status(error.status).json(error.toJSON("staff"));
  console.error(`${where} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Something went wrong. Please try again." });
}

async function resolveActor(req: Request) {
  return prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
}

// ── Shared reads ──────────────────────────────────────────────────────────────

const summaryBookingSelect = {
  ...completionMarkerSelect,
  endAt: true,
  totalFinal: true,
  days: true,
  rentalPeriodType: true,
  customerId: true,
  branchId: true,
  startOdometer: true,
  endOdometer: true,
  totalKmDriven: true,
  freeKmLimit: true,
  extraKmCharged: true,
  safetyDeposit: true,
  dlStatus: true,
  dlDepositNote: true,
  pickupFastagBalance: true,
  returnFastagBalance: true,
  frozenChargeConfig: true,
  fuelRecord: {
    select: {
      pickupFuelLevel: true,
      returnFuelLevel: true,
      pickupAt: true,
      returnAt: true,
      capturedByPickup: { select: { name: true } },
      capturedByReturn: { select: { name: true } },
    },
  },
  customer: {
    select: {
      drivingLicenceNumber: true,
      user: { select: { name: true, phone: true } },
    },
  },
  items: {
    orderBy: { id: "asc" as const },
    select: {
      vehicle: {
        select: { id: true, publicId: true, make: true, model: true, regNo: true, categoryId: true, odo: true },
      },
    },
  },
  branch: { select: { chargeConfig: { select: { usePaymentSessions: true } } } },
} satisfies Prisma.BookingSelect;

type SummaryBooking = Prisma.BookingGetPayload<{ select: typeof summaryBookingSelect }>;

function loadBooking(publicId: string, branchId: number) {
  return prisma.booking.findFirst({ where: { publicId, branchId }, select: summaryBookingSelect });
}

/** Configured capture slots ("Front", "Odometer" …) for the booking's (first) vehicle. */
async function captureFieldsFor(branchId: number, categoryId: number | null | undefined) {
  if (!categoryId) return [] as Array<{ name: string; required: boolean }>;
  const config = await prisma.vehiclePhotoCaptureConfig.findUnique({
    where: { branchId_categoryId: { branchId, categoryId } },
    select: { fields: true },
  });
  const fields = Array.isArray(config?.fields) ? (config!.fields as unknown[]) : [];
  return fields
    .filter((f): f is { name: string; required?: boolean } => !!f && typeof (f as any).name === "string")
    .map((f) => ({ name: f.name, required: f.required === true }));
}

async function photosOf(bookingId: number, type: BookingPhotoType) {
  const photos = await prisma.bookingPhoto.findMany({
    where: { bookingId, type },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      publicId: true,
      captureLabel: true,
      createdAt: true,
      file: { select: { id: true, publicId: true, key: true, url: true, mime: true } },
    },
  });
  return photos;
}

async function serializePhotos(photos: Awaited<ReturnType<typeof photosOf>>) {
  return Promise.all(
    photos.map(async (p) => ({
      publicId: p.publicId,
      // What clients keep and send back in removeFileIds
      fileId: p.file.publicId,
      url: await resolveFileUrl(p.file),
      label: p.captureLabel ?? null,
      createdAt: p.createdAt,
    })),
  );
}

/** Lines of the settled pickup / drop bill (signed: charges +, discounts / payments −). */
async function sessionBill(bookingId: number, sessionType: PaymentSessionType) {
  const session = await prisma.paymentSession.findFirst({
    where: { bookingId, sessionType, status: PaymentSessionStatus.COMPLETED },
    orderBy: { completedAt: "desc" },
    select: {
      netPayable: true,
      totalPaymentsRecorded: true,
      entries: {
        where: { isVoided: false },
        orderBy: { createdAt: "asc" },
        select: { classification: true, amount: true, description: true },
      },
    },
  });
  if (!session) return null;
  return {
    lines: session.entries.map((e) => ({
      label: e.description,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      kind:
        e.classification === LedgerEntryClassification.DISCOUNT
          ? "DISCOUNT"
          : e.classification === LedgerEntryClassification.PAYMENT
            ? "PAYMENT"
            : "CHARGE",
    })),
    netPayable: new Decimal(session.netPayable.toString()).toFixed(2),
  };
}

function bookingCore(booking: SummaryBooking) {
  return {
    publicId: booking.publicId,
    status: booking.status,
    startAt: booking.startAt,
    endAt: booking.endAt,
    returnedAt: booking.returnedAt,
    totalFinal: booking.totalFinal,
    days: booking.days,
    rentalPeriodType: booking.rentalPeriodType,
    bookingType: bookingListTypeOf(booking.rentalPeriodType),
    usePaymentSessions: booking.branch?.chargeConfig?.usePaymentSessions ?? false,
    awaitingManager: booking.requiresManagerConfirmation,
  };
}

function customerCore(booking: SummaryBooking) {
  return {
    name: booking.customer.user.name,
    phone: booking.customer.user.phone,
    drivingLicenceNumber: booking.customer.drivingLicenceNumber ?? null,
  };
}

const vehiclesOf = (booking: SummaryBooking) =>
  booking.items.map(({ vehicle }) => ({
    publicId: vehicle.publicId,
    make: vehicle.make,
    model: vehicle.model,
    regNo: vehicle.regNo,
  }));

/**
 * Edits that moved money: the difference still to settle (pendingAdjustment —
 * settle it with record-payment / record-refund on its session) and the ones
 * settled (adjustments).
 */
async function adjustmentsOf(bookingId: number) {
  const sessions = await prisma.paymentSession.findMany({
    where: { bookingId, sessionType: PaymentSessionType.ADJUSTMENT, status: { not: PaymentSessionStatus.ABANDONED } },
    orderBy: { createdAt: "asc" },
    include: { entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } } },
  });
  const describe = (s: (typeof sessions)[number]) => {
    const meta = ((s.metadata ?? {}) as { adjustment?: { operation?: string; lines?: Array<{ delta: string }> } }).adjustment;
    return {
      session: serializeSession(s),
      operation: meta?.operation ?? null,
      lines: (meta?.lines ?? []).filter((l) => !new Decimal(l.delta).isZero()),
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    };
  };
  const pending = sessions.find((s) => s.status !== PaymentSessionStatus.COMPLETED);
  return {
    pendingAdjustment: pending ? describe(pending) : null,
    adjustments: sessions.filter((s) => s.status === PaymentSessionStatus.COMPLETED).map(describe),
  };
}

// ── Summaries ─────────────────────────────────────────────────────────────────

async function buildPickupSummary(booking: SummaryBooking, branchId: number) {
  const state = pickupQueueState(booking);
  const completion = isDone(state) ? (await loadCompletionInfo("PICKUP", [booking])).get(booking.id) : undefined;
  const [photos, captureFields, bill, fastagLegs, adjustments] = await Promise.all([
    photosOf(booking.id, BookingPhotoType.PRE_DELIVERY).then(serializePhotos),
    captureFieldsFor(branchId, booking.items[0]?.vehicle.categoryId),
    sessionBill(booking.id, PaymentSessionType.PICKUP),
    getFastagLegs(booking.id, money(booking.returnFastagBalance)),
    adjustmentsOf(booking.id),
  ]);
  const dlStatusEditable = STAFF_DL_EDITABLE_STATUSES.includes(booking.status);
  const returnDone = isDone(returnQueueState(booking));
  const depositConfig = (booking.frozenChargeConfig ?? {}) as { safetyDepositEnabled?: boolean };
  // The deposit is changed only while the car is out with nothing recorded at the drop
  const depositEditable =
    booking.status === BookingStatus.PICKED_UP &&
    !booking.requiresManagerConfirmation &&
    (!!depositConfig.safetyDepositEnabled || new Decimal(booking.safetyDeposit.toString()).gt(0));
  return {
    phase: "PICKUP" as const,
    state,
    completed: isDone(state) ? serializeCompletion(completion) : null,
    booking: bookingCore(booking),
    customer: customerCore(booking),
    vehicles: vehiclesOf(booking),
    odometer: booking.startOdometer,
    fuelLevel: booking.fuelRecord?.pickupFuelLevel ?? null,
    dl: { status: booking.dlStatus, depositNote: booking.dlDepositNote },
    // FASTag balance read at the handover — editable for any car; required when the
    // car is marked as having a FASTag (vehicleHasFastag). hasFastag: it counts as a
    // FASTag car for this booking (marked, or a balance recorded for it)
    fastag: {
      hasFastag: fastagLegs[0]?.hasFastag ?? false,
      vehicleHasFastag: fastagLegs[0]?.vehicleHasFastag ?? false,
      balance: money(booking.pickupFastagBalance)?.toFixed(2) ?? null,
    },
    safetyDeposit: new Decimal(booking.safetyDeposit.toString()).toFixed(2),
    photos,
    captureFields,
    bill,
    ...adjustments,
    edit: {
      allowed: isDone(state),
      // Kept false for the first edit release's screens: changes that move money are
      // now settled (collect / refund) instead of refused
      odometerCheckedAgainstCharges: false,
      fastagCheckedAgainstCharges: false,
      // Corrected pickup readings re-price the completed drop's km / FASTag
      readingsMoveDropCharges: returnDone,
      depositEditable,
      depositLockedReason: depositEditable
        ? null
        : returnDone
          ? "The deposit was settled at the drop. Edit the return to change what was charged or refunded."
          : null,
      dlStatusEditable,
      dlStatusLockedReason: dlStatusEditable
        ? null
        : "The DL status can't be changed after the return. Ask your branch manager to update it.",
    },
  };
}

async function buildReturnSummary(booking: SummaryBooking) {
  const state = returnQueueState(booking);
  const completion = isDone(state) ? (await loadCompletionInfo("RETURN", [booking])).get(booking.id) : undefined;
  const [segments, photos, damageRows, sessionLines, fastagLegs, adjustments, editState] = await Promise.all([
    getOdometerSegments(booking.id),
    photosOf(booking.id, BookingPhotoType.POST_RETURN).then(serializePhotos),
    prisma.damageReport.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      select: {
        publicId: true,
        severity: true,
        notes: true,
        status: true,
        estimatedCost: true,
        chargedAtDrop: true,
        photos: {
          where: { type: BookingPhotoType.DAMAGE },
          orderBy: { createdAt: "asc" },
          select: { file: { select: { publicId: true, key: true, url: true } } },
        },
      },
    }),
    sessionBill(booking.id, PaymentSessionType.RETURN),
    getFastagLegs(booking.id, money(booking.returnFastagBalance)),
    adjustmentsOf(booking.id),
    isDone(state) ? loadDropEditState(booking.id) : Promise.resolve(null),
  ]);
  const returnedLeg = fastagLegs[fastagLegs.length - 1];
  const fastagUsage = calculateFastagUsage(fastagLegs);

  // Branches without payment sessions: the drop's charges wait for the manager's settlement
  let bill: { settledBy: "DROP_BILL" | "BRANCH_MANAGER"; lines: Array<{ label: string; amount: string; kind: string }>; netPayable: string } | null =
    sessionLines ? { settledBy: "DROP_BILL", ...sessionLines } : null;
  if (!bill) {
    const entries = await prisma.chargeEntry.findMany({
      where: { bookingId: booking.id, chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
      orderBy: { createdAt: "asc" },
      select: { label: true, finalAmount: true, gstAmount: true },
    });
    if (entries.length > 0) {
      bill = {
        settledBy: "BRANCH_MANAGER",
        lines: entries.map((e) => ({
          label: e.label,
          amount: new Decimal(e.finalAmount.toString()).plus(e.gstAmount.toString()).toFixed(2),
          kind: "CHARGE",
        })),
        netPayable: entries
          .reduce((sum, e) => sum.plus(e.finalAmount.toString()).plus(e.gstAmount.toString()), new Decimal(0))
          .toFixed(2),
      };
    }
  }

  const damages = await Promise.all(
    damageRows
      .filter((d) => isDropDamage(d.notes))
      .map(async (d) => {
        const notes = (d.notes ?? {}) as Record<string, unknown>;
        return {
          publicId: d.publicId,
          area: String(notes.area ?? ""),
          severity: d.severity,
          description: String(notes.description ?? ""),
          amount: new Decimal(d.estimatedCost.toString()).toFixed(2),
          chargeCustomer: notes.chargeCustomer === true,
          billedAtDrop: d.chargedAtDrop,
          // Once the manager reviewed it, only they change it
          editable: d.status === DamageReportStatus.PENDING,
          photos: await Promise.all(
            d.photos.map(async (p) => ({ fileId: p.file.publicId, url: await resolveFileUrl(p.file) })),
          ),
        };
      }),
  );

  return {
    phase: "RETURN" as const,
    state,
    completed: isDone(state) ? serializeCompletion(completion) : null,
    booking: bookingCore(booking),
    customer: customerCore(booking),
    vehicles: vehiclesOf(booking),
    dl: { status: booking.dlStatus, depositNote: booking.dlDepositNote },
    odometer: {
      // Reading at the original pickup, and the start of the car handed back (after a swap)
      pickup: booking.startOdometer,
      start: segments.currentStartOdometer,
      end: booking.endOdometer,
      kmDriven: booking.totalKmDriven,
      freeKm: booking.freeKmLimit,
      extraKm: booking.extraKmCharged,
      swapCount: segments.swapCount,
      // false: a swap was recorded without readings, km can't be measured
      measured: segments.complete,
    },
    fuel: {
      pickup: segments.currentStartFuelLevel ?? booking.fuelRecord?.pickupFuelLevel ?? null,
      return: booking.fuelRecord?.returnFuelLevel ?? null,
    },
    // FASTag of the car handed back — for a car that counts as a FASTag car for this
    // booking (marked, or a balance recorded for it at pickup / the swap)
    fastag: {
      hasFastag: returnedLeg?.hasFastag ?? false,
      vehicleHasFastag: returnedLeg?.vehicleHasFastag ?? false,
      // its balance when the customer got it (pickup, or the swap's replacement reading)
      startBalance: returnedLeg?.startBalance?.toFixed(2) ?? null,
      balance: money(booking.returnFastagBalance)?.toFixed(2) ?? null,
      // worked out from the readings (null when a reading is missing: the charge was typed)
      usage: fastagUsage.status === "COMPUTED" ? fastagUsage.amount.toFixed(2) : null,
    },
    photos,
    damages,
    bill,
    ...adjustments,
    // What the drop recorded, as the edit screens prefill it (full edit, client item 1)
    editState: editState
      ? {
          flow: editState.flow,
          inputs: serializeDropInputs(editState.inputs),
          // The bill as charged now: the original plus earlier edits
          billedLines: editState.billedLines.map((l) => ({
            entryType: l.entryType,
            referenceType: l.referenceType,
            referenceId: l.referenceId,
            label: l.label,
            amount: l.amount.toFixed(2),
          })),
          damages: editState.damages.map((d) => ({
            publicId: d.publicId,
            label: d.label,
            amount: d.amount.toFixed(2),
            editable: d.editable,
          })),
        }
      : null,
    edit: {
      allowed: isDone(state),
      // The return fuel is kept with the pickup's fuel reading — none, nothing to edit
      fuelEditable: booking.fuelRecord != null,
    },
  };
}

// ── GET summaries ─────────────────────────────────────────────────────────────

export const GetPickupSummary = async (req: Request, res: Response) => {
  try {
    const booking = await loadBooking(req.params.bookingId!, req.branch_Id);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    return res.status(StatusCode.OK).json({
      message: "Pickup summary fetched",
      data: await buildPickupSummary(booking, req.branch_Id),
    });
  } catch (error) {
    return sendError(res, error, "GetPickupSummary");
  }
};

export const GetReturnSummary = async (req: Request, res: Response) => {
  try {
    const booking = await loadBooking(req.params.bookingId!, req.branch_Id);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    return res.status(StatusCode.OK).json({
      message: "Return summary fetched",
      data: await buildReturnSummary(booking),
    });
  } catch (error) {
    return sendError(res, error, "GetReturnSummary");
  }
};

// ── Shared edit steps ─────────────────────────────────────────────────────────

/** Upload key prefix of each kind of booking photo (pickupAction / returnAction / damage upload). */
type PhotoKind = "pickup/" | "returns/" | "damage/";

/**
 * Validates new photos (FileObject publicIds): each must be a public upload of
 * that kind (key prefix), from this branch (or before uploads recorded one),
 * not saved with any booking and not kept in a paused pickup / drop — same
 * rules as the swap photos. Returns the files by publicId.
 */
async function resolveNewFiles(
  fileIds: string[],
  kind: PhotoKind,
  branchId: number,
): Promise<Map<string, { id: number; url: string; key: string }>> {
  const map = new Map<string, { id: number; url: string; key: string }>();
  if (fileIds.length === 0) return map;
  const files = await prisma.fileObject.findMany({
    where: { publicId: { in: fileIds } },
    select: {
      id: true,
      publicId: true,
      url: true,
      key: true,
      uploadedBranchId: true,
      _count: { select: { bookingPhotos: true } },
    },
  });
  const byPublicId = new Map(files.map((f) => [f.publicId, f]));
  const unusable = fileIds.filter((id) => {
    const file = byPublicId.get(id);
    return (
      !file ||
      isPrivateFile(file) ||
      !file.key.startsWith(kind) ||
      !uploadedFromBranch(file, branchId) ||
      file._count.bookingPhotos > 0
    );
  });
  // OperationDraft.data = { schemaVersion, data, photos: [{ fileId, label }] }
  const inDraft =
    unusable.length === 0
      ? await prisma.operationDraft.count({
          where: { OR: fileIds.map((fileId) => ({ data: { path: ["photos"], array_contains: [{ fileId }] } })) },
        })
      : 0;
  if (unusable.length > 0 || inDraft > 0) {
    throw new EditRejection(StatusCode.BAD_REQUEST, {
      code: "INVALID_PHOTO",
      message: "Some new photos couldn't be used. Remove them and take them again.",
      fileIds: unusable,
    });
  }
  for (const f of files) map.set(f.publicId, { id: f.id, url: f.url, key: f.key });
  return map;
}

const money = (v: { toString(): string } | null | undefined) => (v == null ? null : new Decimal(v.toString()));
const sameMoney = (a: { toString(): string } | null | undefined, b: number | undefined) =>
  b === undefined || (a != null && new Decimal(a.toString()).eq(b));

async function logEdit(
  req: Request,
  actor: { id: number; name: string; role: any; branchId: number | null },
  phase: "PICKUP" | "RETURN",
  bookingPublicId: string,
  diff: { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] },
  plan?: AdjustmentPlan,
  session?: { publicId: string; status: string } | null,
) {
  const what = phase === "PICKUP" ? "Pickup" : "Return";
  // The money difference: per changed line old → new, and how it is settled
  const moneyDetails = plan
    ? {
        ...serializeAdjustmentPlan(plan),
        lines: plan.lines.filter((l) => !l.delta.isZero()).map(serializeDeltaLine),
        adjustmentSession: session ? { publicId: session.publicId, status: session.status } : null,
      }
    : null;
  await auditService.log({
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    actorBranchId: actor.branchId ?? undefined,
    action: phase === "PICKUP" ? "PICKUP_EDITED" : "RETURN_EDITED",
    category: AuditCategory.BOOKING,
    description: `${what} details edited for booking ${bookingPublicId}: ${diff.fields.join(", ")}`,
    entity: "Booking",
    entityId: bookingPublicId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    before: diff.before,
    after: diff.after,
    changedFields: diff.fields,
    ...(moneyDetails && { metadata: { money: moneyDetails } }),
  });
  await staffActivityService.logFromRequest(req, {
    actionType: StaffActionType.UPDATED,
    entityType: StaffEntityType.BOOKING,
    entityRef: bookingPublicId,
    description: `${what} details edited for booking ${bookingPublicId} (${diff.fields.join(", ")})`,
    metadata: { before: diff.before, after: diff.after, changedFields: diff.fields, ...(moneyDetails && { money: moneyDetails }) },
  });
}

const photoList = (photos: Array<{ fileId: string; label?: string | null }>) =>
  photos.map((p) => (p.label ? { fileId: p.fileId, label: p.label } : { fileId: p.fileId }));

// ── Money of an edit ──────────────────────────────────────────────────────────

const ZERO = new Decimal(0);

/** The booking as the edit reads it inside its transaction. */
function loadBookingTx(tx: TxClient, bookingId: number) {
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: summaryBookingSelect });
}

/**
 * A new safety deposit amount, or null when it doesn't change. Only while the
 * car is out with nothing recorded at the drop yet — once the drop credited or
 * refunded the deposit, what was charged is edited on the return.
 */
async function depositChangeFor(booking: SummaryBooking, sent: number | undefined, db: TxClient): Promise<Decimal | null> {
  if (sent === undefined) return null;
  const next = new Decimal(sent).toDecimalPlaces(2);
  const current = new Decimal(booking.safetyDeposit.toString());
  if (next.eq(current)) return null;
  if (booking.status !== BookingStatus.PICKED_UP || booking.requiresManagerConfirmation) {
    throw new EditRejection(StatusCode.CONFLICT, {
      code: "DEPOSIT_LOCKED",
      message: "The safety deposit was settled at the drop. Edit the return to change what was charged or refunded.",
      field: "safetyDeposit",
    });
  }
  const config = (booking.frozenChargeConfig ?? {}) as { safetyDepositEnabled?: boolean };
  if (!config.safetyDepositEnabled && current.isZero()) {
    throw new EditRejection(StatusCode.BAD_REQUEST, {
      code: "DEPOSIT_DISABLED",
      message: "Safety deposits aren't enabled for this booking.",
      field: "safetyDeposit",
    });
  }
  // An open drop bill already credits the deposit it was computed with
  const openDrop = await db.paymentSession.findFirst({
    where: {
      bookingId: booking.id,
      sessionType: PaymentSessionType.RETURN,
      status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.PAYMENT_INITIATED] },
    },
    select: { id: true },
  });
  if (openDrop) {
    throw new EditRejection(StatusCode.CONFLICT, {
      code: "DROP_BILL_OPEN",
      message: "A drop bill is open for this booking. Finish the drop, then edit it to change the deposit's outcome.",
      field: "safetyDeposit",
    });
  }
  return next;
}

/**
 * Money a pickup edit moves: a new safety deposit (car still out), or — once
 * the return is done — the completed drop's bill worked out again with the
 * corrected pickup odometer / FASTag balance (the fuel line is an amount staff
 * typed at the drop and stays as it is).
 */
async function planPickupMoney(
  booking: SummaryBooking,
  m: {
    odoChange: number | null;
    fastagChange: number | null;
    depositChange: Decimal | null;
    superseded: SupersededAdjustment | null;
  },
  db: TxClient,
) {
  const lines: AdjustmentDeltaLine[] = [];
  // From the deposit as last settled (an unsettled difference being replaced already set it on the booking)
  const current = new Decimal(booking.safetyDeposit.toString());
  const depositLine = depositAdjustmentLine({
    current,
    pendingDelta: m.superseded?.depositDelta ?? ZERO,
    target: m.depositChange ?? current,
  });
  if (depositLine) lines.push(depositLine);
  // Drop lines a replaced difference corrected are worked out again too
  const force = m.superseded?.dropCategories ?? [];
  let drop: { state: DropEditState; result: DropEditResult } | null = null;
  if (isDone(returnQueueState(booking)) && (m.odoChange != null || m.fastagChange != null || force.length > 0)) {
    const state = await loadDropEditState(booking.id, db);
    const result = await computeDropEdit(
      booking.id,
      state,
      state.inputs,
      {
        ...(m.odoChange != null && { pickupOdometer: m.odoChange }),
        ...(m.fastagChange != null && { pickupFastagBalance: new Decimal(m.fastagChange) }),
        force,
      },
      db,
    );
    drop = { state, result };
    lines.push(...result.diff.lines);
  }
  const plan: AdjustmentPlan = {
    lines,
    delta: lines.reduce((s, l) => s.plus(l.delta), ZERO),
    settledByBranchManager: drop?.state.flow === "LEGACY",
    depositIncrease: lines.some((l) => l.entryType === "DEPOSIT" && l.delta.gt(0)),
  };
  return { plan, drop };
}

/** The drop's inputs with what the edit sent (absent = as recorded). */
function mergeDropInputs(state: DropEditState, input: z.infer<typeof editReturnSchema>): DropEditInputs {
  const s = state.inputs;
  const decOr = (v: number | undefined, fallback: Decimal) => (v === undefined ? fallback : new Decimal(v).toDecimalPlaces(2));
  const damageAmounts = { ...s.damageAmounts };
  for (const d of input.damages ?? []) {
    if (d.amount === undefined) continue;
    const damage = state.damages.find((x) => x.publicId === d.publicId);
    if (!damage) continue;
    const amount = new Decimal(d.amount).toDecimalPlaces(2);
    if (amount.eq(damage.amount)) continue;
    if (!damage.editable) {
      throw new EditRejection(StatusCode.CONFLICT, {
        code: "DAMAGE_REVIEWED",
        message: "This damage was already reviewed by the branch manager — ask them to change it.",
      });
    }
    damageAmounts[d.publicId] = amount;
  }
  return {
    endOdometer: input.endOdometer ?? s.endOdometer,
    manualExtraKm: input.manualExtraKm !== undefined ? input.manualExtraKm : s.manualExtraKm,
    returnFuelLevel: input.returnFuelLevel ?? s.returnFuelLevel,
    returnFastagBalance:
      input.returnFastagBalance !== undefined ? new Decimal(input.returnFastagBalance) : s.returnFastagBalance,
    fuelCharge: decOr(input.fuelCharge, s.fuelCharge),
    fastagAmount: decOr(input.fastagAmount, s.fastagAmount),
    fastagNotes: input.fastagNotes !== undefined ? input.fastagNotes?.trim() || null : s.fastagNotes,
    otherCharges: input.otherCharges
      ? input.otherCharges
          .filter((o) => o.amount > 0)
          .map((o) => ({ label: o.label.trim(), amount: new Decimal(o.amount).toDecimalPlaces(2) }))
      : s.otherCharges,
    discount:
      input.discount !== undefined
        ? input.discount
          ? { amount: new Decimal(input.discount.amount).toDecimalPlaces(2), reason: input.discount.reason.trim() }
          : null
        : s.discount,
    applyGrace: input.applyGrace ?? s.applyGrace,
    waiveReason:
      input.waiveLateCharge !== undefined ? input.waiveLateCharge?.reason.trim() ?? null : s.waiveReason,
    depositHandling: input.safetyDepositHandling ?? s.depositHandling,
    damageAmounts,
  };
}

/** Money of a return edit: the drop's bill with the merged inputs and its difference. */
async function planReturnMoney(
  booking: SummaryBooking,
  input: z.infer<typeof editReturnSchema>,
  db: TxClient,
  superseded: SupersededAdjustment | null,
) {
  const state = await loadDropEditState(booking.id, db);
  const inputs = mergeDropInputs(state, input);
  if (inputs.returnFastagBalance && !(await getFastagLegs(booking.id, null, db)).at(-1)?.hasFastag) {
    if (!state.inputs.returnFastagBalance?.eq(inputs.returnFastagBalance)) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "NO_FASTAG",
        message: "This car has no FASTag, so there's no balance to record.",
        field: "returnFastagBalance",
      });
    }
  }
  // Drop lines a replaced difference corrected are worked out again too
  const result = await computeDropEdit(booking.id, state, inputs, { force: superseded?.dropCategories ?? [] }, db);
  const plan: AdjustmentPlan = {
    lines: result.diff.lines,
    delta: result.diff.delta,
    settledByBranchManager: state.flow === "LEGACY",
    depositIncrease: false,
  };
  return { state, inputs, result, plan };
}

/**
 * A lower bill takes the part of the booking on counter credit off that credit
 * first — only the rest is refunded (a legacy drop's difference is the branch
 * manager's, in Settlements).
 */
async function withCreditOffset(plan: AdjustmentPlan, bookingId: number, part: AdjustmentPart, tx: TxClient): Promise<AdjustmentPlan> {
  if (plan.settledByBranchManager) return plan;
  const line = await creditOffsetLine(bookingId, plan.delta, part, tx);
  return line ? { ...plan, lines: [...plan.lines, line], delta: plan.delta.plus(line.delta) } : plan;
}

/**
 * The money of a pickup edit, under the booking lock: an edit that changes
 * money replaces the unsettled difference of an earlier one (abandoned first,
 * so the new difference covers everything since the last settled state).
 */
async function pickupMoneyTx(
  tx: TxClient,
  locked: SummaryBooking,
  input: z.infer<typeof editPickupSchema>,
  changes: { odoChange: number | null; fastagChange: number | null },
) {
  const depositChange = await depositChangeFor(locked, input.safetyDeposit, tx);
  const touchesMoney =
    depositChange != null ||
    ((changes.odoChange != null || changes.fastagChange != null) && isDone(returnQueueState(locked)));
  const superseded = touchesMoney ? await pendingToSupersede(locked.id, tx) : null;
  if (superseded) await abandonSuperseded(tx, superseded);
  const { plan, drop } = await planPickupMoney(locked, { ...changes, depositChange, superseded }, tx);
  return { plan: await withCreditOffset(plan, locked.id, "PICKUP", tx), drop, depositChange, superseded };
}

/** The money of a return edit, under the booking lock (see pickupMoneyTx). */
async function returnMoneyTx(tx: TxClient, locked: SummaryBooking, input: z.infer<typeof editReturnSchema>) {
  const before = await loadDropEditState(locked.id, tx);
  const merged = mergeDropInputs(before, input);
  // A legacy drop's deposit refunded in Settlements already: how it was handled stays
  if (before.flow === "LEGACY" && merged.depositHandling !== before.inputs.depositHandling) {
    const owed = await computeBookingOwed(locked.id, tx);
    if (owed.legacyDepositRefunded.gt(0)) {
      throw new EditRejection(StatusCode.CONFLICT, {
        code: "DEPOSIT_REFUND_RECORDED",
        message: "The branch manager already refunded the safety deposit in Settlements, so how it was handled at the drop can't be changed now.",
        field: "safetyDepositHandling",
      });
    }
  }
  const touchesMoney = changedDropCategories(before.inputs, merged).size > 0;
  const superseded = touchesMoney ? await pendingToSupersede(locked.id, tx) : null;
  if (superseded) await abandonSuperseded(tx, superseded);
  const planned = await planReturnMoney(locked, input, tx, superseded);
  return { ...planned, plan: await withCreditOffset(planned.plan, locked.id, "DROP", tx), superseded };
}

/** Thrown to roll a preview back once it has its answer. */
class PreviewRollback<T> extends Error {
  constructor(readonly value: T) {
    super("Preview rolled back");
    this.name = "PreviewRollback";
  }
}

/**
 * Works a preview out exactly as the save would (same lock, an unsettled
 * difference it replaces abandoned) and rolls everything back.
 */
async function previewInRollback<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new PreviewRollback(await fn(tx as any));
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (error instanceof PreviewRollback) return error.value as T;
    throw error;
  }
  throw new Error("Preview didn't produce a result");
}

/** Drop details for the screen next to the difference (DROP_BILL: the edited bill). */
function dropPreview(state: DropEditState, inputs: DropEditInputs, result: DropEditResult) {
  const charges = result.lines.reduce((s, l) => s.plus(l.amount), ZERO);
  return {
    flow: state.flow,
    bill: result.bill,
    late: result.late,
    fastag: result.fastag,
    km: result.km,
    charges: charges.toFixed(2),
    depositHandling: inputs.depositHandling,
  };
}

/** Invoice after an edit's money changed (fire-and-forget, like the drop itself). */
function refreshInvoiceAfterEdit(bookingId: number, flow: DropFlow | null, session: { status: string } | null) {
  if (flow === "LEGACY") {
    syncLegacyReturnInvoice(bookingId).catch((err) => console.error("[operation-edit] Legacy invoice sync failed:", err));
    return;
  }
  // A drop-bill difference still to be settled is invoiced when it is (record-payment / refund)
  if (flow === "DROP_BILL" && session?.status === PaymentSessionStatus.COMPLETED) {
    getBookingCreditSummary(bookingId)
      .then((credit) => finalizeInvoice(bookingId, { markPaid: !(credit?.pending.gt(0) ?? false) }))
      .catch((err) => console.error("[operation-edit] Invoice finalization failed:", err));
  }
}

function sendMoneyError(res: Response, error: unknown, where: string) {
  if (error instanceof DropEditError) return res.status(error.status).json(error.body);
  if (
    error instanceof AdjustmentPendingError ||
    error instanceof AdjustmentChangedError ||
    error instanceof AdjustmentPaymentStartedError ||
    error instanceof EditConfirmationRequiredError
  ) {
    return res.status(error.status).json(error.toJSON());
  }
  return sendError(res, error, where);
}

// ── POST /employee/pickup/:bookingId/edit/preview ─────────────────────────────

/** What a pickup edit would do to the money — nothing is saved. */
export const PreviewPickupEdit = async (req: Request, res: Response) => {
  try {
    const parsed = editPickupSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(StatusCode.BAD_REQUEST).json(validationBody(parsed.error));
    const input = parsed.data;
    const booking = await loadBooking(req.params.bookingId!, req.branch_Id);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (!isDone(pickupQueueState(booking))) return res.status(StatusCode.CONFLICT).json(NOT_COMPLETED.PICKUP);

    const odoChange = input.odo !== undefined && input.odo !== booking.startOdometer ? input.odo : null;
    const fastagChange = sameMoney(booking.pickupFastagBalance, input.pickupFastagBalance) ? null : input.pickupFastagBalance!;
    if (odoChange != null) {
      const problem = pickupOdometerProblem(await getOdometerSegments(booking.id), odoChange, booking.endOdometer);
      if (problem) {
        throw new EditRejection(StatusCode.BAD_REQUEST, { code: "PICKUP_ODOMETER_TOO_HIGH", message: problem, field: "odo" });
      }
    }
    const preview = await previewInRollback(async (tx) => {
      await lockBookingForDrop(tx as any, booking.id);
      const locked = await loadBookingTx(tx, booking.id);
      const { plan, drop, superseded } = await pickupMoneyTx(tx, locked, input, { odoChange, fastagChange });
      return {
        adjustment: serializeAdjustmentPlan(plan),
        drop: drop ? dropPreview(drop.state, drop.state.inputs, drop.result) : null,
        supersedes: superseded ? serializeSession(superseded.session) : null,
      };
    });
    const pending = await findPendingAdjustment(booking.id);
    return res.status(StatusCode.OK).json({
      message: "Pickup edit previewed",
      data: { ...preview, pendingAdjustment: pending ? serializeSession(pending) : null },
    });
  } catch (error) {
    return sendMoneyError(res, error, "PreviewPickupEdit");
  }
};

// ── POST /employee/return/:bookingId/edit/preview ─────────────────────────────

/** What a return edit would do to the bill and the money — nothing is saved. */
export const PreviewReturnEdit = async (req: Request, res: Response) => {
  try {
    const parsed = editReturnSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(StatusCode.BAD_REQUEST).json(validationBody(parsed.error));
    const booking = await loadBooking(req.params.bookingId!, req.branch_Id);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (!isDone(returnQueueState(booking))) return res.status(StatusCode.CONFLICT).json(NOT_COMPLETED.RETURN);

    const preview = await previewInRollback(async (tx) => {
      await lockBookingForDrop(tx as any, booking.id);
      const locked = await loadBookingTx(tx, booking.id);
      const { state, inputs, result, plan, superseded } = await returnMoneyTx(tx, locked, parsed.data);
      return {
        adjustment: serializeAdjustmentPlan(plan),
        drop: dropPreview(state, inputs, result),
        supersedes: superseded ? serializeSession(superseded.session) : null,
      };
    });
    const pending = await findPendingAdjustment(booking.id);
    return res.status(StatusCode.OK).json({
      message: "Return edit previewed",
      data: { ...preview, pendingAdjustment: pending ? serializeSession(pending) : null },
    });
  } catch (error) {
    return sendMoneyError(res, error, "PreviewReturnEdit");
  }
};

// ── PATCH /employee/pickup/:bookingId ─────────────────────────────────────────

export const EditPickup = async (req: Request, res: Response) => {
  try {
    const parsed = editPickupSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(StatusCode.BAD_REQUEST).json(validationBody(parsed.error));
    const input = parsed.data;
    if (input.dlStatus !== undefined && input.dlStatus !== "COLLECTED" && input.dlStatus !== "NOT_COLLECTED") {
      throw new DlStatusError(StatusCode.BAD_REQUEST, "DL_STATUS_INVALID", DL_STATUS_DEPOSIT_REMOVED_MESSAGE);
    }
    // 400 INVALID_DL_NUMBER when invalid; blank = not sent (the number can't be cleared)
    const sentDlNumber = parsePickupDlNumber(input.drivingLicenceNumber);

    const actor = await resolveActor(req);
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    const branchId = req.branch_Id;
    const booking = await loadBooking(req.params.bookingId!, branchId);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (!isDone(pickupQueueState(booking))) {
      return res.status(StatusCode.CONFLICT).json(NOT_COMPLETED.PICKUP);
    }

    // ── What changes ──
    const odoChange = input.odo !== undefined && input.odo !== booking.startOdometer ? input.odo : null;
    const currentFuel = booking.fuelRecord?.pickupFuelLevel ?? null;
    const fuelChange =
      input.pickupFuelLevel !== undefined && input.pickupFuelLevel !== currentFuel ? input.pickupFuelLevel : null;
    // Accepted for any car: a car not marked as having a FASTag counts as one for
    // this booking once its balance is read (as at pickup)
    const fastagChange = sameMoney(booking.pickupFastagBalance, input.pickupFastagBalance)
      ? null
      : input.pickupFastagBalance!;
    const depositChange = await depositChangeFor(booking, input.safetyDeposit, prisma);
    const dlStatusChange =
      input.dlStatus !== undefined && input.dlStatus !== booking.dlStatus
        ? (input.dlStatus as "COLLECTED" | "NOT_COLLECTED")
        : null;
    if (dlStatusChange && !STAFF_DL_EDITABLE_STATUSES.includes(booking.status)) {
      throw new DlStatusError(
        StatusCode.CONFLICT,
        "DL_STATUS_LOCKED",
        "The DL status can't be changed after the return. Ask your branch manager to update it.",
      );
    }
    let dlNumber: PickupDlNumber | null = null;
    if (sentDlNumber) {
      const resolved = await resolvePickupDlNumber(booking.customerId, sentDlNumber);
      if (resolved.changed) {
        // One vehicle per driving licence (X3) while this rental is out
        if (booking.status === BookingStatus.PICKED_UP) {
          await assertDlFree({ dlNumber: resolved.drivingLicenceNumber, mode: "pickup", excludeBookingId: booking.id });
        }
        dlNumber = resolved;
      }
    }

    const existing = await photosOf(booking.id, BookingPhotoType.PRE_DELIVERY);
    const removeIds = [...new Set(input.removeFileIds ?? [])];
    const toRemove = existing.filter((p) => removeIds.includes(p.file.publicId));
    if (toRemove.length !== removeIds.length) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "PHOTO_NOT_FOUND",
        message: "A photo to remove isn't on this pickup any more — reload and try again.",
      });
    }
    // Already saved (a retried save) → skipped; one entry per file
    const kept = existing.filter((p) => !removeIds.includes(p.file.publicId));
    const keptIds = new Set(kept.map((p) => p.file.publicId));
    const toAdd = [...new Map((input.addPhotos ?? []).map((p) => [p.fileId, p])).values()].filter(
      (p) => !keptIds.has(p.fileId),
    );
    const newFiles = await resolveNewFiles(toAdd.map((p) => p.fileId), "pickup/", branchId);
    if (photosEmptied(existing.length, kept.length + toAdd.length)) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "PHOTOS_REQUIRED",
        message: "Keep at least one pickup photo — replace a photo rather than removing them all.",
      });
    }

    const fields = await captureFieldsFor(branchId, booking.items[0]?.vehicle.categoryId);
    const emptied = emptiedRequiredSlots(
      fields.filter((f) => f.required).map((f) => f.name),
      existing.map((p) => p.captureLabel),
      [...kept.map((p) => p.captureLabel), ...toAdd.map((p) => p.label ?? null)],
    );
    if (emptied.length > 0) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "REQUIRED_PHOTO_MISSING",
        message: `Take the required photo${emptied.length > 1 ? "s" : ""}: ${emptied.join(", ")}.`,
      });
    }
    const photosChange = toRemove.length > 0 || toAdd.length > 0;

    if (
      odoChange == null && !fuelChange && fastagChange == null && !depositChange &&
      !dlStatusChange && !dlNumber && !photosChange
    ) {
      return res.status(StatusCode.OK).json({
        message: "Nothing to change",
        changed: [],
        data: await buildPickupSummary(booking, branchId),
        adjustment: null,
      });
    }

    const completion = (await loadCompletionInfo("PICKUP", [booking])).get(booking.id);
    const vehicleIds = booking.items.map((i) => i.vehicle.id);

    const outcome = await prisma.$transaction(
      async (tx) => {
        // Serialised with the drop bill, its payments and other edits of this booking
        await lockBookingForDrop(tx as any, booking.id);
        const locked = await loadBookingTx(tx as any, booking.id);
        if (!isDone(pickupQueueState(locked))) throw new EditRejection(StatusCode.CONFLICT, NOT_COMPLETED.PICKUP);

        const update: Prisma.BookingUpdateInput = {};
        if (odoChange != null) {
          const segments = await getOdometerSegments(booking.id, tx as any);
          const problem = pickupOdometerProblem(segments, odoChange, locked.endOdometer);
          if (problem) {
            throw new EditRejection(StatusCode.BAD_REQUEST, { code: "PICKUP_ODOMETER_TOO_HIGH", message: problem, field: "odo" });
          }
        }

        // ── Money: re-worked under the lock (replacing an unsettled difference),
        // refused when it moved since the preview ──
        const { plan, drop, depositChange: lockedDeposit, superseded } = await pickupMoneyTx(
          tx as any,
          locked,
          input,
          { odoChange, fastagChange },
        );
        assertExpectedDelta(input.expectedDelta, plan.delta, plan.lines.some((l) => !l.delta.isZero()));

        if (odoChange != null) {
          update.startOdometer = odoChange;
          // The car still out on this rental keeps the corrected reading as its last known odometer
          const segments = await getOdometerSegments(booking.id, tx as any);
          if (locked.status !== BookingStatus.RETURNED && segments.swapCount === 0 && locked.startOdometer != null) {
            await tx.vehicle.updateMany({
              where: { id: { in: vehicleIds }, odo: locked.startOdometer },
              data: { odo: odoChange },
            });
          }
        }
        // The completed drop's km, worked out again from the corrected reading
        if (drop?.result.km && drop.result.changed.has("KM")) {
          update.totalKmDriven = drop.result.km.kmDriven;
          update.extraKmCharged = drop.result.km.extraKm;
        }

        if (fuelChange) {
          // Branches without the fuel module kept no per-booking reading: it is recorded now
          await tx.fuelRecord.upsert({
            where: { bookingId: booking.id },
            create: {
              publicId: createID(),
              bookingId: booking.id,
              pickupFuelLevel: fuelChange,
              capturedByPickupId: actor.id,
              pickupAt: completion?.at ?? booking.startAt,
            },
            update: { pickupFuelLevel: fuelChange },
          });
        }
        if (fastagChange != null) update.pickupFastagBalance = fastagChange.toFixed(2);
        if (dlStatusChange) {
          Object.assign(update, dlStatusUpdateData({ dlStatus: dlStatusChange, dlDepositNote: null }, actor.id, locked));
        }
        if (dlNumber) await savePickupDlNumber(dlNumber, tx);

        if (lockedDeposit) {
          update.safetyDeposit = lockedDeposit.toFixed(2);
          await tx.safetyDepositRequest.upsert({
            where: { bookingId: booking.id },
            create: {
              publicId: createID(),
              bookingId: booking.id,
              requestedAmount: lockedDeposit.toFixed(2),
              reason: "Set when the pickup was edited",
              status: "APPROVED",
              requestedById: actor.id,
              approvedById: actor.id,
              approvedAmount: lockedDeposit.toFixed(2),
              approvedAt: new Date(),
            },
            update: { requestedAmount: lockedDeposit.toFixed(2), approvedAmount: lockedDeposit.toFixed(2) },
          });
        }

        if (toRemove.length > 0) {
          await tx.bookingPhoto.deleteMany({
            where: { id: { in: toRemove.map((p) => p.id) }, bookingId: booking.id },
          });
        }
        if (toAdd.length > 0) {
          await tx.bookingPhoto.createMany({
            data: toAdd.map((p) => ({
              publicId: createID(),
              bookingId: booking.id,
              fileId: newFiles.get(p.fileId)!.id,
              type: BookingPhotoType.PRE_DELIVERY,
              captureLabel: p.label ?? null,
            })),
          });
        }
        if (Object.keys(update).length > 0) {
          await tx.booking.update({ where: { id: booking.id }, data: update });
        }

        // The difference: a legacy drop's return charges go back to the branch manager's
        // Settlements; everything else is settled on an ADJUSTMENT session
        let session = null;
        if (drop?.state.flow === "LEGACY") {
          await writeLegacyDropRows(tx as any, booking.id, drop.result, actor.id);
        } else {
          session = await createAdjustmentSession(tx as any, {
            booking,
            actor: { id: actor.id, role: String(actor.role) },
            operation: "PICKUP",
            lines: plan.lines,
            metadata: { editedById: actor.id, ...(superseded && { replaces: superseded.session.publicId }) },
          });
        }
        if (superseded) await linkSuperseded(tx as any, superseded, session?.publicId ?? null);
        return { plan, flow: drop?.state.flow ?? null, session };
      },
      { timeout: 30000 },
    );

    refreshInvoiceAfterEdit(booking.id, outcome.flow, outcome.session);

    const diff = changedFields(
      {
        odometer: booking.startOdometer,
        fuelLevel: currentFuel,
        fastagBalance: money(booking.pickupFastagBalance)?.toFixed(2) ?? null,
        safetyDeposit: new Decimal(booking.safetyDeposit.toString()).toFixed(2),
        dlStatus: booking.dlStatus,
        drivingLicenceNumber: dlNumber?.previous ?? null,
        photos: photoList(existing.map((p) => ({ fileId: p.file.publicId, label: p.captureLabel }))),
      } as Record<string, unknown>,
      {
        odometer: odoChange ?? undefined,
        fuelLevel: fuelChange ?? undefined,
        fastagBalance: fastagChange != null ? fastagChange.toFixed(2) : undefined,
        safetyDeposit: depositChange ? depositChange.toFixed(2) : undefined,
        dlStatus: dlStatusChange ?? undefined,
        drivingLicenceNumber: dlNumber?.drivingLicenceNumber,
        photos: photosChange
          ? photoList([
              ...kept.map((p) => ({ fileId: p.file.publicId, label: p.captureLabel })),
              ...toAdd.map((p) => ({ fileId: p.fileId, label: p.label ?? null })),
            ])
          : undefined,
      },
    );
    await logEdit(req, actor, "PICKUP", booking.publicId, diff, outcome.plan, outcome.session);
    if (dlNumber) await logPickupDlNumber(req, dlNumber, booking.publicId);
    if (dlStatusChange) await invalidateDlStatusListCaches(branchId);

    const fresh = await loadBooking(booking.publicId, branchId);
    return res.status(StatusCode.OK).json({
      message: "Pickup updated",
      changed: diff.fields,
      data: await buildPickupSummary(fresh!, branchId),
      adjustment: {
        ...serializeAdjustmentPlan(outcome.plan),
        session: outcome.session ? serializeSession(outcome.session) : null,
      },
    });
  } catch (error) {
    return sendMoneyError(res, error, "EditPickup");
  }
};

// ── PATCH /employee/return/:bookingId ─────────────────────────────────────────

export const EditReturn = async (req: Request, res: Response) => {
  try {
    const parsed = editReturnSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(StatusCode.BAD_REQUEST).json(validationBody(parsed.error));
    const input = parsed.data;

    const actor = await resolveActor(req);
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    const branchId = req.branch_Id;
    const booking = await loadBooking(req.params.bookingId!, branchId);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (!isDone(returnQueueState(booking))) {
      return res.status(StatusCode.CONFLICT).json(NOT_COMPLETED.RETURN);
    }

    // ── Readings that aren't bill inputs ──
    const currentFuel = booking.fuelRecord?.returnFuelLevel ?? null;
    const fuelChange =
      input.returnFuelLevel !== undefined && input.returnFuelLevel !== currentFuel ? input.returnFuelLevel : null;
    if (fuelChange && !booking.fuelRecord) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "FUEL_NOT_RECORDED",
        message: "No fuel reading was kept for this rental, so a return fuel level can't be saved.",
        field: "returnFuelLevel",
      });
    }

    const existing = await photosOf(booking.id, BookingPhotoType.POST_RETURN);
    const removeIds = [...new Set(input.removeFileIds ?? [])];
    const toRemove = existing.filter((p) => removeIds.includes(p.file.publicId));
    if (toRemove.length !== removeIds.length) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "PHOTO_NOT_FOUND",
        message: "A photo to remove isn't on this return any more — reload and try again.",
      });
    }
    const kept = existing.filter((p) => !removeIds.includes(p.file.publicId));
    const keptIds = new Set(kept.map((p) => p.file.publicId));
    const toAdd = [...new Set((input.addPhotos ?? []).map((p) => p.fileId))].filter((id) => !keptIds.has(id));

    // Drop damage: notes and photos (amounts are bill inputs, below)
    const damageInputs = input.damages ?? [];
    const reports = damageInputs.length
      ? await prisma.damageReport.findMany({
          where: { bookingId: booking.id, publicId: { in: damageInputs.map((d) => d.publicId) } },
          select: {
            id: true,
            publicId: true,
            severity: true,
            notes: true,
            status: true,
            chargedAtDrop: true,
            estimatedCost: true,
            finalCost: true,
            photos: {
              where: { type: BookingPhotoType.DAMAGE },
              orderBy: { createdAt: "asc" },
              select: { id: true, file: { select: { id: true, publicId: true, url: true } } },
            },
          },
        })
      : [];
    const damagePlans = damageInputs.map((d) => {
      const report = reports.find((r) => r.publicId === d.publicId);
      if (!report || !isDropDamage(report.notes)) {
        throw new EditRejection(StatusCode.BAD_REQUEST, {
          code: "DAMAGE_NOT_FOUND",
          message: "A damage to edit isn't on this return — reload and try again.",
        });
      }
      const notes = report.notes as Record<string, any>;
      const area = d.area !== undefined && d.area !== String(notes.area ?? "") ? d.area : null;
      const description =
        d.description !== undefined && d.description !== String(notes.description ?? "") ? d.description : null;
      const severity = d.severity !== undefined && d.severity !== report.severity ? d.severity : null;
      const removeDamageIds = [...new Set(d.removeFileIds ?? [])];
      const removedPhotos = report.photos.filter((p) => removeDamageIds.includes(p.file.publicId));
      if (removedPhotos.length !== removeDamageIds.length) {
        throw new EditRejection(StatusCode.BAD_REQUEST, {
          code: "PHOTO_NOT_FOUND",
          message: "A damage photo to remove isn't on this damage any more — reload and try again.",
        });
      }
      const keptPhotos = report.photos.filter((p) => !removeDamageIds.includes(p.file.publicId));
      const keptDamageIds = new Set(keptPhotos.map((p) => p.file.publicId));
      const addedIds = [...new Set(d.addPhotoIds ?? [])].filter((id) => !keptDamageIds.has(id));
      // The cost of a damage the manager charges in the review (not on a drop bill):
      // what the review starts from — no money moves here. A drop-billed damage's
      // cost is a bill input (worked out below).
      const reviewCost =
        !report.chargedAtDrop && d.amount !== undefined && !dropDamageAmount(report).eq(d.amount)
          ? new Decimal(d.amount).toDecimalPlaces(2)
          : null;
      const changes =
        area != null || description != null || severity != null || removedPhotos.length > 0 || addedIds.length > 0 || reviewCost != null;
      if (changes && report.status !== DamageReportStatus.PENDING) {
        throw new EditRejection(StatusCode.CONFLICT, {
          code: "DAMAGE_REVIEWED",
          message: "This damage was already reviewed by the branch manager — ask them to change it.",
        });
      }
      if (keptPhotos.length + addedIds.length === 0) {
        throw new EditRejection(StatusCode.BAD_REQUEST, {
          code: "DAMAGE_PHOTO_REQUIRED",
          message: "Keep at least one photo of each damage.",
        });
      }
      return { report, notes, area, description, severity, removedPhotos, keptPhotos, addedIds, reviewCost, changes };
    });
    const changedDamages = damagePlans.filter((p) => p.changes);

    if (photosEmptied(existing.length, kept.length + toAdd.length)) {
      throw new EditRejection(StatusCode.BAD_REQUEST, {
        code: "PHOTOS_REQUIRED",
        message: "Keep at least one return photo — replace a photo rather than removing them all.",
      });
    }
    const newFiles = new Map([
      ...(await resolveNewFiles(toAdd, "returns/", branchId)),
      ...(await resolveNewFiles([...new Set(changedDamages.flatMap((p) => p.addedIds))], "damage/", branchId)),
    ]);
    const photosChange = toRemove.length > 0 || toAdd.length > 0;

    // ── Bill inputs ──
    const before = await loadDropEditState(booking.id);
    const merged = mergeDropInputs(before, input);
    const inputsChange =
      JSON.stringify(serializeDropInputs(merged)) !== JSON.stringify(serializeDropInputs(before.inputs));

    if (!inputsChange && !fuelChange && !photosChange && changedDamages.length === 0) {
      return res.status(StatusCode.OK).json({
        message: "Nothing to change",
        changed: [],
        data: await buildReturnSummary(booking),
        adjustment: null,
      });
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        await lockBookingForDrop(tx as any, booking.id);
        const locked = await loadBookingTx(tx as any, booking.id);
        if (!isDone(returnQueueState(locked))) throw new EditRejection(StatusCode.CONFLICT, NOT_COMPLETED.RETURN);

        // ── Money: the bill re-worked under the lock (replacing an unsettled
        // difference), refused when it moved since the preview ──
        const { state, inputs, result, plan, superseded } = await returnMoneyTx(tx as any, locked, input);
        assertExpectedDelta(input.expectedDelta, plan.delta, plan.lines.some((l) => !l.delta.isZero()));

        const update: Prisma.BookingUpdateInput = {};
        if (inputs.endOdometer !== state.inputs.endOdometer) update.endOdometer = inputs.endOdometer;
        if (result.km && result.changed.has("KM")) {
          update.totalKmDriven = result.km.kmDriven;
          update.extraKmCharged = result.km.extraKm;
          if (locked.freeKmLimit == null && result.km.includedKm != null) update.freeKmLimit = result.km.includedKm;
        }
        if (
          (inputs.returnFastagBalance == null) !== (state.inputs.returnFastagBalance == null) ||
          (inputs.returnFastagBalance && !inputs.returnFastagBalance.eq(state.inputs.returnFastagBalance ?? -1))
        ) {
          update.returnFastagBalance = inputs.returnFastagBalance?.toFixed(2) ?? null;
        }
        if (Object.keys(update).length > 0) {
          await tx.booking.update({ where: { id: booking.id }, data: update });
        }

        if (fuelChange) {
          await tx.fuelRecord.update({
            where: { bookingId: booking.id },
            data: {
              returnFuelLevel: fuelChange,
              ...(currentFuel == null && { returnAt: booking.returnedAt ?? new Date(), capturedByReturnId: actor.id }),
            },
          });
        }

        // Deposit choice (no money moves: the customer's net is charges − deposit either way)
        if (inputs.depositHandling !== state.inputs.depositHandling) {
          await recordDepositHandling(tx, booking.id, inputs.depositHandling, state.flow === "LEGACY" ? "LEGACY" : "DROP_BILL", actor.id);
        }
        // Damage amounts charged at drop (unreviewed only — checked when merging)
        for (const [publicId, amount] of Object.entries(inputs.damageAmounts)) {
          const previous = state.inputs.damageAmounts[publicId];
          if (previous && previous.eq(amount)) continue;
          await tx.damageReport.updateMany({
            where: { bookingId: booking.id, publicId, status: DamageReportStatus.PENDING },
            data: { estimatedCost: amount.toFixed(2), finalCost: amount.toFixed(2) },
          });
        }
        // What this edit left the drop's inputs at (the next edit starts from them)
        const fresh = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { pricingSnapshot: true } });
        const snapshot = (fresh.pricingSnapshot ?? {}) as Record<string, unknown>;
        await tx.booking.update({
          where: { id: booking.id },
          data: { pricingSnapshot: { ...snapshot, editedDropInputs: serializeDropInputs(inputs) } as Prisma.InputJsonValue },
        });

        if (toRemove.length > 0) {
          await tx.bookingPhoto.deleteMany({ where: { id: { in: toRemove.map((p) => p.id) }, bookingId: booking.id } });
        }
        if (toAdd.length > 0) {
          await tx.bookingPhoto.createMany({
            data: toAdd.map((fileId) => ({
              publicId: createID(),
              bookingId: booking.id,
              fileId: newFiles.get(fileId)!.id,
              type: BookingPhotoType.POST_RETURN,
            })),
          });
        }

        for (const plan of changedDamages) {
          const area = plan.area ?? String(plan.notes.area ?? "");
          const description = plan.description ?? String(plan.notes.description ?? "");
          const severity = plan.severity ?? plan.report.severity;
          if (plan.removedPhotos.length > 0) {
            await tx.bookingPhoto.deleteMany({
              where: { id: { in: plan.removedPhotos.map((p) => p.id) }, damageReportId: plan.report.id },
            });
          }
          if (plan.addedIds.length > 0) {
            await tx.bookingPhoto.createMany({
              data: plan.addedIds.map((fileId) => ({
                publicId: createID(),
                bookingId: booking.id,
                fileId: newFiles.get(fileId)!.id,
                type: BookingPhotoType.DAMAGE,
                damageReportId: plan.report.id,
              })),
            });
          }
          const photos = [
            ...plan.keptPhotos.map((p) => ({ publicId: p.file.publicId, url: p.file.url })),
            ...plan.addedIds.map((fileId) => ({ publicId: fileId, url: newFiles.get(fileId)!.url })),
          ];
          // `damages` mirrors the shape the manager damage review renders
          const first = Array.isArray(plan.notes.damages) ? (plan.notes.damages[0] ?? {}) : {};
          await tx.damageReport.update({
            where: { id: plan.report.id },
            data: {
              severity,
              notes: { ...plan.notes, area, description, damages: [{ ...first, area, severity, description, photos }] },
              ...(plan.reviewCost && {
                estimatedCost: plan.reviewCost.toFixed(2),
                finalCost: plan.reviewCost.toFixed(2),
              }),
            },
          });
        }

        // The difference: legacy return charges go back to the branch manager's
        // Settlements; a drop bill's is settled on an ADJUSTMENT session
        let session = null;
        if (state.flow === "LEGACY") {
          await writeLegacyDropRows(tx as any, booking.id, result, actor.id);
        } else {
          session = await createAdjustmentSession(tx as any, {
            booking,
            actor: { id: actor.id, role: String(actor.role) },
            operation: "RETURN",
            lines: plan.lines,
            metadata: {
              editedById: actor.id,
              inputs: serializeDropInputs(inputs),
              ...(superseded && { replaces: superseded.session.publicId }),
            },
          });
        }
        if (superseded) await linkSuperseded(tx as any, superseded, session?.publicId ?? null);
        return { plan, flow: state.flow, session, before: state.inputs, after: inputs };
      },
      { timeout: 30000 },
    );

    refreshInvoiceAfterEdit(booking.id, outcome.flow, outcome.session);

    const damageState = (plan: (typeof changedDamages)[number], after: boolean) => ({
      publicId: plan.report.publicId,
      ...(plan.reviewCost && {
        cost: after ? plan.reviewCost.toFixed(2) : dropDamageAmount(plan.report).toFixed(2),
      }),
      area: after ? plan.area ?? String(plan.notes.area ?? "") : String(plan.notes.area ?? ""),
      description: after ? plan.description ?? String(plan.notes.description ?? "") : String(plan.notes.description ?? ""),
      severity: after ? plan.severity ?? plan.report.severity : plan.report.severity,
      photos: after
        ? [...plan.keptPhotos.map((p) => p.file.publicId), ...plan.addedIds]
        : [...plan.keptPhotos, ...plan.removedPhotos].map((p) => p.file.publicId),
    });
    const beforeInputs = serializeDropInputs(outcome.before);
    const afterInputs = serializeDropInputs(outcome.after);
    const diff = changedFields(
      {
        ...beforeInputs,
        returnFuelLevel: currentFuel,
        photos: photoList(existing.map((p) => ({ fileId: p.file.publicId }))),
        damages: changedDamages.map((p) => damageState(p, false)),
      } as Record<string, unknown>,
      {
        ...afterInputs,
        returnFuelLevel: fuelChange ?? undefined,
        photos: photosChange
          ? photoList([...kept.map((p) => ({ fileId: p.file.publicId })), ...toAdd.map((fileId) => ({ fileId }))])
          : undefined,
        damages: changedDamages.length ? changedDamages.map((p) => damageState(p, true)) : undefined,
      },
    );
    await logEdit(req, actor, "RETURN", booking.publicId, diff, outcome.plan, outcome.session);

    const fresh = await loadBooking(booking.publicId, branchId);
    return res.status(StatusCode.OK).json({
      message: "Return updated",
      changed: diff.fields,
      data: await buildReturnSummary(fresh!),
      adjustment: {
        ...serializeAdjustmentPlan(outcome.plan),
        session: outcome.session ? serializeSession(outcome.session) : null,
      },
    });
  } catch (error) {
    return sendMoneyError(res, error, "EditReturn");
  }
};
