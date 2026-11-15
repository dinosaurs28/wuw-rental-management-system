/**
 * Rules for moving a vehicle from one branch to another (Nov 14 2026, client:
 * "Vehicle transfer from one branch to another"). Pure — no database — so they
 * are unit-tested (vehicle-transfer-rules.test.ts). The service reads the state
 * under the vehicle's row lock (vehicle-transfer.service.ts) and asks here.
 *
 * Who: an admin moves any vehicle; a branch manager moves a vehicle of their own
 * branch (to any other branch).
 *
 * Refused (409) while the car is busy at its branch:
 *   - out on rent (a PICKED_UP booking, or set Out for Rental),
 *   - a HOLD (not lapsed) / CONFIRMED booking that hasn't ended — cancel, swap
 *     or finish it first (the booking belongs to the old branch),
 *   - in maintenance, or a drop damage awaiting the manager's review,
 *   - a drop / adjustment bill still open, or a pickup / drop form saved but
 *     not finished (operation draft) on one of its bookings.
 * The target branch must exist, not be deleted, and differ from the current
 * one. A reason is required; an odometer reading is optional (not below the
 * car's recorded reading).
 */
import { StatusCode } from "../../types/statusCode.js";

export const TRANSFER_REASON_MIN = 3;
export const TRANSFER_REASON_MAX = 500;
/** Highest odometer reading accepted (km). */
export const TRANSFER_ODOMETER_MAX = 9_999_999;

export type VehicleTransferErrorCode =
  | "INVALID_INPUT"
  | "VEHICLE_NOT_FOUND"
  | "VEHICLE_NOT_IN_BRANCH"
  | "TARGET_BRANCH_NOT_FOUND"
  | "TARGET_BRANCH_INACTIVE"
  | "SAME_BRANCH"
  | "VEHICLE_ON_RENT"
  | "VEHICLE_HAS_BOOKINGS"
  | "VEHICLE_IN_MAINTENANCE"
  | "DAMAGE_REVIEW_PENDING"
  | "OPERATION_UNSETTLED"
  | "ODOMETER_BELOW_CURRENT";

export class VehicleTransferError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: VehicleTransferErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VehicleTransferError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...(this.details ?? {}) };
  }
}

export interface TransferBody {
  /** Target branch publicId */
  toBranchId: string;
  reason: string;
  odometer: number | null;
}

/** Validates the request body: { toBranchId, reason, odometer? }. */
export function parseTransferBody(raw: unknown): TransferBody | VehicleTransferError {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bad = (message: string, field: string) =>
    new VehicleTransferError(StatusCode.BAD_REQUEST, "INVALID_INPUT", message, { field });

  const toBranchId = typeof body.toBranchId === "string" ? body.toBranchId.trim() : "";
  if (!toBranchId) return bad("Choose the branch to transfer the vehicle to.", "toBranchId");

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < TRANSFER_REASON_MIN) {
    return bad(`Enter the reason for the transfer (at least ${TRANSFER_REASON_MIN} characters).`, "reason");
  }
  if (reason.length > TRANSFER_REASON_MAX) {
    return bad(`The reason can be at most ${TRANSFER_REASON_MAX} characters.`, "reason");
  }

  let odometer: number | null = null;
  const rawOdo = body.odometer;
  if (rawOdo !== undefined && rawOdo !== null && rawOdo !== "") {
    const n = typeof rawOdo === "number" ? rawOdo : typeof rawOdo === "string" ? Number(rawOdo.trim()) : Number.NaN;
    if (!Number.isInteger(n) || n < 0 || n > TRANSFER_ODOMETER_MAX) {
      return bad("The odometer reading must be a whole number of km.", "odometer");
    }
    odometer = n;
  }
  return { toBranchId, reason, odometer };
}

export interface TransferActor {
  role: "ADMIN" | "MANAGER";
  /** The manager's branch (null for an admin) */
  branchId: number | null;
}

export interface TransferState {
  vehicle: { branchId: number; status: string; deletedAt: Date | null; odo: number } | null;
  actor: TransferActor;
  target: { id: number; deletedAt: Date | null } | null;
  /** A PICKED_UP booking with this car */
  onRentBookingPublicId: string | null;
  /** HOLD (not lapsed) / CONFIRMED bookings with this car that haven't ended, earliest first */
  upcomingBookings: Array<{ publicId: string; status: string; startAt: Date }>;
  /** Open drop (RETURN) / ADJUSTMENT bills on its bookings */
  openBillCount: number;
  /** Saved, unfinished pickup / drop forms on its bookings */
  openDraftCount: number;
  /** A drop damage awaiting the manager's review */
  pendingDropDamage: boolean;
  odometer: number | null;
}

const fmtDate = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Why the vehicle can't be transferred now, or null when it can. First problem wins. */
export function transferRefusal(s: TransferState): VehicleTransferError | null {
  if (!s.vehicle || s.vehicle.deletedAt) {
    return new VehicleTransferError(StatusCode.NOT_FOUND, "VEHICLE_NOT_FOUND", "Vehicle not found.");
  }
  if (s.actor.role === "MANAGER" && s.vehicle.branchId !== s.actor.branchId) {
    return new VehicleTransferError(
      StatusCode.FORBIDDEN,
      "VEHICLE_NOT_IN_BRANCH",
      "You can only transfer vehicles of your own branch.",
    );
  }
  if (!s.target) {
    return new VehicleTransferError(StatusCode.NOT_FOUND, "TARGET_BRANCH_NOT_FOUND", "The branch to transfer to was not found.");
  }
  if (s.target.deletedAt) {
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "TARGET_BRANCH_INACTIVE",
      "The branch to transfer to is no longer active.",
    );
  }
  if (s.target.id === s.vehicle.branchId) {
    return new VehicleTransferError(StatusCode.CONFLICT, "SAME_BRANCH", "The vehicle is already at this branch.");
  }
  if (s.onRentBookingPublicId || s.vehicle.status === "OUT_FOR_RENTAL") {
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "VEHICLE_ON_RENT",
      "The vehicle is out on rent. Transfer it after it is returned.",
      s.onRentBookingPublicId ? { bookingId: s.onRentBookingPublicId } : undefined,
    );
  }
  if (s.upcomingBookings.length > 0) {
    const first = s.upcomingBookings[0]!;
    const n = s.upcomingBookings.length;
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "VEHICLE_HAS_BOOKINGS",
      `The vehicle has ${n} upcoming booking${n === 1 ? "" : "s"} (next: ${first.publicId}, ${fmtDate(first.startAt)}). ` +
        "Cancel or swap them to another vehicle first.",
      { bookingIds: s.upcomingBookings.map((b) => b.publicId) },
    );
  }
  if (s.vehicle.status === "MAINTENANCE") {
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "VEHICLE_IN_MAINTENANCE",
      "The vehicle is in maintenance. Close the maintenance (set it Available or Inactive) before transferring.",
    );
  }
  if (s.vehicle.status === "MANAGER_REPORTED" || s.pendingDropDamage) {
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "DAMAGE_REVIEW_PENDING",
      "A drop damage on this vehicle is awaiting the manager's review. Review it before transferring.",
    );
  }
  if (s.openBillCount > 0 || s.openDraftCount > 0) {
    return new VehicleTransferError(
      StatusCode.CONFLICT,
      "OPERATION_UNSETTLED",
      s.openBillCount > 0
        ? "A drop or adjustment bill on this vehicle is still open. Settle it before transferring."
        : "A pickup or drop form for this vehicle is saved but not finished. Finish or discard it before transferring.",
    );
  }
  if (s.odometer != null && s.odometer < s.vehicle.odo) {
    return new VehicleTransferError(
      StatusCode.BAD_REQUEST,
      "ODOMETER_BELOW_CURRENT",
      `The odometer reading can't be below the vehicle's recorded reading (${s.vehicle.odo} km).`,
      { field: "odometer" },
    );
  }
  return null;
}

/** HOLD that hasn't lapsed or CONFIRMED, ending after `now`: blocks a transfer. */
export function isUpcomingBooking(
  b: { status: string; endAt: Date; holdExpiresAt: Date | null },
  now: Date,
): boolean {
  if (b.endAt.getTime() <= now.getTime()) return false;
  if (b.status === "CONFIRMED") return true;
  if (b.status === "HOLD") return b.holdExpiresAt == null || b.holdExpiresAt.getTime() > now.getTime();
  return false;
}

/** Remove one id from an id array (festival rule / booking lock vehicleIds). Null when absent. */
export function withoutId(ids: number[], id: number): number[] | null {
  return ids.includes(id) ? ids.filter((x) => x !== id) : null;
}
