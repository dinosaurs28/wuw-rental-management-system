/**
 * The swap availability rule (swap-availability.ts) run against the data —
 * shared by the swap candidate list, the swap commit (inside its transaction,
 * after the vehicle rows are locked) and the extension "swap to another
 * vehicle" / "reassign the next booking" options and commits.
 */
import { prisma, BookingStatus, Prisma } from "@repo/database/client";
import { explainUnavailableVehicles } from "../../utils/availability/availabilityBatch.js";
import { automaticGraceMinutes } from "../../utils/availability/vehicleEligibility.js";
import {
  classifySwapCandidates,
  swapAvailabilityWindow,
  type SwapAvailabilityStage,
  type SwapExclusion,
  type SwapWindow,
} from "./swap-availability.js";

type Db = Prisma.TransactionClient;

/** The booking fields the swap window is worked out from. */
export interface SwapWindowBooking {
  id: number;
  publicId: string;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  branchId: number;
  frozenChargeConfig: Prisma.JsonValue | null;
}

export const SWAP_WINDOW_BOOKING_SELECT = {
  id: true,
  publicId: true,
  status: true,
  startAt: true,
  endAt: true,
  branchId: true,
  frozenChargeConfig: true,
} satisfies Prisma.BookingSelect;

/**
 * swapAvailabilityWindow for a booking, with its automatic grace (frozen
 * charge config, else the branch's live one) for a rental already out.
 * `opts.turnaroundMs` replaces the default 3 h turnaround (an extension swap
 * passes its own buffer).
 */
export async function swapWindowFor(
  booking: SwapWindowBooking,
  now: Date,
  availabilityEndAt?: Date | null,
  db: Db = prisma,
  opts: { turnaroundMs?: number | null } = {},
): Promise<SwapWindow> {
  let graceMinutes: number | null = null;
  if (booking.status === BookingStatus.PICKED_UP) {
    const live = await db.branchChargeConfig.findUnique({
      where: { branchId: booking.branchId },
      select: { gracePolicyEnabled: true, graceType: true, graceMinutes: true },
    });
    graceMinutes = automaticGraceMinutes(booking.frozenChargeConfig, live);
  }
  return swapAvailabilityWindow(booking, now, { availabilityEndAt, graceMinutes, turnaroundMs: opts.turnaroundMs });
}

export function swapStageOf(status: BookingStatus): SwapAvailabilityStage {
  return status === BookingStatus.PICKED_UP ? "ACTIVE_RENTAL" : "PRE_PICKUP";
}

/**
 * Which of `vehicles` can take over `booking` for `window`, and why the rest
 * can't. The booking's own rows and its own Redis hold never count against a
 * car. Pass the transaction client when the vehicle rows are locked: the
 * booking rule then reads through it (HOLD rows included either way).
 */
export async function classifyReplacements<
  V extends {
    id: number;
    publicId: string;
    status: string;
    insuranceExpiry: Date | string | null;
    category: { name: string; rank: number };
  },
>(
  vehicles: V[],
  ctx: {
    booking: Pick<SwapWindowBooking, "id" | "publicId" | "status">;
    currentRank: number;
    window: SwapWindow;
    now: Date;
    db?: Db;
  },
): Promise<{ free: V[]; excluded: Array<{ vehicle: V; exclusion: SwapExclusion }> }> {
  if (vehicles.length === 0) return { free: [], excluded: [] };
  const db = ctx.db ?? prisma;
  const ids = vehicles.map((v) => v.id);
  const [rentals, blockers] = await Promise.all([
    db.bookingItem.findMany({
      where: { vehicleId: { in: ids }, booking: { status: BookingStatus.PICKED_UP, id: { not: ctx.booking.id } } },
      select: { vehicleId: true },
    }),
    explainUnavailableVehicles(
      ids,
      ctx.window.start,
      ctx.window.end,
      new Map(vehicles.map((v) => [v.id, v.publicId])),
      {
        db,
        includeHoldRows: true,
        excludeBookingId: ctx.booking.id,
        excludeHoldIds: new Set([ctx.booking.publicId]),
        turnaroundMs: ctx.window.turnaroundMs,
        now: ctx.now,
        // A swap is a staff action: customers-only booking locks don't apply
        forStaff: true,
      },
    ),
  ]);
  return classifySwapCandidates(vehicles, {
    stage: swapStageOf(ctx.booking.status),
    currentRank: ctx.currentRank,
    window: ctx.window,
    onRental: new Set(rentals.map((r) => r.vehicleId)),
    blockers,
  });
}
