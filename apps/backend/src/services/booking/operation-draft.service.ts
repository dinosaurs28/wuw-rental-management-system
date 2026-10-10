/**
 * Paused pickups / drops (client item 2, Oct 10 2026).
 *
 * A Fleet Executive can leave a pickup or drop half-way and continue it later,
 * on any phone. What was entered so far — readings, choices, the file ids of
 * photos already uploaded — is kept as one OperationDraft per booking and type.
 * The draft never changes the booking: only the explicit completion (pickup /
 * drop endpoints, or the payment session settling) does, and that completion
 * deletes the draft. A draft whose booking moved on some other way (a manager
 * completed it on the web, the booking was cancelled) is stale: reads skip and
 * delete it.
 *
 * The form fields are opaque to the server (`data`, versioned by the app with
 * its own schemaVersion). Photos are kept as file publicIds only — the URL is
 * looked up on every read, never trusted from the stored copy.
 */
import { prisma, BookingStatus, OperationDraftType, Prisma } from "@repo/database/client";
import { z } from "zod";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { resolveFileUrl } from "../../utils/file-url.js";

export { OperationDraftType };

type Db = Prisma.TransactionClient | typeof prisma;

/** The booking status each kind of draft belongs to; any other status makes it stale. */
export const DRAFT_BOOKING_STATUS: Record<OperationDraftType, BookingStatus> = {
  PICKUP: BookingStatus.CONFIRMED,
  RETURN: BookingStatus.PICKED_UP,
};

/** Serialized size cap of the form fields (express.json() refuses bodies over 100 kB anyway). */
export const DRAFT_DATA_MAX_BYTES = 64 * 1024;
export const DRAFT_MAX_PHOTOS = 60;

// Draft photos come from the pickup / return photo uploads (public bucket).
// Anything else (a KYC or invoice file id) is never resolved to a link.
const DRAFT_PHOTO_KEY_PREFIXES = ["pickup/", "returns/"];

const OPERATION_NOUN: Record<OperationDraftType, string> = { PICKUP: "pickup", RETURN: "drop" };

export const saveOperationDraftSchema = z.object({
  // The app's own version of the `data` layout.
  schemaVersion: z.number().int().min(1).max(1000),
  data: z.record(z.string(), z.unknown()),
  photos: z
    .array(
      z.object({
        fileId: z.string().trim().min(1).max(64),
        // Kept exactly: it must equal the capture-config slot name (not trimmed there either).
        label: z.string().max(100).nullish(),
      }),
    )
    .max(DRAFT_MAX_PHOTOS)
    .optional(),
  // The draft version this save is based on. When sent and the stored draft is
  // newer (saved from another phone meanwhile), the save is refused with 409.
  baseVersion: z.number().int().min(0).optional(),
  // Random id of the screen session saving. A save whose response was lost
  // leaves the phone a version behind; the next save from the same writer is
  // not a conflict with itself.
  writerId: z.string().min(1).max(64).optional(),
});
export type SaveOperationDraftInput = z.infer<typeof saveOperationDraftSchema>;

export type OperationDraftErrorCode =
  | "BOOKING_NOT_FOUND"
  | "DRAFT_NOT_ALLOWED"
  | "DRAFT_TOO_LARGE"
  | "DRAFT_CONFLICT";

export class OperationDraftError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: OperationDraftErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OperationDraftError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

/** Stored in OperationDraft.data. */
interface StoredDraft {
  schemaVersion: number;
  data: Record<string, unknown>;
  photos: Array<{ fileId: string; label: string | null }>;
  writerId?: string | null;
}

export interface OperationDraftPhoto {
  fileId: string;
  label: string | null;
  url: string;
  mime: string;
}

export interface SerializedOperationDraft {
  publicId: string;
  type: OperationDraftType;
  schemaVersion: number;
  data: Record<string, unknown>;
  photos: OperationDraftPhoto[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: { name: string } | null;
}

/** What booking lists carry for a paused operation (additive `draft` field). */
export interface OperationDraftSummary {
  type: OperationDraftType;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface DraftBooking {
  id: number;
  publicId: string;
  status: BookingStatus;
  requiresManagerConfirmation: boolean;
}

/** The booking in the staff member's branch, or 404. */
export async function findDraftBooking(publicId: string, branchId: number): Promise<DraftBooking> {
  const booking = await prisma.booking.findFirst({
    where: { publicId, branchId },
    select: { id: true, publicId: true, status: true, requiresManagerConfirmation: true },
  });
  if (!booking) {
    throw new OperationDraftError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found or access denied");
  }
  return booking;
}

// Open = at that step and not already submitted to a manager (a legacy pickup /
// drop sent for confirmation is finished from Fleet's side).
const isOpenFor = (type: OperationDraftType, booking: DraftBooking) =>
  DRAFT_BOOKING_STATUS[type] === booking.status && !booking.requiresManagerConfirmation;

/** Booking filter matching isOpenFor, for list queries. */
const openBookingWhere = (type: OperationDraftType) => ({
  status: DRAFT_BOOKING_STATUS[type],
  requiresManagerConfirmation: false,
});

function readStored(raw: Prisma.JsonValue): StoredDraft {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : {};
  const photos = Array.isArray(obj.photos)
    ? obj.photos.flatMap((p) => {
        const photo = p as { fileId?: unknown; label?: unknown } | null;
        return photo && typeof photo.fileId === "string"
          ? [{ fileId: photo.fileId, label: typeof photo.label === "string" ? photo.label : null }]
          : [];
      })
    : [];
  return {
    schemaVersion: typeof obj.schemaVersion === "number" ? obj.schemaVersion : 1,
    data,
    photos,
    writerId: typeof obj.writerId === "string" ? obj.writerId : null,
  };
}

/** Current URLs for the stored photo ids, in stored order; deleted / foreign files are left out. */
async function resolvePhotos(photos: StoredDraft["photos"], db: Db = prisma): Promise<OperationDraftPhoto[]> {
  if (photos.length === 0) return [];
  const files = await db.fileObject.findMany({
    where: { publicId: { in: [...new Set(photos.map((p) => p.fileId))] } },
    select: { publicId: true, key: true, url: true, mime: true },
  });
  const byId = new Map(
    files
      .filter((f) => DRAFT_PHOTO_KEY_PREFIXES.some((prefix) => f.key.startsWith(prefix)))
      .map((f) => [f.publicId, f]),
  );
  const resolved = await Promise.all(
    photos.map(async (p) => {
      const file = byId.get(p.fileId);
      return file ? { fileId: p.fileId, label: p.label, url: await resolveFileUrl(file), mime: file.mime } : null;
    }),
  );
  return resolved.filter((p): p is OperationDraftPhoto => p !== null);
}

const draftInclude = { updatedBy: { select: { name: true } } } as const;

async function serialize(
  draft: Prisma.OperationDraftGetPayload<{ include: typeof draftInclude }>,
  db: Db = prisma,
): Promise<SerializedOperationDraft> {
  const stored = readStored(draft.data);
  return {
    publicId: draft.publicId,
    type: draft.type,
    schemaVersion: stored.schemaVersion,
    data: stored.data,
    photos: await resolvePhotos(stored.photos, db),
    version: draft.version,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    updatedBy: draft.updatedBy ? { name: draft.updatedBy.name } : null,
  };
}

/** The booking's paused draft of this type, or null. A stale draft is deleted. */
export async function getOperationDraft(
  booking: DraftBooking,
  type: OperationDraftType,
): Promise<SerializedOperationDraft | null> {
  const draft = await prisma.operationDraft.findUnique({
    where: { bookingId_type: { bookingId: booking.id, type } },
    include: draftInclude,
  });
  if (!draft) return null;
  if (!isOpenFor(type, booking)) {
    await discardOperationDraft(booking.id, type);
    return null;
  }
  return serialize(draft);
}

async function conflictError(bookingId: number, type: OperationDraftType): Promise<OperationDraftError> {
  const current = await prisma.operationDraft.findUnique({
    where: { bookingId_type: { bookingId, type } },
    include: draftInclude,
  });
  const by = current?.updatedBy?.name;
  return new OperationDraftError(
    StatusCode.CONFLICT,
    "DRAFT_CONFLICT",
    `This ${OPERATION_NOUN[type]} was saved from another phone${by ? ` by ${by}` : ""} since you opened it.`,
    { draft: current ? await serialize(current) : null },
  );
}

const notAllowedError = (type: OperationDraftType, bookingStatus: string) =>
  new OperationDraftError(
    StatusCode.CONFLICT,
    "DRAFT_NOT_ALLOWED",
    type === "PICKUP"
      ? "This booking is no longer waiting for pickup."
      : "This booking is no longer out on rent — there's no drop to save.",
    { bookingStatus },
  );

/**
 * Creates or replaces the booking's draft of this type. Refused (409
 * DRAFT_NOT_ALLOWED) once the booking is past that step, and (409
 * DRAFT_CONFLICT, with the current draft) when `baseVersion` is older than the
 * stored draft and another writer saved it. Returns the saved draft without
 * its form data.
 *
 * The step check and the write share one transaction holding the booking row
 * lock. Completion paths delete the draft after updating the booking (which
 * takes the same lock), so a save racing a completion either lands first and
 * is deleted by it, or waits and sees the booking already moved on.
 */
export async function saveOperationDraft(
  booking: DraftBooking,
  type: OperationDraftType,
  input: SaveOperationDraftInput,
  actorUserId: number | null,
): Promise<Omit<SerializedOperationDraft, "data" | "photos" | "schemaVersion">> {
  if (!isOpenFor(type, booking)) throw notAllowedError(type, booking.status);
  const stored: StoredDraft = {
    schemaVersion: input.schemaVersion,
    data: input.data,
    photos: (input.photos ?? []).map((p) => ({ fileId: p.fileId, label: p.label || null })),
    writerId: input.writerId ?? null,
  };
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > DRAFT_DATA_MAX_BYTES) {
    throw new OperationDraftError(
      StatusCode.PAYLOAD_TOO_LARGE,
      "DRAFT_TOO_LARGE",
      `The saved ${OPERATION_NOUN[type]} is too large.`,
    );
  }
  const json = stored as unknown as Prisma.InputJsonObject;

  const outcome = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ status: string; requiresManagerConfirmation: boolean }>>`
      SELECT "status"::text AS "status", "requiresManagerConfirmation"
        FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
    if (
      !locked ||
      !isOpenFor(type, {
        ...booking,
        status: locked.status as BookingStatus,
        requiresManagerConfirmation: locked.requiresManagerConfirmation,
      })
    ) {
      return { kind: "closed" as const, status: locked?.status ?? booking.status };
    }
    const existing = await tx.operationDraft.findUnique({
      where: { bookingId_type: { bookingId: booking.id, type } },
      select: { id: true, version: true, data: true },
    });
    if (!existing) {
      const row = await tx.operationDraft.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          type,
          data: json,
          version: 1,
          updatedById: actorUserId,
        },
        include: draftInclude,
      });
      return { kind: "saved" as const, row };
    }
    const sameWriter = !!input.writerId && readStored(existing.data).writerId === input.writerId;
    if (input.baseVersion !== undefined && input.baseVersion !== existing.version && !sameWriter) {
      return { kind: "conflict" as const };
    }
    const row = await tx.operationDraft.update({
      where: { id: existing.id },
      data: { data: json, version: { increment: 1 }, updatedById: actorUserId },
      include: draftInclude,
    });
    return { kind: "saved" as const, row };
  });
  if (outcome.kind === "closed") throw notAllowedError(type, outcome.status);
  if (outcome.kind === "conflict") throw await conflictError(booking.id, type);

  const saved = outcome.row;
  return {
    publicId: saved.publicId,
    type: saved.type,
    version: saved.version,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy ? { name: saved.updatedBy.name } : null,
  };
}

/** Deletes the booking's draft of this type (no-op when there is none). Safe inside a transaction. */
export async function discardOperationDraft(
  bookingId: number,
  type: OperationDraftType,
  db: Db = prisma,
): Promise<void> {
  await db.operationDraft.deleteMany({ where: { bookingId, type } });
}

/** Paused-operation summaries for list rows, keyed by booking publicId (stale drafts left out). */
export async function draftSummariesFor(
  bookingPublicIds: string[],
  type: OperationDraftType,
): Promise<Map<string, OperationDraftSummary>> {
  if (bookingPublicIds.length === 0) return new Map();
  const drafts = await prisma.operationDraft.findMany({
    where: {
      type,
      booking: { publicId: { in: bookingPublicIds }, ...openBookingWhere(type) },
    },
    select: {
      type: true,
      updatedAt: true,
      booking: { select: { publicId: true } },
      updatedBy: { select: { name: true } },
    },
  });
  return new Map(
    drafts.map((d) => [
      d.booking.publicId,
      { type: d.type, updatedAt: d.updatedAt, updatedByName: d.updatedBy?.name ?? null },
    ]),
  );
}

/**
 * Same as draftSummariesFor, swallowing failures: a list must still load if the
 * draft lookup fails (e.g. before the migration has run). Null-safe getter.
 */
export async function draftSummaryLookup(
  bookingPublicIds: string[],
  type: OperationDraftType,
): Promise<(publicId: string) => OperationDraftSummary | null> {
  try {
    const map = await draftSummariesFor(bookingPublicIds, type);
    return (publicId) => map.get(publicId) ?? null;
  } catch (err) {
    console.error("[operation-draft] summary lookup failed:", err);
    return () => null;
  }
}

/** Every paused operation in the branch, newest first, with what a list card shows. */
export async function listBranchOperationDrafts(branchId: number, type?: OperationDraftType) {
  const allTypes = Object.keys(DRAFT_BOOKING_STATUS) as OperationDraftType[];
  const types = type ? [type] : allTypes;
  // Drafts whose booking moved on some other way (a manager confirmed or
  // completed it on the web, or it was cancelled) are cleared
  // here so they don't pile up. Best-effort: never fails the list.
  await prisma.operationDraft
    .deleteMany({
      where: {
        booking: { branchId },
        NOT: { OR: allTypes.map((t) => ({ type: t, booking: openBookingWhere(t) })) },
      },
    })
    .catch((err) => console.error("[operation-draft] stale cleanup failed:", err));
  const drafts = await prisma.operationDraft.findMany({
    where: {
      OR: types.map((t) => ({ type: t, booking: { branchId, ...openBookingWhere(t) } })),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      publicId: true,
      type: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
      booking: {
        select: {
          publicId: true,
          startAt: true,
          endAt: true,
          status: true,
          customer: { select: { user: { select: { name: true, phone: true } } } },
          items: { select: { vehicle: { select: { make: true, model: true, regNo: true } } } },
        },
      },
    },
  });
  return drafts.map((d) => ({
    publicId: d.publicId,
    type: d.type,
    updatedAt: d.updatedAt,
    updatedByName: d.updatedBy?.name ?? null,
    booking: d.booking,
  }));
}
