/**
 * Driving licence custody status (#3) — what the branch did with the
 * customer's original licence at pickup: COLLECTED, NOT_COLLECTED or DEPOSIT
 * (something else was left instead, described in dlDepositNote).
 *
 * One home for the rules shared by both pickup paths (legacy pickup and the
 * pickup payment session) and the Fleet / Branch Manager update endpoints.
 * licenseCollectedAt stays the "licence first taken" timestamp: it is written
 * once, for COLLECTED and DEPOSIT, and never cleared — km-allowance uses it as
 * a pickup-time marker for the vehicle-swap check.
 */
import type { Request } from "express";
import { prisma, BookingStatus, Role } from "@repo/database/client";
import type { DlCollectionStatus } from "@repo/database/client";
import {
  DL_STATUS_LABELS,
  DL_STATUS_INVALID_MESSAGE,
  DL_DEPOSIT_NOTE_REQUIRED_MESSAGE,
  DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE,
  dlStatusNeedsNote,
  updateDlStatusSchema,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { redis } from "../../lib/redisconfig.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../staffActivity/staffActivity.service.js";

export type DlStatusErrorCode =
  | "LICENSE_NOT_COLLECTED"
  | "INVALID_DL_STATUS"
  | "DL_DEPOSIT_NOTE_REQUIRED"
  | "DL_DEPOSIT_NOTE_TOO_LONG"
  | "BOOKING_NOT_FOUND"
  | "DL_STATUS_LOCKED"
  | "UNAUTHORIZED";

export class DlStatusError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: DlStatusErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DlStatusError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

export interface DlStatusChoice {
  dlStatus: DlCollectionStatus;
  /** Only kept for DEPOSIT; null otherwise. */
  dlDepositNote: string | null;
}

/** Booking statuses Fleet (STAFF) may change the DL status in. Managers: any status. */
export const STAFF_DL_EDITABLE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

export function dlStatusLabel(status: DlCollectionStatus | null | undefined): string {
  return status ? DL_STATUS_LABELS[status] : "Not recorded";
}

/**
 * Maps a zod failure on dlStatus / dlDepositNote to the API error, or null when
 * the failure is about some other field. Typed structurally: the backend (zod 4)
 * and @repo/schemas (zod 3) produce different ZodError classes.
 */
export function dlValidationError(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): DlStatusError | null {
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "dlStatus") {
      return new DlStatusError(StatusCode.BAD_REQUEST, "INVALID_DL_STATUS", DL_STATUS_INVALID_MESSAGE);
    }
    if (field === "dlDepositNote") {
      return issue.message === DL_DEPOSIT_NOTE_REQUIRED_MESSAGE
        ? new DlStatusError(StatusCode.BAD_REQUEST, "DL_DEPOSIT_NOTE_REQUIRED", DL_DEPOSIT_NOTE_REQUIRED_MESSAGE)
        : new DlStatusError(StatusCode.BAD_REQUEST, "DL_DEPOSIT_NOTE_TOO_LONG", DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE);
    }
  }
  return null;
}

/**
 * What a pickup request says about the licence. Recording it is OPTIONAL (X1):
 * it never blocks the handover. Throws DlStatusError only for a DEPOSIT without a note.
 *  - dlStatus sent           → that status (DEPOSIT needs a note); licenseCollected is ignored
 *  - licenseCollected: true  → COLLECTED (old builds' tick)
 *  - licenseCollected: false → NOT_COLLECTED (old builds' unticked box)
 *  - neither sent (or null)  → null: left unset, nothing recorded (can be set later)
 */
export function resolvePickupDlStatus(input: {
  dlStatus?: DlCollectionStatus | null;
  dlDepositNote?: string | null;
  licenseCollected?: boolean;
}): DlStatusChoice | null {
  if (input.dlStatus) {
    const note = input.dlDepositNote?.trim() || null;
    if (dlStatusNeedsNote(input.dlStatus) && !note) {
      throw new DlStatusError(
        StatusCode.BAD_REQUEST,
        "DL_DEPOSIT_NOTE_REQUIRED",
        DL_DEPOSIT_NOTE_REQUIRED_MESSAGE,
      );
    }
    return {
      dlStatus: input.dlStatus,
      dlDepositNote: dlStatusNeedsNote(input.dlStatus) ? note : null,
    };
  }
  if (input.licenseCollected === true) {
    return { dlStatus: "COLLECTED", dlDepositNote: null };
  }
  if (input.licenseCollected === false) {
    return { dlStatus: "NOT_COLLECTED", dlDepositNote: null };
  }
  return null;
}

/**
 * Booking update fragment recording a DL status choice by `actorId`.
 * licenseCollectedAt/ById are set only when the licence (or a deposit) is
 * taken for the first time and `stampLicenseCollected` allows it.
 */
export function dlStatusUpdateData(
  choice: DlStatusChoice,
  actorId: number,
  current: { licenseCollectedAt: Date | null },
  stampLicenseCollected = true,
  now: Date = new Date(),
) {
  const taken = choice.dlStatus !== "NOT_COLLECTED";
  return {
    dlStatus: choice.dlStatus,
    dlDepositNote: choice.dlDepositNote,
    dlStatusUpdatedAt: now,
    dlStatusUpdatedById: actorId,
    ...(taken && stampLicenseCollected && !current.licenseCollectedAt
      ? { licenseCollectedAt: now, licenseCollectedById: actorId }
      : {}),
  };
}

/**
 * Drops the cached booking lists that show the DL status (Fleet pickup /
 * return lists, BM active + picked-up lists), so a change shows at once.
 */
export async function invalidateDlStatusListCaches(branchId: number): Promise<void> {
  const patterns = [
    `bookings:${branchId}:*`,
    `returns:${branchId}:*`,
    `branch:${branchId}:active_bookings:*`,
    `branch:${branchId}:pending_approvals:*`,
  ];
  try {
    for (const pattern of patterns) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    }
  } catch (err) {
    console.warn("[dl-status] List cache invalidation failed (non-fatal):", err);
  }
}

export interface DlStatusUpdateResult {
  changed: boolean;
  booking: {
    publicId: string;
    status: BookingStatus;
    dlStatus: DlCollectionStatus | null;
    dlDepositNote: string | null;
    dlStatusUpdatedAt: Date | null;
    dlStatusUpdatedBy: { publicId: string; name: string; role: Role } | null;
    licenseCollectedAt: Date | null;
  };
}

/**
 * PATCH …/bookings/:publicId/dl-status for Fleet (STAFF) and Branch Manager
 * (MANAGER). The booking must belong to the actor's branch. STAFF may change
 * it only while the booking is CONFIRMED or PICKED_UP; MANAGER at any status.
 * Throws DlStatusError.
 */
export async function updateBookingDlStatus(
  req: Request,
  bookingPublicId: string,
  actorRole: "STAFF" | "MANAGER",
): Promise<DlStatusUpdateResult> {
  const parsed = updateDlStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw (
      dlValidationError(parsed.error) ??
      new DlStatusError(StatusCode.BAD_REQUEST, "INVALID_DL_STATUS", DL_STATUS_INVALID_MESSAGE)
    );
  }
  const choice: DlStatusChoice = {
    dlStatus: parsed.data.dlStatus as DlCollectionStatus,
    dlDepositNote: dlStatusNeedsNote(parsed.data.dlStatus) ? parsed.data.dlDepositNote ?? null : null,
  };

  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) {
    throw new DlStatusError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "Your session has expired. Please log in again.");
  }

  const booking = await prisma.booking.findFirst({
    where: { publicId: bookingPublicId, branchId: req.branch_Id },
    select: {
      id: true,
      publicId: true,
      status: true,
      dlStatus: true,
      dlDepositNote: true,
      dlStatusUpdatedAt: true,
      dlStatusUpdatedById: true,
      licenseCollectedAt: true,
    },
  });
  if (!booking) {
    throw new DlStatusError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found at your branch.");
  }

  if (actorRole === "STAFF" && !STAFF_DL_EDITABLE_STATUSES.includes(booking.status)) {
    throw new DlStatusError(
      StatusCode.CONFLICT,
      "DL_STATUS_LOCKED",
      `The DL status can only be changed while the booking is confirmed or on trip (this one is ${booking.status.replace(/_/g, " ").toLowerCase()}). Ask your branch manager to update it.`,
    );
  }

  const unchanged =
    booking.dlStatus === choice.dlStatus && (booking.dlDepositNote ?? null) === choice.dlDepositNote;

  if (unchanged) {
    const updatedBy = booking.dlStatusUpdatedById
      ? await prisma.user.findUnique({
          where: { id: booking.dlStatusUpdatedById },
          select: { publicId: true, name: true, role: true },
        })
      : null;
    return {
      changed: false,
      booking: {
        publicId: booking.publicId,
        status: booking.status,
        dlStatus: booking.dlStatus,
        dlDepositNote: booking.dlDepositNote,
        dlStatusUpdatedAt: booking.dlStatusUpdatedAt,
        dlStatusUpdatedBy: updatedBy,
        licenseCollectedAt: booking.licenseCollectedAt,
      },
    };
  }

  // Before pickup the licence isn't physically held yet — the pickup itself
  // stamps licenseCollectedAt, so it keeps marking the handover time.
  const now = new Date();
  const data = dlStatusUpdateData(
    choice,
    actor.id,
    booking,
    booking.status !== BookingStatus.CONFIRMED,
    now,
  );

  const updated = await prisma.booking.updateMany({
    where: {
      id: booking.id,
      ...(actorRole === "STAFF" && { status: { in: STAFF_DL_EDITABLE_STATUSES } }),
    },
    data,
  });
  if (updated.count === 0) {
    throw new DlStatusError(
      StatusCode.CONFLICT,
      "DL_STATUS_LOCKED",
      "This booking changed while you were updating it. Refresh and try again.",
    );
  }

  const from = dlStatusLabel(booking.dlStatus);
  const to = dlStatusLabel(choice.dlStatus);
  const noteSuffix = choice.dlDepositNote ? ` (${choice.dlDepositNote})` : "";

  await Promise.all([
    auditService
      .log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: "BOOKING_DL_STATUS_UPDATED",
        category: AuditCategory.BOOKING,
        description: `DL status for booking ${booking.publicId} changed from ${from} to ${to}${noteSuffix}`,
        entity: "Booking",
        entityId: booking.publicId,
        entityLabel: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        before: { dlStatus: booking.dlStatus, dlDepositNote: booking.dlDepositNote },
        after: { dlStatus: choice.dlStatus, dlDepositNote: choice.dlDepositNote },
        metadata: { bookingStatus: booking.status },
      })
      .catch((err) => console.error("[dl-status] Audit log error (non-fatal):", err)),
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: `DL status for booking ${booking.publicId} set to ${to}${noteSuffix} (was ${from})`,
      metadata: {
        from: booking.dlStatus,
        to: choice.dlStatus,
        dlDepositNote: choice.dlDepositNote,
        bookingStatus: booking.status,
      },
    }),
    invalidateDlStatusListCaches(req.branch_Id),
  ]);

  return {
    changed: true,
    booking: {
      publicId: booking.publicId,
      status: booking.status,
      dlStatus: choice.dlStatus,
      dlDepositNote: choice.dlDepositNote,
      dlStatusUpdatedAt: now,
      dlStatusUpdatedBy: { publicId: actor.publicId, name: actor.name, role: actor.role },
      licenseCollectedAt: data.licenseCollectedAt ?? booking.licenseCollectedAt,
    },
  };
}
