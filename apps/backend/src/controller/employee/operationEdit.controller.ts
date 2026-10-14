/**
 * Completed pickups / returns (client item 1, Oct 2026): a read-only summary,
 * and "Edit Pickup" / "Edit Return" — the only way back into what was
 * captured once the pickup / drop is done.
 *
 * Endpoints (own branch only):
 *   GET   /employee/pickup/:bookingId/summary
 *   GET   /employee/return/:bookingId/summary
 *   PATCH /employee/pickup/:bookingId   odometer, fuel, FASTag balance, DL status, DL number, photos
 *   PATCH /employee/return/:bookingId   odometer, fuel, FASTag balance, photos, drop damage notes / photos
 *
 * A pickup / return counts as completed once it is done or sent to the branch
 * manager (utils/booking/completedQueue.ts). Edits run with the booking row
 * locked (like the drop bill and its payments) and write an audit entry and a
 * staff-activity entry with the before / after of every changed field.
 *
 * Money already computed or settled is never changed here (nothing is
 * re-billed, no payment or ledger row is touched): a reading that would give a
 * different charge is refused with 409 EDIT_CHANGES_CHARGES
 * (services/booking/operation-edit-guard.ts). Charges themselves (fuel / FASTag
 * / other charges, discounts, waivers, damage amounts) stay with the branch
 * manager. FASTag balances are only for a car with a FASTag; swap readings
 * (VehicleSwap) are not edited here.
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
import { DL_STATUS_DEPOSIT_REMOVED_MESSAGE } from "@repo/schemas";
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
  EDIT_CHANGES_CHARGES,
  billedKmAllowance,
  billedKmCharge,
  changedFields,
  emptiedRequiredSlots,
  endOdometerProblem,
  fastagEditChangesCharges,
  fuelEditChangesCharges,
  kmEditChangesCharges,
  photosEmptied,
  pickupOdometerProblem,
  withPickupOdometer,
  type BilledKmAllowance,
} from "../../services/booking/operation-edit-guard.js";
import { getOdometerSegments } from "../../services/charges/km-allowance.service.js";
import {
  LEGACY_EXTRA_KM_KEY,
  LEGACY_RETURN_CHARGE_TYPES,
} from "../../services/charges/legacy-return-charges.service.js";
import { calculateFastagUsage, fastagBalanceField } from "../../services/charges/fastag-usage.js";
import { getFastagLegs } from "../../services/charges/fastag-usage.service.js";
import { isDropDamage, lockBookingForDrop } from "../../services/damage/drop-damage.service.js";
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
  // ₹ on the pickup car's FASTag (cars with a FASTag only)
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
});

const editReturnSchema = z.object({
  endOdometer: z.coerce
    .number()
    .int("End odometer must be a whole number")
    .min(0, "End odometer can't be negative")
    .optional(),
  returnFuelLevel: FUEL_LEVEL.optional(),
  // ₹ on the returned car's FASTag at the drop (cars with a FASTag only)
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
      }),
    )
    .max(20)
    .optional(),
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

// ── Summaries ─────────────────────────────────────────────────────────────────

async function buildPickupSummary(booking: SummaryBooking, branchId: number) {
  const state = pickupQueueState(booking);
  const completion = isDone(state) ? (await loadCompletionInfo("PICKUP", [booking])).get(booking.id) : undefined;
  const [photos, captureFields, bill, fastagLegs] = await Promise.all([
    photosOf(booking.id, BookingPhotoType.PRE_DELIVERY).then(serializePhotos),
    captureFieldsFor(branchId, booking.items[0]?.vehicle.categoryId),
    sessionBill(booking.id, PaymentSessionType.PICKUP),
    getFastagLegs(booking.id, money(booking.returnFastagBalance)),
  ]);
  const dlStatusEditable = STAFF_DL_EDITABLE_STATUSES.includes(booking.status);
  const returnDone = isDone(returnQueueState(booking));
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
    // FASTag balance read at the handover — only for a car with a FASTag
    fastag: {
      hasFastag: fastagLegs[0]?.hasFastag ?? false,
      balance: money(booking.pickupFastagBalance)?.toFixed(2) ?? null,
    },
    safetyDeposit: new Decimal(booking.safetyDeposit.toString()).toFixed(2),
    photos,
    captureFields,
    bill,
    edit: {
      allowed: isDone(state),
      // The return is done and measured km from this reading: a change that moves the billed
      // km charge is refused (an open drop bill just goes stale)
      odometerCheckedAgainstCharges: returnDone && booking.endOdometer != null,
      // The return is done: a balance that moves the FASTag charge is refused
      fastagCheckedAgainstCharges: returnDone,
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
  const [segments, photos, damageRows, sessionLines, fastagLegs] = await Promise.all([
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
    // FASTag of the car handed back — only for a car with a FASTag
    fastag: {
      hasFastag: returnedLeg?.hasFastag ?? false,
      // its balance when the customer got it (pickup, or the swap's replacement reading)
      startBalance: returnedLeg?.startBalance?.toFixed(2) ?? null,
      balance: money(booking.returnFastagBalance)?.toFixed(2) ?? null,
      // worked out from the readings (null when a reading is missing: the charge was typed)
      usage: fastagUsage.status === "COMPUTED" ? fastagUsage.amount.toFixed(2) : null,
    },
    photos,
    damages,
    bill,
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

/**
 * The free km and rate the drop billed with (never today's pricing): the
 * settled drop bill's km, else the legacy drop's free km and extra-km charge row.
 */
async function loadBilledKmAllowance(tx: Prisma.TransactionClient, bookingId: number): Promise<BilledKmAllowance> {
  const [booking, bill, legacyKm] = await Promise.all([
    tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { freeKmLimit: true, extraKmCharged: true } }),
    tx.paymentSession.findFirst({
      where: { bookingId, sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
      orderBy: { completedAt: "desc" },
      select: { metadata: true },
    }),
    tx.chargeEntry.findUnique({
      where: { bookingId_moduleKey: { bookingId, moduleKey: LEGACY_EXTRA_KM_KEY } },
      select: { unitRate: true },
    }),
  ]);
  return billedKmAllowance({
    billKm: (bill?.metadata as { km?: unknown } | null)?.km ?? null,
    freeKmLimit: booking.freeKmLimit,
    extraKmCharged: booking.extraKmCharged,
    legacyExtraKmRate: legacyKm?.unitRate ?? null,
  });
}

const money = (v: { toString(): string } | null | undefined) => (v == null ? null : new Decimal(v.toString()));
const sameMoney = (a: { toString(): string } | null | undefined, b: number | undefined) =>
  b === undefined || (a != null && new Decimal(a.toString()).eq(b));

/**
 * A fuel charge worked out from the levels: the settled drop bill's FUEL line
 * (prefilled from the bars short) or the charge engine's FUEL_DEFICIT row.
 */
async function hasLevelBasedFuelCharge(tx: Prisma.TransactionClient, bookingId: number) {
  const [row, line] = await Promise.all([
    tx.chargeEntry.findFirst({
      where: { bookingId, chargeType: ChargeType.FUEL_DEFICIT, finalAmount: { gt: 0 } },
      select: { id: true },
    }),
    tx.ledgerEntry.findFirst({
      where: {
        bookingId,
        entryType: LedgerEntryType.FUEL,
        isVoided: false,
        amount: { gt: 0 },
        session: { sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
      },
      select: { id: true },
    }),
  ]);
  return row != null || line != null;
}

async function logEdit(
  req: Request,
  actor: { id: number; name: string; role: any; branchId: number | null },
  phase: "PICKUP" | "RETURN",
  bookingPublicId: string,
  diff: { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] },
) {
  const what = phase === "PICKUP" ? "Pickup" : "Return";
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
  });
  await staffActivityService.logFromRequest(req, {
    actionType: StaffActionType.UPDATED,
    entityType: StaffEntityType.BOOKING,
    entityRef: bookingPublicId,
    description: `${what} details edited for booking ${bookingPublicId} (${diff.fields.join(", ")})`,
    metadata: { before: diff.before, after: diff.after, changedFields: diff.fields },
  });
}

const photoList = (photos: Array<{ fileId: string; label?: string | null }>) =>
  photos.map((p) => (p.label ? { fileId: p.fileId, label: p.label } : { fileId: p.fileId }));

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
    const fastagChange = sameMoney(booking.pickupFastagBalance, input.pickupFastagBalance)
      ? null
      : input.pickupFastagBalance!;
    if (fastagChange != null) {
      const legs = await getFastagLegs(booking.id, null);
      if (!legs[0]?.hasFastag) {
        throw new EditRejection(StatusCode.BAD_REQUEST, {
          code: "NO_FASTAG",
          message: "This car has no FASTag, so there's no balance to record.",
          field: "pickupFastagBalance",
        });
      }
    }
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

    if (odoChange == null && !fuelChange && fastagChange == null && !dlStatusChange && !dlNumber && !photosChange) {
      return res.status(StatusCode.OK).json({
        message: "Nothing to change",
        changed: [],
        data: await buildPickupSummary(booking, branchId),
      });
    }

    const completion = (await loadCompletionInfo("PICKUP", [booking])).get(booking.id);
    const vehicleIds = booking.items.map((i) => i.vehicle.id);

    await prisma.$transaction(
      async (tx) => {
        // Serialised with the drop bill, its payments and other edits of this booking
        await lockBookingForDrop(tx as any, booking.id);
        const locked = await tx.booking.findUniqueOrThrow({
          where: { id: booking.id },
          select: {
            status: true,
            requiresManagerConfirmation: true,
            startOdometer: true,
            endOdometer: true,
            licenseCollectedAt: true,
            returnFastagBalance: true,
          },
        });
        if (!isDone(pickupQueueState(locked))) throw new EditRejection(StatusCode.CONFLICT, NOT_COMPLETED.PICKUP);

        const update: Prisma.BookingUpdateInput = {};

        if (odoChange != null) {
          const segments = await getOdometerSegments(booking.id, tx as any);
          const problem = pickupOdometerProblem(segments, odoChange, locked.endOdometer);
          if (problem) {
            throw new EditRejection(StatusCode.BAD_REQUEST, { code: "PICKUP_ODOMETER_TOO_HIGH", message: problem, field: "odo" });
          }
          // Return done and km measured: only a change that leaves the billed km charge alone.
          // Before that, an open drop bill is marked stale by the change (odometerBillStale).
          if (isDone(returnQueueState(locked)) && locked.endOdometer != null) {
            const allowance = await loadBilledKmAllowance(tx, booking.id);
            const after = withPickupOdometer(segments, odoChange);
            const check = { segmentsBefore: segments, segmentsAfter: after, endBefore: locked.endOdometer, endAfter: locked.endOdometer };
            if (kmEditChangesCharges(check, (s, end) => billedKmCharge(allowance, s, end).charge)) {
              throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "odo" });
            }
            const km = billedKmCharge(allowance, after, locked.endOdometer);
            if (km.measured) {
              update.totalKmDriven = km.kmDriven;
              update.extraKmCharged = km.extraKm;
            }
          }
          update.startOdometer = odoChange;
          // The car still out on this rental keeps the corrected reading as its last known odometer
          if (locked.status !== BookingStatus.RETURNED && segments.swapCount === 0 && locked.startOdometer != null) {
            await tx.vehicle.updateMany({
              where: { id: { in: vehicleIds }, odo: locked.startOdometer },
              data: { odo: odoChange },
            });
          }
        }

        if (fuelChange) {
          const record = await tx.fuelRecord.findUnique({
            where: { bookingId: booking.id },
            select: { returnFuelLevel: true },
          });
          // After a swap that recorded the replacement's fuel, the drop measured from that instead
          const dropStartFuel = (await getOdometerSegments(booking.id, tx as any)).currentStartFuelLevel;
          if (
            record?.returnFuelLevel &&
            dropStartFuel == null &&
            fuelEditChangesCharges({
              levelBasedFuelCharge: await hasLevelBasedFuelCharge(tx, booking.id),
              before: { pickupLevel: currentFuel, returnLevel: record.returnFuelLevel },
              after: { pickupLevel: fuelChange, returnLevel: record.returnFuelLevel },
            })
          ) {
            throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "pickupFuelLevel" });
          }
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

        if (fastagChange != null) {
          // Return done: the drop worked the FASTag charge out from this reading. Before
          // that, an open drop bill is marked stale by the change (fastagBillStale).
          if (isDone(returnQueueState(locked))) {
            const legs = await getFastagLegs(booking.id, money(locked.returnFastagBalance), tx as any);
            const corrected = legs.map((leg, i) => (i === 0 ? { ...leg, startBalance: new Decimal(fastagChange) } : leg));
            if (fastagEditChangesCharges(calculateFastagUsage(legs), calculateFastagUsage(corrected))) {
              throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "pickupFastagBalance" });
            }
          }
          update.pickupFastagBalance = fastagChange.toFixed(2);
        }

        if (dlStatusChange) {
          Object.assign(update, dlStatusUpdateData({ dlStatus: dlStatusChange, dlDepositNote: null }, actor.id, locked));
        }
        if (dlNumber) await savePickupDlNumber(dlNumber, tx);

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
      },
      { timeout: 20000 },
    );

    const diff = changedFields(
      {
        odometer: booking.startOdometer,
        fuelLevel: currentFuel,
        fastagBalance: money(booking.pickupFastagBalance)?.toFixed(2) ?? null,
        dlStatus: booking.dlStatus,
        drivingLicenceNumber: dlNumber?.previous ?? null,
        photos: photoList(existing.map((p) => ({ fileId: p.file.publicId, label: p.captureLabel }))),
      } as Record<string, unknown>,
      {
        odometer: odoChange ?? undefined,
        fuelLevel: fuelChange ?? undefined,
        fastagBalance: fastagChange != null ? fastagChange.toFixed(2) : undefined,
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
    await logEdit(req, actor, "PICKUP", booking.publicId, diff);
    if (dlNumber) await logPickupDlNumber(req, dlNumber, booking.publicId);
    if (dlStatusChange) await invalidateDlStatusListCaches(branchId);

    const fresh = await loadBooking(booking.publicId, branchId);
    return res.status(StatusCode.OK).json({
      message: "Pickup updated",
      changed: diff.fields,
      data: await buildPickupSummary(fresh!, branchId),
    });
  } catch (error) {
    return sendError(res, error, "EditPickup");
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

    // ── What changes ──
    const endChange =
      input.endOdometer !== undefined && input.endOdometer !== booking.endOdometer ? input.endOdometer : null;
    const currentFuel = booking.fuelRecord?.returnFuelLevel ?? null;
    const fuelChange =
      input.returnFuelLevel !== undefined && input.returnFuelLevel !== currentFuel ? input.returnFuelLevel : null;
    const fastagChange = sameMoney(booking.returnFastagBalance, input.returnFastagBalance)
      ? null
      : input.returnFastagBalance!;
    if (fastagChange != null) {
      const legs = await getFastagLegs(booking.id, null);
      if (!legs[legs.length - 1]?.hasFastag) {
        throw new EditRejection(StatusCode.BAD_REQUEST, {
          code: "NO_FASTAG",
          message: "This car has no FASTag, so there's no balance to record.",
          field: "returnFastagBalance",
        });
      }
    }
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

    // Drop damage: notes and photos only
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
      const changes = area != null || description != null || severity != null || removedPhotos.length > 0 || addedIds.length > 0;
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
      return { report, notes, area, description, severity, removedPhotos, keptPhotos, addedIds, changes };
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

    if (endChange == null && !fuelChange && fastagChange == null && !photosChange && changedDamages.length === 0) {
      return res.status(StatusCode.OK).json({
        message: "Nothing to change",
        changed: [],
        data: await buildReturnSummary(booking),
      });
    }

    await prisma.$transaction(
      async (tx) => {
        await lockBookingForDrop(tx as any, booking.id);
        const locked = await tx.booking.findUniqueOrThrow({
          where: { id: booking.id },
          select: {
            status: true,
            requiresManagerConfirmation: true,
            endOdometer: true,
            freeKmLimit: true,
            returnFastagBalance: true,
          },
        });
        if (!isDone(returnQueueState(locked))) throw new EditRejection(StatusCode.CONFLICT, NOT_COMPLETED.RETURN);

        const update: Prisma.BookingUpdateInput = {};

        if (endChange != null) {
          const segments = await getOdometerSegments(booking.id, tx as any);
          const problem = endOdometerProblem(segments, endChange);
          if (problem) {
            throw new EditRejection(StatusCode.BAD_REQUEST, { code: "END_ODOMETER_TOO_LOW", message: problem, field: "endOdometer" });
          }
          // The drop measured km with the old reading (or none), with the free km and rate
          // it billed: only a change that gives the same charge
          const allowance = await loadBilledKmAllowance(tx, booking.id);
          const check = { segmentsBefore: segments, segmentsAfter: segments, endBefore: locked.endOdometer, endAfter: endChange };
          if (kmEditChangesCharges(check, (s, end) => billedKmCharge(allowance, s, end).charge)) {
            throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "endOdometer" });
          }
          update.endOdometer = endChange;
          const km = billedKmCharge(allowance, segments, endChange);
          // After a swap without readings km stays unknown and the staff-entered extra km stays
          if (km.measured) {
            update.totalKmDriven = km.kmDriven;
            update.extraKmCharged = km.extraKm;
            if (locked.freeKmLimit == null && allowance.includedKm != null) update.freeKmLimit = allowance.includedKm;
          }
        }

        if (fuelChange) {
          const record = await tx.fuelRecord.findUniqueOrThrow({
            where: { bookingId: booking.id },
            select: { pickupFuelLevel: true },
          });
          // The fuel the returned car started with: after a swap with readings, the replacement's
          const startFuel = (await getOdometerSegments(booking.id, tx as any)).currentStartFuelLevel ?? record.pickupFuelLevel;
          if (
            fuelEditChangesCharges({
              levelBasedFuelCharge: await hasLevelBasedFuelCharge(tx, booking.id),
              before: { pickupLevel: startFuel, returnLevel: currentFuel },
              after: { pickupLevel: startFuel, returnLevel: fuelChange },
            })
          ) {
            throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "returnFuelLevel" });
          }
          await tx.fuelRecord.update({
            where: { bookingId: booking.id },
            data: {
              returnFuelLevel: fuelChange,
              ...(currentFuel == null && { returnAt: booking.returnedAt ?? new Date(), capturedByReturnId: actor.id }),
            },
          });
        }

        if (fastagChange != null) {
          // The drop billed FASTag from this reading (or typed it when one was missing)
          const before = await getFastagLegs(booking.id, money(locked.returnFastagBalance), tx as any);
          const after = await getFastagLegs(booking.id, new Decimal(fastagChange), tx as any);
          if (fastagEditChangesCharges(calculateFastagUsage(before), calculateFastagUsage(after))) {
            throw new EditRejection(StatusCode.CONFLICT, { ...EDIT_CHANGES_CHARGES, field: "returnFastagBalance" });
          }
          update.returnFastagBalance = fastagChange.toFixed(2);
        }

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
            },
          });
        }

        if (Object.keys(update).length > 0) {
          await tx.booking.update({ where: { id: booking.id }, data: update });
        }
      },
      { timeout: 20000 },
    );

    const damageState = (plan: (typeof changedDamages)[number], after: boolean) => ({
      publicId: plan.report.publicId,
      area: after ? plan.area ?? String(plan.notes.area ?? "") : String(plan.notes.area ?? ""),
      description: after ? plan.description ?? String(plan.notes.description ?? "") : String(plan.notes.description ?? ""),
      severity: after ? plan.severity ?? plan.report.severity : plan.report.severity,
      photos: after
        ? [...plan.keptPhotos.map((p) => p.file.publicId), ...plan.addedIds]
        : [...plan.keptPhotos, ...plan.removedPhotos].map((p) => p.file.publicId),
    });
    const diff = changedFields(
      {
        endOdometer: booking.endOdometer,
        returnFuelLevel: currentFuel,
        fastagBalance: money(booking.returnFastagBalance)?.toFixed(2) ?? null,
        photos: photoList(existing.map((p) => ({ fileId: p.file.publicId }))),
        damages: changedDamages.map((p) => damageState(p, false)),
      } as Record<string, unknown>,
      {
        endOdometer: endChange ?? undefined,
        returnFuelLevel: fuelChange ?? undefined,
        fastagBalance: fastagChange != null ? fastagChange.toFixed(2) : undefined,
        photos: photosChange
          ? photoList([...kept.map((p) => ({ fileId: p.file.publicId })), ...toAdd.map((fileId) => ({ fileId }))])
          : undefined,
        damages: changedDamages.length ? changedDamages.map((p) => damageState(p, true)) : undefined,
      },
    );
    await logEdit(req, actor, "RETURN", booking.publicId, diff);

    const fresh = await loadBooking(booking.publicId, branchId);
    return res.status(StatusCode.OK).json({
      message: "Return updated",
      changed: diff.fields,
      data: await buildReturnSummary(fresh!),
    });
  } catch (error) {
    return sendError(res, error, "EditReturn");
  }
};
