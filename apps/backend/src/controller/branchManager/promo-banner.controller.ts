import { Request, Response } from "express";
import fs from "fs/promises";
import { prisma } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { getClientIp } from "../../utils/clientIp.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { normalizeCouponCode } from "../../services/discount/coupon-validation.service.js";
import {
  PromoError,
  PROMO_SELECT,
  PROMO_STATUSES,
  type PromoRow,
  type PromoStatus,
  parseCreateBody,
  parseUpdateBody,
  parsePromoInstant,
  validatePromoWindow,
  assertPosterCoupon,
  assertLinkTarget,
  assertBranchCapacity,
  processPromoImage,
  putPromoImage,
  enqueuePromoImageDelete,
  invalidatePublicOffers,
  toManagerOffers,
  listPosterCoupons,
  listLinkTargets,
  promoStatus,
} from "../../services/promo-banner/promo-banner.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadActor(req: Request) {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { publicId: true, name: true } } },
  });
  if (!user) {
    throw new PromoError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "Please sign in again.");
  }
  const branch =
    user.branch ??
    (await prisma.branch.findUnique({ where: { id: req.branch_Id }, select: { publicId: true, name: true } }));
  if (!branch) {
    throw new PromoError(StatusCode.FORBIDDEN, "NO_BRANCH", "Your account isn't linked to a branch.");
  }
  return { id: user.id, name: user.name, role: user.role, branchPublicId: branch.publicId, branchName: branch.name };
}

type Actor = Awaited<ReturnType<typeof loadActor>>;

function sendError(res: Response, error: unknown, where: string, fallback: string) {
  if (error instanceof PromoError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(`${where} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: fallback,
  });
}

const notFound = () =>
  new PromoError(StatusCode.NOT_FOUND, "PROMO_NOT_FOUND", "This poster doesn't exist or was deleted.");

async function findOwnPoster(req: Request): Promise<PromoRow> {
  const row = await prisma.promoBanner.findFirst({
    where: { publicId: req.params.publicId, branchId: req.branch_Id, deletedAt: null },
    select: PROMO_SELECT,
  });
  if (!row) throw notFound();
  return row;
}

/** Plain fields for the audit before/after snapshots. */
const snapshot = (row: PromoRow) => ({
  title: row.title,
  subtitle: row.subtitle,
  couponCode: row.couponCode,
  ctaLabel: row.ctaLabel,
  linkTarget: row.linkTarget,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  image: row.imageFile.publicId,
});

async function audit(
  req: Request,
  actor: Actor,
  action: "PROMO_BANNER_CREATED" | "PROMO_BANNER_UPDATED" | "PROMO_BANNER_DELETED",
  description: string,
  row: PromoRow,
  before?: ReturnType<typeof snapshot>,
  after?: ReturnType<typeof snapshot>,
) {
  try {
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: req.branch_Id,
      action,
      category: AuditCategory.BRANCH,
      description,
      entity: "PromoBanner",
      entityId: row.publicId,
      entityLabel: row.title,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      before,
      after,
    });
  } catch (err) {
    console.error("[PromoBanner] Audit log failed:", err);
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/branchManager/offers?status=LIVE|SCHEDULED|EXPIRED|INACTIVE
 * The branch's posters (not deleted) with live coupon / link checks.
 */
export const ListOffers = async (req: Request, res: Response) => {
  try {
    const rawStatus = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    if (rawStatus && !PROMO_STATUSES.includes(rawStatus as PromoStatus)) {
      throw new PromoError(
        StatusCode.BAD_REQUEST,
        "VALIDATION_ERROR",
        `status must be one of ${PROMO_STATUSES.join(", ")}.`,
      );
    }

    const now = new Date();
    const rows = await prisma.promoBanner.findMany({
      where: { branchId: req.branch_Id, deletedAt: null },
      select: PROMO_SELECT,
      orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }, { createdAt: "desc" }],
    });

    const counts: Record<PromoStatus | "total", number> = {
      LIVE: 0,
      SCHEDULED: 0,
      EXPIRED: 0,
      INACTIVE: 0,
      total: rows.length,
    };
    for (const r of rows) counts[promoStatus(r, now)] += 1;

    const selected = rawStatus ? rows.filter((r) => promoStatus(r, now) === rawStatus) : rows;
    const data = await toManagerOffers(selected, now);
    return res.status(StatusCode.OK).json({ success: true, data, counts });
  } catch (error) {
    return sendError(res, error, "ListOffers", "Couldn't load the posters. Please try again.");
  }
};

/** GET /api/branchManager/offers/:publicId */
export const GetOffer = async (req: Request, res: Response) => {
  try {
    const row = await findOwnPoster(req);
    const [data] = await toManagerOffers([row]);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "GetOffer", "Couldn't load the poster. Please try again.");
  }
};

/** GET /api/branchManager/offers/coupons — coupons a poster at this branch may advertise. */
export const ListOfferCoupons = async (req: Request, res: Response) => {
  try {
    const data = await listPosterCoupons(req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ListOfferCoupons", "Couldn't load the coupons. Please try again.");
  }
};

/** GET /api/branchManager/offers/link-targets — the branch's vehicle groups and cars. */
export const ListOfferLinkTargets = async (req: Request, res: Response) => {
  try {
    const data = await listLinkTargets(req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ListOfferLinkTargets", "Couldn't load the vehicles. Please try again.");
  }
};

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/branchManager/offers — multipart/form-data with the `image` file.
 * Everything is validated before the image is uploaded; if saving fails after
 * the upload, the uploaded object is queued for deletion.
 */
export const CreateOffer = async (req: Request, res: Response) => {
  const tmpPath = req.file?.path;
  let uploadedKey: string | null = null;
  try {
    const input = parseCreateBody(req.body);
    if (!req.file) {
      throw new PromoError(StatusCode.BAD_REQUEST, "PROMO_IMAGE_REQUIRED", "Upload a poster image.");
    }

    const now = new Date();
    const branchId = req.branch_Id;
    const startsAt = parsePromoInstant(input.startsAt, "Start date and time");
    const endsAt = parsePromoInstant(input.endsAt, "End date and time");
    validatePromoWindow(startsAt, endsAt, { endMustBeFuture: true, now });

    const couponCode = input.couponCode
      ? await assertPosterCoupon(input.couponCode, branchId, { startsAt, endsAt })
      : null;
    const link = input.linkTarget ? await assertLinkTarget(input.linkTarget, branchId) : null;
    const isActive = input.isActive ?? true;
    if (isActive) await assertBranchCapacity(branchId, undefined, now);

    const actor = await loadActor(req);
    const image = await processPromoImage(req.file.path);
    const { key, url } = await putPromoImage(image.buffer, actor.branchPublicId);
    uploadedKey = key;

    const created = await prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.create({
        data: { publicId: createID(), key, url, mime: "image/webp", size: image.buffer.length },
        select: { id: true },
      });
      return tx.promoBanner.create({
        data: {
          publicId: createID(),
          branchId,
          title: input.title,
          subtitle: input.subtitle ?? null,
          imageFileId: file.id,
          couponCode,
          ctaLabel: input.ctaLabel ?? null,
          linkTarget: link?.linkTarget ?? null,
          startsAt,
          endsAt,
          sortOrder: input.sortOrder ?? 0,
          isActive,
          createdById: actor.id,
        },
        select: PROMO_SELECT,
      });
    });
    uploadedKey = null;

    await invalidatePublicOffers(actor.branchPublicId);
    await audit(req, actor, "PROMO_BANNER_CREATED", `Created offer poster "${created.title}"`, created, undefined, snapshot(created));

    const [data] = await toManagerOffers([created], now);
    return res.status(StatusCode.CREATED).json({ success: true, message: "Poster created", data });
  } catch (error) {
    if (uploadedKey) await enqueuePromoImageDelete(uploadedKey);
    return sendError(res, error, "CreateOffer", "Couldn't create the poster. Please try again.");
  } finally {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
  }
};

/**
 * PATCH /api/branchManager/offers/:publicId — multipart (to replace the image)
 * or JSON. Absent fields are unchanged; "" / null clears an optional field.
 */
export const UpdateOffer = async (req: Request, res: Response) => {
  const tmpPath = req.file?.path;
  let uploadedKey: string | null = null;
  try {
    const input = parseUpdateBody(req.body);
    const existing = await findOwnPoster(req);
    const now = new Date();
    const branchId = req.branch_Id;

    // A form that re-sends every field only triggers the checks for values that
    // actually changed (editing the title of an expired poster still works).
    const startsAt =
      input.startsAt !== undefined ? parsePromoInstant(input.startsAt, "Start date and time") : existing.startsAt;
    const endsAt = input.endsAt !== undefined ? parsePromoInstant(input.endsAt, "End date and time") : existing.endsAt;
    const startChanged = startsAt.getTime() !== existing.startsAt.getTime();
    const endChanged = endsAt.getTime() !== existing.endsAt.getTime();
    const windowChanged = startChanged || endChanged;
    if (windowChanged) {
      validatePromoWindow(startsAt, endsAt, { endMustBeFuture: endChanged, now });
    }

    let couponCode = existing.couponCode;
    if (input.couponCode !== undefined) {
      couponCode = input.couponCode === null ? null : normalizeCouponCode(input.couponCode);
    }
    if (couponCode && (couponCode !== existing.couponCode || windowChanged)) {
      // A new code, or new dates that must still overlap the coupon on the poster.
      couponCode = await assertPosterCoupon(couponCode, branchId, { startsAt, endsAt });
    }

    let linkTarget = existing.linkTarget;
    if (input.linkTarget !== undefined && input.linkTarget !== existing.linkTarget) {
      linkTarget = input.linkTarget === null ? null : (await assertLinkTarget(input.linkTarget, branchId)).linkTarget;
    }

    const isActive = input.isActive ?? existing.isActive;
    const countedBefore = existing.isActive && existing.endsAt.getTime() > now.getTime();
    const countsAfter = isActive && endsAt.getTime() > now.getTime();
    if (countsAfter && !countedBefore) await assertBranchCapacity(branchId, existing.id, now);

    const actor = await loadActor(req);

    let newImage: { key: string; url: string; size: number } | null = null;
    if (req.file) {
      const image = await processPromoImage(req.file.path);
      const put = await putPromoImage(image.buffer, actor.branchPublicId);
      uploadedKey = put.key;
      newImage = { ...put, size: image.buffer.length };
    }

    const data: Prisma.PromoBannerUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.subtitle !== undefined) data.subtitle = input.subtitle;
    if (input.ctaLabel !== undefined) data.ctaLabel = input.ctaLabel;
    if (input.couponCode !== undefined) data.couponCode = couponCode;
    if (input.linkTarget !== undefined) data.linkTarget = linkTarget;
    if (input.startsAt !== undefined) data.startsAt = startsAt;
    if (input.endsAt !== undefined) data.endsAt = endsAt;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const oldFile = existing.imageFile;
    const { updated, releasedKey } = await prisma.$transaction(async (tx) => {
      if (newImage) {
        const file = await tx.fileObject.create({
          data: {
            publicId: createID(),
            key: newImage.key,
            url: newImage.url,
            mime: "image/webp",
            size: newImage.size,
          },
          select: { id: true },
        });
        data.imageFileId = file.id;
      }
      // Conditional on not deleted, so a delete in another tab wins.
      const changed = await tx.promoBanner.updateMany({
        where: { id: existing.id, deletedAt: null },
        data,
      });
      if (changed.count === 0) throw notFound();

      let released: string | null = null;
      if (newImage) {
        const stillUsed = await tx.promoBanner.count({ where: { imageFileId: oldFile.id } });
        if (stillUsed === 0) {
          await tx.fileObject.delete({ where: { id: oldFile.id } });
          released = oldFile.key;
        }
      }
      const row = await tx.promoBanner.findUniqueOrThrow({ where: { id: existing.id }, select: PROMO_SELECT });
      return { updated: row, releasedKey: released };
    });
    uploadedKey = null;
    if (releasedKey) await enqueuePromoImageDelete(releasedKey);

    await invalidatePublicOffers(actor.branchPublicId);
    await audit(
      req,
      actor,
      "PROMO_BANNER_UPDATED",
      `Updated offer poster "${updated.title}"`,
      updated,
      snapshot(existing),
      snapshot(updated),
    );

    const [result] = await toManagerOffers([updated], now);
    return res.status(StatusCode.OK).json({ success: true, message: "Poster updated", data: result });
  } catch (error) {
    if (uploadedKey) await enqueuePromoImageDelete(uploadedKey);
    return sendError(res, error, "UpdateOffer", "Couldn't update the poster. Please try again.");
  } finally {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
  }
};

/** DELETE /api/branchManager/offers/:publicId — soft delete; gone from every list. */
export const DeleteOffer = async (req: Request, res: Response) => {
  try {
    const existing = await findOwnPoster(req);
    const changed = await prisma.promoBanner.updateMany({
      where: { id: existing.id, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (changed.count === 0) throw notFound();

    const actor = await loadActor(req);
    await invalidatePublicOffers(actor.branchPublicId);
    await audit(
      req,
      actor,
      "PROMO_BANNER_DELETED",
      `Deleted offer poster "${existing.title}"`,
      existing,
      snapshot(existing),
      undefined,
    );

    return res.status(StatusCode.OK).json({ success: true, message: "Poster deleted" });
  } catch (error) {
    return sendError(res, error, "DeleteOffer", "Couldn't delete the poster. Please try again.");
  }
};
