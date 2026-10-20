/**
 * Pickup / drop notes (client, Oct 20 2026): the optional note the Fleet
 * Executive writes at the pickup and at the drop, kept in BookingOperationNote
 * (one per booking and step) with who wrote it and when. Read by the drop
 * screens, the completed pickup / drop records, the branch manager's customer
 * booking, confirmations and vehicle rent history, and the admin vehicle
 * history. Staff only — no customer endpoint selects them.
 *
 * Validation lives in utils/booking/operationNote.ts (pure).
 */
import { prisma, BookingStatus, type OperationNoteType } from "@repo/database/client";
import { operationNoteChanges, type OperationNoteKind } from "../../utils/booking/operationNote.js";

type Db = Pick<typeof prisma, "bookingOperationNote" | "user" | "vehicleSwap">;

export interface OperationNoteView {
  note: string;
  /** Who wrote it at the pickup / drop (null: account removed) */
  writtenBy: string | null;
  writtenAt: string;
  /** Last change in Edit Pickup / Edit Drop (null = never edited) */
  editedBy: string | null;
  editedAt: string | null;
}

/** A mid-rental swap that has notes (reason notes / the returned car's condition). */
export interface SwapNoteView {
  swapPublicId: string;
  swappedAt: string;
  swappedBy: string | null;
  fromRegNo: string;
  toRegNo: string;
  reason: string;
  reasonNotes: string | null;
  originalVehicleNotes: string | null;
}

export interface OperationNotesView {
  pickup: OperationNoteView | null;
  drop: OperationNoteView | null;
  swaps: SwapNoteView[];
}

export const EMPTY_OPERATION_NOTES: OperationNotesView = { pickup: null, drop: null, swaps: [] };

// The enum is not in the package's runtime exports — its values are the step names
const typeOf = (kind: OperationNoteKind): OperationNoteType => kind;

const blankToNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/** The saved note text of one step (null = none). */
export async function readOperationNote(bookingId: number, kind: OperationNoteKind, db: Db = prisma): Promise<string | null> {
  const row = await db.bookingOperationNote.findUnique({
    where: { bookingId_type: { bookingId, type: typeOf(kind) } },
    select: { note: true },
  });
  return row?.note ?? null;
}

/**
 * Saves the note sent with the pickup / drop (or its edit). `note` undefined =
 * not sent: nothing changes. null clears it. `mode` "OPERATION" (the pickup /
 * drop itself) records the actor as the writer; "EDIT" (Edit Pickup / Edit Drop)
 * as the editor, keeping who wrote it. Returns the text before and after.
 */
export async function saveOperationNote(
  db: Db,
  p: { bookingId: number; kind: OperationNoteKind; note: string | null | undefined; actorId: number; mode: "OPERATION" | "EDIT" },
): Promise<{ changed: boolean; before: string | null; after: string | null }> {
  const where = { bookingId_type: { bookingId: p.bookingId, type: typeOf(p.kind) } };
  const existing = await db.bookingOperationNote.findUnique({ where, select: { note: true } });
  const before = existing?.note ?? null;
  if (!operationNoteChanges(before, p.note)) return { changed: false, before, after: before };
  const after = p.note ?? null;
  const now = new Date();
  if (after == null) {
    await db.bookingOperationNote.deleteMany({ where: { bookingId: p.bookingId, type: typeOf(p.kind) } });
  } else if (!existing) {
    // upsert: two first saves at once must not trip the unique (bookingId, type)
    await db.bookingOperationNote.upsert({
      where,
      create: { bookingId: p.bookingId, type: typeOf(p.kind), note: after, writtenById: p.actorId, writtenAt: now },
      update: { note: after, writtenById: p.actorId, writtenAt: now },
    });
  } else {
    await db.bookingOperationNote.update({
      where,
      data:
        p.mode === "EDIT"
          ? { note: after, editedById: p.actorId, editedAt: now }
          : { note: after, writtenById: p.actorId, writtenAt: now },
    });
  }
  return { changed: true, before, after };
}

/** Pickup / drop notes and mid-rental swap notes of each booking (bookings without any are absent). */
export async function loadOperationNotes(bookingIds: number[], db: Db = prisma): Promise<Map<number, OperationNotesView>> {
  const out = new Map<number, OperationNotesView>();
  const ids = [...new Set(bookingIds)];
  if (ids.length === 0) return out;
  const [rows, swaps] = await Promise.all([
    db.bookingOperationNote.findMany({
      where: { bookingId: { in: ids } },
      select: { bookingId: true, type: true, note: true, writtenById: true, writtenAt: true, editedById: true, editedAt: true },
    }),
    db.vehicleSwap.findMany({
      where: {
        bookingId: { in: ids },
        bookingStatusAtSwap: BookingStatus.PICKED_UP,
        OR: [{ reasonNotes: { not: null } }, { originalVehicleNotes: { not: null } }],
      },
      orderBy: { swappedAt: "asc" },
      select: {
        bookingId: true,
        publicId: true,
        swappedAt: true,
        reason: true,
        reasonNotes: true,
        originalVehicleNotes: true,
        swappedBy: { select: { name: true } },
        originalVehicle: { select: { regNo: true } },
        newVehicle: { select: { regNo: true } },
      },
    }),
  ]);
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.writtenById, r.editedById]).filter((id): id is number => id != null)),
  ];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: number | null) => (id == null ? null : users.find((u) => u.id === id)?.name ?? null);
  const entry = (bookingId: number) => {
    let v = out.get(bookingId);
    if (!v) {
      v = { pickup: null, drop: null, swaps: [] };
      out.set(bookingId, v);
    }
    return v;
  };
  for (const r of rows) {
    const view: OperationNoteView = {
      note: r.note,
      writtenBy: nameOf(r.writtenById),
      writtenAt: r.writtenAt.toISOString(),
      editedBy: r.editedById != null ? nameOf(r.editedById) : null,
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
    };
    if (r.type === "PICKUP") entry(r.bookingId).pickup = view;
    else entry(r.bookingId).drop = view;
  }
  for (const s of swaps) {
    const reasonNotes = blankToNull(s.reasonNotes);
    const originalVehicleNotes = blankToNull(s.originalVehicleNotes);
    if (!reasonNotes && !originalVehicleNotes) continue;
    entry(s.bookingId).swaps.push({
      swapPublicId: s.publicId,
      swappedAt: s.swappedAt.toISOString(),
      swappedBy: s.swappedBy?.name ?? null,
      fromRegNo: s.originalVehicle.regNo,
      toRegNo: s.newVehicle.regNo,
      reason: String(s.reason),
      reasonNotes,
      originalVehicleNotes,
    });
  }
  return out;
}

/** One booking's notes (empty view when it has none). */
export async function getOperationNotes(bookingId: number, db: Db = prisma): Promise<OperationNotesView> {
  return (await loadOperationNotes([bookingId], db)).get(bookingId) ?? { pickup: null, drop: null, swaps: [] };
}
