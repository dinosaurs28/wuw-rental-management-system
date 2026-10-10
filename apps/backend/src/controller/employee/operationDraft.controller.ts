import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import {
  OperationDraftType,
  OperationDraftError,
  discardOperationDraft,
  findDraftBooking,
  getOperationDraft,
  listBranchOperationDrafts,
  saveOperationDraft,
  saveOperationDraftSchema,
} from "../../services/booking/operation-draft.service.js";

// Paused pickup / drop (client item 2). Branch-scoped like the other pickup /
// return routes; the draft never changes the booking.

const fail = (res: Response, error: unknown, label: string) => {
  if (error instanceof OperationDraftError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(`${label} error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
};

/** GET /employee/{pickup|return}/:bookingId/draft → { data: draft | null } */
export const makeGetOperationDraft = (type: OperationDraftType) => async (req: Request, res: Response) => {
  try {
    const booking = await findDraftBooking(String(req.params.bookingId), req.branch_Id);
    const draft = await getOperationDraft(booking, type);
    return res.status(StatusCode.OK).json({ data: draft });
  } catch (error) {
    return fail(res, error, "GetOperationDraft");
  }
};

/**
 * PUT /employee/{pickup|return}/:bookingId/draft
 * Body: { schemaVersion, data, photos?: [{ fileId, label? }], baseVersion? }
 * → { data: { publicId, type, version, createdAt, updatedAt, updatedBy } }
 * 409 DRAFT_NOT_ALLOWED (booking past that step) / DRAFT_CONFLICT (+ current draft).
 */
export const makeSaveOperationDraft = (type: OperationDraftType) => async (req: Request, res: Response) => {
  const parsed = saveOperationDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_FAILED",
      message: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid draft.",
    });
  }
  try {
    const booking = await findDraftBooking(String(req.params.bookingId), req.branch_Id);
    const actor = await prisma.user.findUnique({ where: { publicId: req.public_Id }, select: { id: true } });
    const saved = await saveOperationDraft(booking, type, parsed.data, actor?.id ?? null);
    return res.status(StatusCode.OK).json({ data: saved });
  } catch (error) {
    return fail(res, error, "SaveOperationDraft");
  }
};

/** DELETE /employee/{pickup|return}/:bookingId/draft — discard what was saved. */
export const makeDiscardOperationDraft = (type: OperationDraftType) => async (req: Request, res: Response) => {
  try {
    const booking = await findDraftBooking(String(req.params.bookingId), req.branch_Id);
    await discardOperationDraft(booking.id, type);
    return res.status(StatusCode.OK).json({ message: "Saved progress discarded" });
  } catch (error) {
    return fail(res, error, "DiscardOperationDraft");
  }
};

/** GET /employee/operation-drafts?type=PICKUP|RETURN — the branch's paused operations, newest first. */
export const ListOperationDrafts = async (req: Request, res: Response) => {
  const rawType = req.query.type;
  if (rawType !== undefined && rawType !== "PICKUP" && rawType !== "RETURN") {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "INVALID_TYPE",
      message: "type must be PICKUP or RETURN",
    });
  }
  try {
    const data = await listBranchOperationDrafts(req.branch_Id, rawType as OperationDraftType | undefined);
    return res.status(StatusCode.OK).json({ data });
  } catch (error) {
    return fail(res, error, "ListOperationDrafts");
  }
};
