import {
  prisma,
  BookingStatus,
  type DlCollectionStatus,
  ExtensionStatus,
  PaymentSessionStatus,
  PaymentSessionType,
  Prisma,
} from "@repo/database/client";
import { TimezoneService } from "../timezone/timezone.service.js";
import {
  DEFAULT_FROZEN_CHARGE_CONFIG,
  type FrozenChargeConfig,
} from "../../types/charge-engine.types.js";
import {
  bookingListTypeOf,
  bookingTypeWhere,
  type BookingListType,
} from "../../utils/booking/bookingTypeFilter.js";
import { draftSummaryLookup, type OperationDraftSummary } from "./operation-draft.service.js";

/**
 * Overdue / no-show return list (#8) shared by Fleet (STAFF) and the Branch
 * Manager. A booking is on the list while it is PICKED_UP and its endAt has
 * passed. "Overdue" is a computed state — there is no OVERDUE BookingStatus.
 *
 * A PICKED_UP booking can already be physically back: the legacy drop left it
 * waiting for the manager's confirmation, or a Unified-Payments RETURN session
 * is settling. Those stay listed (greyed by the client) but are kept out of
 * the overdue count. No Redis cache: a returned or extended booking must drop
 * off on the next fetch.
 */

export type ReturnState =
  | "OVERDUE"
  | "IN_GRACE"
  | "AWAITING_MANAGER_CONFIRMATION"
  | "RETURN_IN_PROGRESS";

export const OVERDUE_DEFAULT_LIMIT = 50;
export const OVERDUE_MAX_LIMIT = 200;

/**
 * PaymentSession.expiresAt is never set today, so a RETURN session nobody has
 * touched for this long is treated as abandoned — a stuck drop bill must not
 * hide a vehicle that never came back.
 */
export const RETURN_SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const SETTLED_SESSION_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.COMPLETED,
  PaymentSessionStatus.ABANDONED,
];

const OPEN_EXTENSION_STATUSES: ExtensionStatus[] = [
  ExtensionStatus.PENDING_PAYMENT,
  ExtensionStatus.PAYMENT_COLLECTED,
];

export interface OverdueCounts {
  OVERDUE: number;
  IN_GRACE: number;
  AWAITING_MANAGER_CONFIRMATION: number;
  RETURN_IN_PROGRESS: number;
  total: number;
}

export interface OverdueReturnRow {
  publicId: string;
  bookingType: BookingListType;
  rentalPeriodType: string | null;
  days: number;
  startAt: Date;
  endAt: Date;
  originalEndAt: Date | null;
  endAtDisplay: string;
  overdueMinutes: number;
  returnState: ReturnState;
  /** AUTOMATIC grace that waives the late charge; null = no automatic grace (off or MANUAL). */
  graceMinutes: number | null;
  graceEndsAt: Date | null;
  /** Licence held at pickup (#3); null = not recorded (old pickups). */
  dlStatus: DlCollectionStatus | null;
  /** What the customer left instead (dlStatus DEPOSIT only). */
  dlDepositNote: string | null;
  extensionCount: number;
  extensionPending: boolean;
  pendingExtension: { publicId: string; status: ExtensionStatus; requestedEndAt: Date } | null;
  customer: {
    publicId: string | null;
    name: string | null;
    phone: string | null;
    alternatePhone: string | null;
    /** Staff-only: full DL number on file, to check against the licence held. */
    drivingLicenceNumber: string | null;
  };
  vehicles: Array<{
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    imageUrl: string | null;
  }>;
  /** A drop paused half-way by Fleet (client item 2); null when none. */
  draft: OperationDraftSummary | null;
}

export interface OverdueReturnsResult {
  data: OverdueReturnRow[];
  overdueCount: number;
  counts: OverdueCounts;
  serverNow: string;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface OverdueListParams {
  page?: number;
  limit?: number;
  type?: BookingListType;
  now?: Date;
}

const overdueWhere = (
  branchId: number,
  now: Date,
  type: BookingListType | undefined,
): Prisma.BookingWhereInput => ({
  branchId,
  status: BookingStatus.PICKED_UP,
  endAt: { lt: now },
  deletedAt: null,
  ...bookingTypeWhere(type),
});

type GracePolicyKeys = Pick<FrozenChargeConfig, "gracePolicyEnabled" | "graceType" | "graceMinutes">;

/**
 * Grace that waives the late charge on its own: the AUTOMATIC grace minutes,
 * else null. Resolved like the drop bill (resolveLateReturnPolicy): each key
 * from the booking's frozen config, else the live branch config, else the
 * defaults. MANUAL grace is only deducted when staff tick "Apply grace" at the
 * drop, so the charge runs from endAt and the row is OVERDUE, not IN_GRACE.
 */
const autoGraceMinutesOf = (
  frozenChargeConfig: Prisma.JsonValue | null,
  live: GracePolicyKeys | null,
): number | null => {
  const frozen = (frozenChargeConfig ?? null) as Partial<FrozenChargeConfig> | null;
  const pick = <K extends keyof GracePolicyKeys>(key: K): GracePolicyKeys[K] =>
    (frozen?.[key] ?? live?.[key] ?? DEFAULT_FROZEN_CHARGE_CONFIG[key]) as GracePolicyKeys[K];
  const minutes = Number(pick("graceMinutes"));
  if (!pick("gracePolicyEnabled") || pick("graceType") !== "AUTOMATIC") return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes;
};

/** Also used by the RETURN_OVERDUE notification scan, so both agree on "drop in progress". */
export const isLiveReturnSession = (
  session: { sessionType: PaymentSessionType; status: PaymentSessionStatus; expiresAt: Date | null; updatedAt: Date } | null,
  now: Date,
): boolean => {
  if (!session || session.sessionType !== PaymentSessionType.RETURN) return false;
  if (SETTLED_SESSION_STATUSES.includes(session.status)) return false;
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - session.updatedAt.getTime() < RETURN_SESSION_STALE_AFTER_MS;
};

interface ClassifiedBooking {
  id: number;
  overdueMs: number;
  returnState: ReturnState;
  graceMinutes: number | null;
}

/**
 * Every overdue PICKED_UP booking of the branch, most overdue first, with its
 * computed returnState. Light select — the page's details are loaded after.
 */
const classifyOverdue = async (
  branchId: number,
  now: Date,
  type: BookingListType | undefined,
): Promise<ClassifiedBooking[]> => {
  const rows = await prisma.booking.findMany({
    where: overdueWhere(branchId, now, type),
    select: {
      id: true,
      endAt: true,
      requiresManagerConfirmation: true,
      frozenChargeConfig: true,
      branch: {
        select: {
          chargeConfig: { select: { gracePolicyEnabled: true, graceType: true, graceMinutes: true } },
        },
      },
      activePaymentSession: {
        select: { sessionType: true, status: true, expiresAt: true, updatedAt: true },
      },
    },
    orderBy: [{ endAt: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => {
    const overdueMs = now.getTime() - row.endAt.getTime();
    const graceMinutes = autoGraceMinutesOf(row.frozenChargeConfig, row.branch.chargeConfig);
    let returnState: ReturnState;
    if (row.requiresManagerConfirmation) {
      returnState = "AWAITING_MANAGER_CONFIRMATION";
    } else if (isLiveReturnSession(row.activePaymentSession, now)) {
      returnState = "RETURN_IN_PROGRESS";
    } else if (graceMinutes !== null && overdueMs <= graceMinutes * 60_000) {
      returnState = "IN_GRACE";
    } else {
      returnState = "OVERDUE";
    }
    return { id: row.id, overdueMs, returnState, graceMinutes };
  });
};

const countStates = (classified: ClassifiedBooking[]): OverdueCounts => {
  const counts: OverdueCounts = {
    OVERDUE: 0,
    IN_GRACE: 0,
    AWAITING_MANAGER_CONFIRMATION: 0,
    RETURN_IN_PROGRESS: 0,
    total: classified.length,
  };
  for (const row of classified) counts[row.returnState] += 1;
  return counts;
};

/** Vehicles not back yet: OVERDUE + IN_GRACE (excludes awaiting / in-progress returns). */
const overdueCountOf = (counts: OverdueCounts): number => counts.OVERDUE + counts.IN_GRACE;

/** Badge count for dashboards: overdue vehicles that are not back yet. */
export const countOverdueReturns = async (
  branchId: number,
  now: Date = new Date(),
  type?: BookingListType,
): Promise<number> => overdueCountOf(countStates(await classifyOverdue(branchId, now, type)));

/** Clamp page/limit query params (defaults 1 / 50, limit max 200). */
export const parseOverduePaging = (rawPage: unknown, rawLimit: unknown): { page: number; limit: number } => {
  const page = Math.max(1, parseInt(String(rawPage ?? ""), 10) || 1);
  const limit = Math.min(
    OVERDUE_MAX_LIMIT,
    Math.max(1, parseInt(String(rawLimit ?? ""), 10) || OVERDUE_DEFAULT_LIMIT),
  );
  return { page, limit };
};

export const listOverdueReturns = async (
  branchId: number,
  params: OverdueListParams = {},
): Promise<OverdueReturnsResult> => {
  const now = params.now ?? new Date();
  const page = params.page ?? 1;
  const limit = params.limit ?? OVERDUE_DEFAULT_LIMIT;

  const classified = await classifyOverdue(branchId, now, params.type);
  const counts = countStates(classified);
  const pageRows = classified.slice((page - 1) * limit, page * limit);
  const byId = new Map(pageRows.map((row) => [row.id, row]));
  const position = new Map(pageRows.map((row, index) => [row.id, index]));

  const details = pageRows.length
    ? await prisma.booking.findMany({
        where: { id: { in: pageRows.map((row) => row.id) } },
        select: {
          id: true,
          publicId: true,
          rentalPeriodType: true,
          days: true,
          startAt: true,
          endAt: true,
          originalEndAt: true,
          extensionCount: true,
          dlStatus: true,
          dlDepositNote: true,
          activeExtension: {
            select: {
              publicId: true,
              extensionStatus: true,
              requestedEndAt: true,
              resolutionType: true,
              gatewayTransactionId: true,
              paymentTransactionId: true,
            },
          },
          customer: {
            select: {
              publicId: true,
              alternatePhone: true,
              drivingLicenceNumber: true,
              user: { select: { name: true, phone: true } },
            },
          },
          items: {
            select: {
              vehicle: {
                select: {
                  publicId: true,
                  make: true,
                  model: true,
                  regNo: true,
                  images: {
                    where: { isThumbnail: true },
                    take: 1,
                    select: { file: { select: { url: true } } },
                  },
                },
              },
            },
          },
        },
      })
    : [];

  // findMany with `in` loses the order — restore most-overdue-first.
  details.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  const draftOf = await draftSummaryLookup(details.map((booking) => booking.publicId), "RETURN");

  const data: OverdueReturnRow[] = details.map((booking) => {
    const state = byId.get(booking.id)!;
    const ext = booking.activeExtension;
    // A quote that was never committed holds nothing — it is not a pending extension.
    const uncommittedQuote =
      ext?.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
      ext.resolutionType === null &&
      ext.gatewayTransactionId === null &&
      ext.paymentTransactionId === null;
    const extensionPending = !!ext && OPEN_EXTENSION_STATUSES.includes(ext.extensionStatus) && !uncommittedQuote;

    return {
      publicId: booking.publicId,
      bookingType: bookingListTypeOf(booking.rentalPeriodType),
      rentalPeriodType: booking.rentalPeriodType,
      days: booking.days,
      startAt: booking.startAt,
      endAt: booking.endAt,
      originalEndAt: booking.originalEndAt,
      endAtDisplay: TimezoneService.formatForDisplay(TimezoneService.fromPrisma(booking.endAt)),
      overdueMinutes: Math.floor(state.overdueMs / 60_000),
      returnState: state.returnState,
      graceMinutes: state.graceMinutes,
      graceEndsAt:
        state.graceMinutes !== null
          ? new Date(booking.endAt.getTime() + state.graceMinutes * 60_000)
          : null,
      dlStatus: booking.dlStatus,
      dlDepositNote: booking.dlStatus === "DEPOSIT" ? booking.dlDepositNote : null,
      extensionCount: booking.extensionCount,
      extensionPending,
      pendingExtension:
        extensionPending && ext
          ? { publicId: ext.publicId, status: ext.extensionStatus, requestedEndAt: ext.requestedEndAt }
          : null,
      customer: {
        publicId: booking.customer?.publicId ?? null,
        name: booking.customer?.user?.name ?? null,
        phone: booking.customer?.user?.phone ?? null,
        alternatePhone: booking.customer?.alternatePhone || null,
        drivingLicenceNumber: booking.customer?.drivingLicenceNumber || null,
      },
      vehicles: booking.items.map((item) => ({
        publicId: item.vehicle.publicId,
        make: item.vehicle.make,
        model: item.vehicle.model,
        regNo: item.vehicle.regNo,
        imageUrl: item.vehicle.images[0]?.file?.url ?? null,
      })),
      draft: draftOf(booking.publicId),
    };
  });

  return {
    data,
    overdueCount: overdueCountOf(counts),
    counts,
    serverNow: now.toISOString(),
    pagination: {
      total: classified.length,
      page,
      limit,
      totalPages: Math.ceil(classified.length / limit),
    },
  };
};
