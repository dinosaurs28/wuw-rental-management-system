/**
 * The Fleet note of a pickup / drop still in progress (Oct 20 2026):
 *
 *   PUT /employee/pickup/:bookingId/note  { pickupNote }  — booking CONFIRMED (pickup not done)
 *   PUT /employee/return/:bookingId/note  { dropNote }    — booking PICKED_UP (drop not recorded)
 *
 * The note is normally sent with the pickup / drop itself (pickup session
 * initiate, legacy pickup, drop bill compute, legacy drop). This saves a note
 * changed after that step (e.g. typed while the bill is being paid) without
 * recomputing anything. A completed pickup / drop is changed with Edit Pickup /
 * Edit Drop instead (409). Blank / null clears the note.
 */
import { Request, Response } from "express";
import { prisma, BookingStatus } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { OperationNoteError, parseOperationNote, type OperationNoteKind } from "../../utils/booking/operationNote.js";
import { getOperationNotes, saveOperationNote } from "../../services/booking/operation-notes.service.js";

const NOT_IN_PROGRESS = {
  PICKUP: {
    code: "PICKUP_NOT_IN_PROGRESS",
    message: "This pickup is already done — change its note with Edit Pickup.",
  },
  DROP: {
    code: "DROP_NOT_IN_PROGRESS",
    message: "This drop isn't open — change a recorded drop's note with Edit Return.",
  },
} as const;

export const makeSaveOperationNote = (kind: OperationNoteKind) => async (req: Request, res: Response) => {
  const field = kind === "PICKUP" ? "pickupNote" : "dropNote";
  try {
    const raw = req.body?.[field];
    if (raw === undefined) {
      return res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "VALIDATION_FAILED", field, message: `Send ${field}.` });
    }
    const note = parseOperationNote(raw, field);
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const booking = await prisma.booking.findFirst({
      where: { publicId: String(req.params.bookingId ?? ""), branchId: req.branch_Id, deletedAt: null },
      select: { id: true, publicId: true, status: true, requiresManagerConfirmation: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    const inProgress =
      kind === "PICKUP"
        ? booking.status === BookingStatus.CONFIRMED && !booking.requiresManagerConfirmation
        : booking.status === BookingStatus.PICKED_UP && !booking.requiresManagerConfirmation;
    if (!inProgress) return res.status(StatusCode.CONFLICT).json(NOT_IN_PROGRESS[kind]);

    const saved = await saveOperationNote(prisma, { bookingId: booking.id, kind, note, actorId: actor.id, mode: "OPERATION" });
    if (saved.changed) {
      await auditService.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: kind === "PICKUP" ? "PICKUP_NOTE_SAVED" : "DROP_NOTE_SAVED",
        category: AuditCategory.BOOKING,
        description: `${kind === "PICKUP" ? "Pickup" : "Drop"} note ${saved.after ? "saved" : "cleared"} for booking ${booking.publicId}`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        before: { [field]: saved.before },
        after: { [field]: saved.after },
      });
    }
    return res.status(StatusCode.OK).json({
      message: saved.changed ? "Note saved" : "Nothing to change",
      data: { operationNotes: await getOperationNotes(booking.id) },
    });
  } catch (error) {
    if (error instanceof OperationNoteError) return res.status(error.status).json(error.toJSON());
    console.error("SaveOperationNote Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Something went wrong. Please try again." });
  }
};
