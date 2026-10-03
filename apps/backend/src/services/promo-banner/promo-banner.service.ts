/**
 * Offer posters (TODO #15) — the slides of the web landing hero and the mobile
 * home hero. A Branch Manager creates them for their own branch; rows with no
 * branch are global and shown everywhere.
 *
 *  - Images live in the PUBLIC bucket (they are marketing material) as WebP,
 *    re-encoded with sharp so EXIF/GPS never leaves the BM's phone.
 *  - An optional coupon code must be an active DiscountRule that any customer
 *    can use at the poster's branch. It is checked when the poster is saved
 *    and again on every public read, so a coupon that has since expired, been
 *    deactivated or used up simply stops being advertised.
 *  - An optional link target is a vehicle group key or a vehicle publicId of
 *    the same branch; a link whose vehicles are gone is hidden on read.
 */
import fs from "fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { DateTime } from "luxon";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma, DiscountScope } from "@repo/database/client";
import type { DiscountRule, Prisma } from "@repo/database/client";
import { r2, PUBLIC_BUCKET } from "../../lib/r2.client.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { normalizeCouponCode } from "../discount/coupon-validation.service.js";
import { normalizeGroupStr, parseGroupKey } from "../../utils/booking/groupRepresentative.js";
import { isVehicleGroupKey } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";

const IST = "Asia/Kolkata";

// ── Limits ────────────────────────────────────────────────────────────────────

export const PROMO_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PROMO_IMAGE_MIN_WIDTH = 800;
export const PROMO_IMAGE_MIN_HEIGHT = 400;
// Landscape posters around 16:9 (3:2 = 1.5 … 2:1 = 2.0, with a little slack).
export const PROMO_IMAGE_MIN_ASPECT = 1.5;
export const PROMO_IMAGE_MAX_ASPECT = 2.1;
const PROMO_IMAGE_OUT_WIDTH = 1920;
const PROMO_IMAGE_OUT_HEIGHT = 1080;
const PROMO_IMAGE_WEBP_QUALITY = 82;

export const PROMO_TITLE_MAX = 80;
export const PROMO_SUBTITLE_MAX = 160;
export const PROMO_CTA_MAX = 30;
export const PROMO_COUPON_MAX = 40;
const PROMO_LINK_MAX = 200;
export const PROMO_SORT_MAX = 9999;
export const PROMO_WINDOW_MAX_DAYS = 366;
/** Active posters that are live or scheduled, per branch. */
export const PROMO_BRANCH_LIMIT = 12;
const PUBLIC_LIMIT = 20;
const PUBLIC_CACHE_TTL_SECONDS = 60;
const PUBLIC_CACHE_PREFIX = "promo:offers:public";

const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

// ── Errors ────────────────────────────────────────────────────────────────────

export class PromoError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PromoError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

// ── Request parsing ───────────────────────────────────────────────────────────
// Bodies arrive as multipart text (every value a string) or as JSON. "" and
// null clear an optional field; an absent key leaves it unchanged.

const clearable = (max: number, label: string) =>
  z
    .preprocess(
      (v) => (v === null ? null : typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
      z.string(`${label} must be text.`).max(max, `${label} can be at most ${max} characters.`).nullable(),
    )
    .optional();

const titleField = z
  .string("Title is required.")
  .trim()
  .min(1, "Title is required.")
  .max(PROMO_TITLE_MAX, `Title can be at most ${PROMO_TITLE_MAX} characters.`);

const dateField = (label: string) =>
  z.string(`${label} is required.`).trim().min(1, `${label} is required.`);

const sortOrderField = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v),
    z
      .number("Sort order must be a whole number.")
      .int("Sort order must be a whole number.")
      .min(0, "Sort order can't be negative.")
      .max(PROMO_SORT_MAX, `Sort order can be at most ${PROMO_SORT_MAX}.`),
  )
  .optional();

const isActiveField = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return v;
  }, z.boolean("Active must be true or false."))
  .optional();

const createSchema = z.object({
  title: titleField,
  subtitle: clearable(PROMO_SUBTITLE_MAX, "Subtitle"),
  couponCode: clearable(PROMO_COUPON_MAX, "Coupon code"),
  ctaLabel: clearable(PROMO_CTA_MAX, "Button label"),
  linkTarget: clearable(PROMO_LINK_MAX, "Link"),
  startsAt: dateField("Start date and time"),
  endsAt: dateField("End date and time"),
  sortOrder: sortOrderField,
  isActive: isActiveField,
});

const updateSchema = z.object({
  title: titleField.optional(),
  subtitle: clearable(PROMO_SUBTITLE_MAX, "Subtitle"),
  couponCode: clearable(PROMO_COUPON_MAX, "Coupon code"),
  ctaLabel: clearable(PROMO_CTA_MAX, "Button label"),
  linkTarget: clearable(PROMO_LINK_MAX, "Link"),
  startsAt: dateField("Start date and time").optional(),
  endsAt: dateField("End date and time").optional(),
  sortOrder: sortOrderField,
  isActive: isActiveField,
});

export type PromoCreateInput = z.infer<typeof createSchema>;
export type PromoUpdateInput = z.infer<typeof updateSchema>;

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const errors = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  throw new PromoError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", errors[0]?.message ?? "Invalid input", {
    errors,
  });
}

export const parseCreateBody = (body: unknown): PromoCreateInput => parseBody(createSchema, body);
export const parseUpdateBody = (body: unknown): PromoUpdateInput => parseBody(updateSchema, body);

/**
 * IST wall time "YYYY-MM-DDTHH:mm" (like the employee endpoints), or any ISO
 * string with an offset / Z.
 */
export function parsePromoInstant(raw: string, label: string): Date {
  const dt = DateTime.fromISO(raw.trim(), { zone: IST });
  if (!dt.isValid) {
    throw new PromoError(
      StatusCode.BAD_REQUEST,
      "PROMO_INVALID_WINDOW",
      `${label} isn't a valid date and time. Use the format YYYY-MM-DDTHH:mm (IST).`,
    );
  }
  return dt.toJSDate();
}

export function formatIst(d: Date): string {
  return DateTime.fromJSDate(d).setZone(IST).toFormat("d LLL yyyy, h:mm a");
}

export function validatePromoWindow(
  startsAt: Date,
  endsAt: Date,
  { endMustBeFuture, now = new Date() }: { endMustBeFuture: boolean; now?: Date },
): void {
  const fail = (message: string) => {
    throw new PromoError(StatusCode.BAD_REQUEST, "PROMO_INVALID_WINDOW", message);
  };
  if (endsAt.getTime() <= startsAt.getTime()) {
    fail("The poster must end after it starts.");
  }
  if (endMustBeFuture && endsAt.getTime() <= now.getTime()) {
    fail(`The end time (${formatIst(endsAt)}) has already passed. Pick a future end time.`);
  }
  const spanDays = (endsAt.getTime() - startsAt.getTime()) / 86_400_000;
  if (spanDays > PROMO_WINDOW_MAX_DAYS) {
    fail(`A poster can run for at most ${PROMO_WINDOW_MAX_DAYS} days.`);
  }
}

export type PromoStatus = "LIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";
export const PROMO_STATUSES: PromoStatus[] = ["LIVE", "SCHEDULED", "EXPIRED", "INACTIVE"];

export function promoStatus(
  row: { isActive: boolean; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): PromoStatus {
  if (!row.isActive) return "INACTIVE";
  if (now.getTime() < row.startsAt.getTime()) return "SCHEDULED";
  if (now.getTime() >= row.endsAt.getTime()) return "EXPIRED";
  return "LIVE";
}

// ── Image pipeline ────────────────────────────────────────────────────────────

/**
 * Reads the multer temp file (always deleting it), checks it is a readable
 * landscape photo of a usable size and re-encodes it as WebP. sharp drops
 * EXIF/GPS unless asked to keep it; `.rotate()` bakes the orientation in first.
 */
export async function processPromoImage(
  tmpPath: string,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(tmpPath);
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new PromoError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      "This file is not a readable image. Please upload a JPG, PNG or WebP poster.",
    );
  }
  if (!meta.format || !IMAGE_FORMATS.has(meta.format) || !meta.width || !meta.height) {
    throw new PromoError(StatusCode.BAD_REQUEST, "INVALID_IMAGE", "Only JPG, PNG or WebP images are accepted.");
  }

  // Size as displayed (EXIF orientation 5–8 swaps width and height).
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;

  if (width < PROMO_IMAGE_MIN_WIDTH || height < PROMO_IMAGE_MIN_HEIGHT) {
    throw new PromoError(
      StatusCode.BAD_REQUEST,
      "IMAGE_TOO_SMALL",
      `The image is too small (${width}×${height}). It must be at least ${PROMO_IMAGE_MIN_WIDTH}×${PROMO_IMAGE_MIN_HEIGHT} pixels — 1600×900 works best.`,
    );
  }
  const aspect = width / height;
  if (aspect < PROMO_IMAGE_MIN_ASPECT || aspect > PROMO_IMAGE_MAX_ASPECT) {
    throw new PromoError(
      StatusCode.BAD_REQUEST,
      "PROMO_IMAGE_ASPECT",
      `The image is ${width}×${height}. Posters must be landscape, about 16:9 (for example 1600×900).`,
    );
  }

  try {
    const { data, info } = await sharp(raw)
      .rotate()
      .resize({
        width: PROMO_IMAGE_OUT_WIDTH,
        height: PROMO_IMAGE_OUT_HEIGHT,
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      })
      .webp({ quality: PROMO_IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new PromoError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      meta.format === "heif"
        ? "HEIC images can't be read. Please export the poster as a JPG or PNG."
        : "This image could not be read. Please upload it again as a JPG, PNG or WebP.",
    );
  }
}

/** Puts the processed poster in the public bucket. Returns the key and public URL. */
export async function putPromoImage(
  buffer: Buffer,
  branchPublicId: string,
): Promise<{ key: string; url: string }> {
  const key = `promo-banners/${branchPublicId}/${createID()}.webp`;
  await r2.send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      // Every upload gets a new key, so the object never changes.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { key, url: `${process.env.R2_PUBLIC_URL}/${key}` };
}

/** Queues a public-bucket object for deletion. Never throws. */
export async function enqueuePromoImageDelete(key: string): Promise<void> {
  try {
    await fileCleanupQueue.add("delete-promo-banner-image", { key, bucket: PUBLIC_BUCKET });
  } catch (err) {
    console.error(`[PromoBanner] Failed to queue R2 cleanup for ${key}:`, err);
  }
}

// ── Coupon checks ─────────────────────────────────────────────────────────────

export interface CouponUsage {
  total: number;
  atBranch: number;
}

export type PosterCouponVerdict =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Can `rule` be advertised on a poster of `branchId` (null = global poster)?
 * `requireStarted` (public read): the coupon must already be valid now; when
 * saving, a coupon that starts later is fine as long as it overlaps `window`.
 */
export function evaluatePosterCoupon(
  rule: DiscountRule,
  {
    branchId,
    usage,
    now = new Date(),
    window,
    requireStarted = false,
  }: {
    branchId: number | null;
    usage: CouponUsage;
    now?: Date;
    window?: { startsAt: Date; endsAt: Date };
    requireStarted?: boolean;
  },
): PosterCouponVerdict {
  const code = rule.code;
  const fail = (c: string, message: string): PosterCouponVerdict => ({ ok: false, code: c, message });

  if (!rule.isActive) return fail("PROMO_COUPON_INACTIVE", `Coupon ${code} has been deactivated.`);
  if (rule.endDate.getTime() <= now.getTime()) {
    return fail("PROMO_COUPON_EXPIRED", `Coupon ${code} expired on ${formatIst(rule.endDate)}.`);
  }
  if (requireStarted && rule.startDate.getTime() > now.getTime()) {
    return fail("PROMO_COUPON_NOT_STARTED", `Coupon ${code} starts on ${formatIst(rule.startDate)}.`);
  }
  if (rule.scope === DiscountScope.USER || rule.targetCustomerIds.length > 0) {
    return fail(
      "PROMO_COUPON_NOT_PUBLIC",
      `Coupon ${code} is only for specific customers, so it can't be advertised on a poster.`,
    );
  }
  // BRANCH scope with an empty list is a legacy "everywhere" rule (same as checkout).
  if (rule.scope === DiscountScope.BRANCH && rule.applicableBranchIds.length > 0) {
    if (branchId === null || !rule.applicableBranchIds.includes(branchId)) {
      return fail("PROMO_COUPON_BRANCH_MISMATCH", `Coupon ${code} can't be used at this branch.`);
    }
  }
  if (rule.totalUsageLimit != null && usage.total >= rule.totalUsageLimit) {
    return fail("PROMO_COUPON_USED_UP", `Coupon ${code} has reached its usage limit.`);
  }
  if (branchId !== null && rule.perBranchLimit != null && usage.atBranch >= rule.perBranchLimit) {
    return fail("PROMO_COUPON_USED_UP", `Coupon ${code} has reached its usage limit at this branch.`);
  }
  if (
    window &&
    (rule.endDate.getTime() <= window.startsAt.getTime() ||
      rule.startDate.getTime() >= window.endsAt.getTime())
  ) {
    return fail(
      "PROMO_COUPON_WINDOW_MISMATCH",
      `Coupon ${code} is valid ${formatIst(rule.startDate)} – ${formatIst(rule.endDate)}, which doesn't overlap the poster's dates.`,
    );
  }
  return { ok: true };
}

/** Non-blocking notes for the BM about who can actually use the coupon. */
export function posterCouponWarning(rule: DiscountRule): string | null {
  const notes: string[] = [];
  const plans = rule.applicablePaymentPlans.map((p) => p.toUpperCase());
  const advanceBlocked =
    rule.allowPartialPayment === false ||
    (plans.length > 0 && !plans.includes("ADVANCE") && !plans.includes("BOTH"));
  if (advanceBlocked) {
    notes.push("It only works when the booking is paid in full, so customers can't use it online (online bookings are paid with an advance).");
  }
  if (rule.newCustomersOnly) notes.push("It is for first-time customers only.");
  if (rule.minRentalDays != null) notes.push(`It needs a rental of at least ${rule.minRentalDays} days.`);
  if (rule.minBookingAmount != null) {
    notes.push(`It needs a booking of at least ₹${Number(rule.minBookingAmount).toFixed(2)}.`);
  }
  return notes.length > 0 ? notes.join(" ") : null;
}

/** Usage counts for a set of rules: overall and per branch. */
export async function loadCouponUsage(
  ruleIds: number[],
): Promise<{ usageFor: (ruleId: number, branchId: number | null) => CouponUsage }> {
  const total = new Map<number, number>();
  const perBranch = new Map<string, number>();
  if (ruleIds.length > 0) {
    const rows = await prisma.couponUsageLog.groupBy({
      by: ["discountRuleId", "branchId"],
      where: { discountRuleId: { in: ruleIds } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const n = r._count._all;
      total.set(r.discountRuleId, (total.get(r.discountRuleId) ?? 0) + n);
      perBranch.set(`${r.discountRuleId}:${r.branchId}`, n);
    }
  }
  return {
    usageFor: (ruleId, branchId) => ({
      total: total.get(ruleId) ?? 0,
      atBranch: branchId === null ? 0 : perBranch.get(`${ruleId}:${branchId}`) ?? 0,
    }),
  };
}

/**
 * Save-time check of the coupon code a BM typed or picked. Throws a 422
 * PromoError when it can't go on the poster; returns the canonical code.
 */
export async function assertPosterCoupon(
  rawCode: string,
  branchId: number,
  window: { startsAt: Date; endsAt: Date },
): Promise<string> {
  const code = normalizeCouponCode(rawCode);
  const rule = await prisma.discountRule.findUnique({ where: { code } });
  if (!rule) {
    throw new PromoError(StatusCode.UNPROCESSABLE_ENTITY, "PROMO_COUPON_NOT_FOUND", `No coupon with the code ${code} exists.`);
  }
  const { usageFor } = await loadCouponUsage([rule.id]);
  const verdict = evaluatePosterCoupon(rule, { branchId, usage: usageFor(rule.id, branchId), window });
  if (!verdict.ok) {
    throw new PromoError(StatusCode.UNPROCESSABLE_ENTITY, verdict.code, verdict.message);
  }
  return code;
}

// ── Link targets ──────────────────────────────────────────────────────────────

export type PromoLinkType = "VEHICLE_GROUP" | "VEHICLE";

export interface ResolvedLink {
  linkTarget: string;
  linkType: PromoLinkType;
  label: string;
}

/** A group key (make__model__categoryId__branchId) of `branchId` with vehicles left, else null. */
async function resolveGroupLink(value: string, branchId: number): Promise<ResolvedLink | null> {
  const parsed = parseGroupKey(value);
  if (!parsed || parsed.branchId !== branchId) return null;
  const make = normalizeGroupStr(parsed.make);
  const model = normalizeGroupStr(parsed.model);
  if (!make || !model) return null;
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId, categoryId: parsed.categoryId, deletedAt: null },
    select: { make: true, model: true, category: { select: { name: true } } },
  });
  const matching = vehicles.filter(
    (v) => normalizeGroupStr(v.make) === make && normalizeGroupStr(v.model) === model,
  );
  if (matching.length === 0) return null;
  const n = matching.length;
  return {
    linkTarget: `${make}__${model}__${parsed.categoryId}__${branchId}`,
    linkType: "VEHICLE_GROUP",
    label: `${make} ${model} · ${matching[0]!.category.name} (${n} vehicle${n === 1 ? "" : "s"})`,
  };
}

/**
 * Resolves a vehicle group key (make__model__categoryId__branchId) or a
 * vehicle publicId of `branchId` to its canonical form, or null when it isn't
 * one (or none of its vehicles are left).
 */
export async function resolveLinkTarget(target: string, branchId: number): Promise<ResolvedLink | null> {
  const value = target.trim();
  if (!value) return null;

  // A vehicle publicId (nanoid) can contain "__" too: only the strict group-key
  // shape is tried as a group, and anything that doesn't resolve as one is
  // looked up as a single vehicle.
  if (isVehicleGroupKey(value)) {
    const group = await resolveGroupLink(value, branchId);
    if (group) return group;
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { publicId: value, branchId, deletedAt: null },
    select: { publicId: true, make: true, model: true, regNo: true },
  });
  if (!vehicle) return null;
  return {
    linkTarget: vehicle.publicId,
    linkType: "VEHICLE",
    label: `${vehicle.make} ${vehicle.model} · ${vehicle.regNo}`,
  };
}

export async function assertLinkTarget(target: string, branchId: number): Promise<ResolvedLink> {
  const resolved = await resolveLinkTarget(target, branchId);
  if (!resolved) {
    throw new PromoError(
      StatusCode.UNPROCESSABLE_ENTITY,
      "PROMO_LINK_TARGET_INVALID",
      "The link must point to a vehicle or vehicle group of your branch. Pick one from the list.",
    );
  }
  return resolved;
}

/** The branch's vehicles as link choices: make/model groups and single vehicles. */
export async function listLinkTargets(branchId: number) {
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId, deletedAt: null },
    select: {
      publicId: true,
      make: true,
      model: true,
      regNo: true,
      categoryId: true,
      category: { select: { name: true } },
    },
    orderBy: [{ make: "asc" }, { model: "asc" }, { regNo: "asc" }],
  });

  const groups = new Map<
    string,
    { groupKey: string; make: string; model: string; category: string; vehicleCount: number; label: string }
  >();
  for (const v of vehicles) {
    const make = normalizeGroupStr(v.make);
    const model = normalizeGroupStr(v.model);
    const groupKey = `${make}__${model}__${v.categoryId}__${branchId}`;
    const g = groups.get(groupKey);
    if (g) g.vehicleCount += 1;
    else groups.set(groupKey, { groupKey, make, model, category: v.category.name, vehicleCount: 1, label: "" });
  }
  for (const g of groups.values()) {
    g.label = `${g.make} ${g.model} · ${g.category} (${g.vehicleCount} vehicle${g.vehicleCount === 1 ? "" : "s"})`;
  }

  return {
    groups: [...groups.values()],
    vehicles: vehicles.map((v) => ({
      publicId: v.publicId,
      make: v.make,
      model: v.model,
      regNo: v.regNo,
      category: v.category.name,
      label: `${v.make} ${v.model} · ${v.regNo}`,
    })),
  };
}

// ── Coupons a BM may advertise ────────────────────────────────────────────────

export async function listPosterCoupons(branchId: number, now: Date = new Date()) {
  // Branch / customer lists are checked in evaluatePosterCoupon: rows written
  // outside the discount service can hold NULL arrays, which `isEmpty` misses.
  const rules = await prisma.discountRule.findMany({
    where: {
      isActive: true,
      endDate: { gt: now },
      scope: { in: [DiscountScope.GLOBAL, DiscountScope.BRANCH] },
    },
    orderBy: [{ endDate: "asc" }, { code: "asc" }],
  });
  const { usageFor } = await loadCouponUsage(rules.map((r) => r.id));
  return rules
    .filter((r) => evaluatePosterCoupon(r, { branchId, usage: usageFor(r.id, branchId), now }).ok)
    .map((r) => ({
      publicId: r.publicId,
      code: r.code,
      name: r.name,
      discountType: r.discountType,
      value: Number(r.value),
      maxDiscountCap: r.maxDiscountCap != null ? Number(r.maxDiscountCap) : null,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      scope: r.scope as "GLOBAL" | "BRANCH",
      warning: posterCouponWarning(r),
    }));
}

// ── Serialisation ─────────────────────────────────────────────────────────────

export const PROMO_SELECT = {
  id: true,
  publicId: true,
  branchId: true,
  title: true,
  subtitle: true,
  couponCode: true,
  ctaLabel: true,
  linkTarget: true,
  startsAt: true,
  endsAt: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  imageFile: { select: { id: true, publicId: true, key: true, url: true, mime: true, size: true } },
  branch: { select: { publicId: true, name: true } },
} satisfies Prisma.PromoBannerSelect;

export type PromoRow = Prisma.PromoBannerGetPayload<{ select: typeof PROMO_SELECT }>;

/** Rules + usage for the coupon codes on a set of posters. */
async function loadCouponContext(rows: PromoRow[]) {
  const codes = [...new Set(rows.map((r) => r.couponCode).filter((c): c is string => !!c))];
  const rules = codes.length
    ? await prisma.discountRule.findMany({ where: { code: { in: codes } } })
    : [];
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const { usageFor } = await loadCouponUsage(rules.map((r) => r.id));
  return { byCode, usageFor };
}

/** Link resolution memoised per (target, branch) for one response. */
function linkResolver() {
  const memo = new Map<string, Promise<ResolvedLink | null>>();
  return (target: string | null, branchId: number | null): Promise<ResolvedLink | null> => {
    if (!target || branchId === null) return Promise.resolve(null);
    const k = `${branchId}:${target}`;
    let p = memo.get(k);
    if (!p) {
      p = resolveLinkTarget(target, branchId);
      memo.set(k, p);
    }
    return p;
  };
}

const couponSummary = (rule: DiscountRule) => ({
  code: rule.code,
  discountType: rule.discountType,
  value: Number(rule.value),
  maxDiscountCap: rule.maxDiscountCap != null ? Number(rule.maxDiscountCap) : null,
  validUntil: rule.endDate.toISOString(),
});

export interface PublicOffer {
  publicId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  couponCode: string | null;
  coupon: ReturnType<typeof couponSummary> | null;
  ctaLabel: string | null;
  linkTarget: string | null;
  linkType: PromoLinkType | null;
  branch: { publicId: string; name: string } | null;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
}

export async function toPublicOffers(rows: PromoRow[], now: Date = new Date()): Promise<PublicOffer[]> {
  const { byCode, usageFor } = await loadCouponContext(rows);
  const resolveLink = linkResolver();

  return Promise.all(
    rows.map(async (row) => {
      const rule = row.couponCode ? byCode.get(row.couponCode) : undefined;
      const couponOk =
        !!rule &&
        evaluatePosterCoupon(rule, {
          branchId: row.branchId,
          usage: usageFor(rule.id, row.branchId),
          now,
          requireStarted: true,
        }).ok;
      const link = await resolveLink(row.linkTarget, row.branchId);
      return {
        publicId: row.publicId,
        title: row.title,
        subtitle: row.subtitle,
        imageUrl: row.imageFile.url,
        couponCode: couponOk ? rule!.code : null,
        coupon: couponOk ? couponSummary(rule!) : null,
        ctaLabel: row.ctaLabel,
        linkTarget: link?.linkTarget ?? null,
        linkType: link?.linkType ?? null,
        branch: row.branch ? { publicId: row.branch.publicId, name: row.branch.name } : null,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        sortOrder: row.sortOrder,
      };
    }),
  );
}

export async function toManagerOffers(rows: PromoRow[], now: Date = new Date()) {
  const { byCode, usageFor } = await loadCouponContext(rows);
  const resolveLink = linkResolver();

  return Promise.all(
    rows.map(async (row) => {
      const rule = row.couponCode ? byCode.get(row.couponCode) : undefined;
      let couponStatus: { valid: true } | { valid: false; code: string; message: string } | null = null;
      if (row.couponCode) {
        if (!rule) {
          couponStatus = {
            valid: false,
            code: "PROMO_COUPON_NOT_FOUND",
            message: `Coupon ${row.couponCode} no longer exists.`,
          };
        } else {
          const verdict = evaluatePosterCoupon(rule, {
            branchId: row.branchId,
            usage: usageFor(rule.id, row.branchId),
            now,
            window: { startsAt: row.startsAt, endsAt: row.endsAt },
          });
          couponStatus = verdict.ok ? { valid: true } : { valid: false, code: verdict.code, message: verdict.message };
        }
      }
      const link = await resolveLink(row.linkTarget, row.branchId);
      return {
        publicId: row.publicId,
        title: row.title,
        subtitle: row.subtitle,
        imageUrl: row.imageFile.url,
        image: {
          publicId: row.imageFile.publicId,
          url: row.imageFile.url,
          mime: row.imageFile.mime,
          size: row.imageFile.size,
        },
        couponCode: row.couponCode,
        coupon: rule
          ? {
              publicId: rule.publicId,
              code: rule.code,
              name: rule.name,
              discountType: rule.discountType,
              value: Number(rule.value),
              maxDiscountCap: rule.maxDiscountCap != null ? Number(rule.maxDiscountCap) : null,
              startDate: rule.startDate.toISOString(),
              endDate: rule.endDate.toISOString(),
              isActive: rule.isActive,
            }
          : null,
        couponStatus,
        couponWarning: rule ? posterCouponWarning(rule) : null,
        ctaLabel: row.ctaLabel,
        linkTarget: row.linkTarget,
        linkType: link?.linkType ?? null,
        linkLabel: link?.label ?? null,
        linkValid: row.linkTarget ? link !== null : true,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        sortOrder: row.sortOrder,
        isActive: row.isActive,
        status: promoStatus(row, now),
        branch: row.branch ? { publicId: row.branch.publicId, name: row.branch.name } : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  );
}

// ── Public listing (+ short Redis cache) ──────────────────────────────────────

const publicCacheKey = (branchPublicId: string | null) =>
  branchPublicId ? `${PUBLIC_CACHE_PREFIX}:branch:${branchPublicId}` : `${PUBLIC_CACHE_PREFIX}:all`;

/**
 * Live posters: every branch + global (branchId null), or one branch + global.
 * Served from a 60 s cache; posters that ended since the cache was filled are
 * dropped on the way out.
 */
export async function getPublicOffers(
  branch: { id: number; publicId: string } | null,
  now: Date = new Date(),
): Promise<PublicOffer[]> {
  const key = publicCacheKey(branch?.publicId ?? null);
  try {
    const cached = await redis.get(key);
    if (cached) {
      const offers = JSON.parse(cached) as PublicOffer[];
      return offers.filter((o) => new Date(o.endsAt).getTime() > now.getTime());
    }
  } catch {
    /* cache is best-effort */
  }

  const rows = await prisma.promoBanner.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
      AND: [
        branch ? { OR: [{ branchId: branch.id }, { branchId: null }] } : {},
        { OR: [{ branchId: null }, { branch: { deletedAt: null } }] },
      ],
    },
    select: PROMO_SELECT,
    orderBy: [
      { sortOrder: "asc" },
      { branchId: { sort: "asc", nulls: "last" } },
      { startsAt: "desc" },
      { createdAt: "desc" },
    ],
    take: PUBLIC_LIMIT,
  });
  const offers = await toPublicOffers(rows, now);

  try {
    await redis.set(key, JSON.stringify(offers), "EX", PUBLIC_CACHE_TTL_SECONDS);
  } catch {
    /* cache is best-effort */
  }
  return offers;
}

/**
 * Drops the cached public lists a branch's poster appears in. Never throws.
 * (Global posters sit in every branch's list; those entries expire in 60 s.)
 */
export async function invalidatePublicOffers(branchPublicId: string | null): Promise<void> {
  try {
    const keys = [publicCacheKey(null)];
    if (branchPublicId) keys.push(publicCacheKey(branchPublicId));
    await redis.del(...keys);
  } catch (err) {
    console.warn("[PromoBanner] Cache invalidation failed (expires in 60 s):", (err as Error).message);
  }
}

// ── Branch limit ──────────────────────────────────────────────────────────────

/** Throws when the branch already has the maximum number of live + scheduled posters. */
export async function assertBranchCapacity(branchId: number, excludeId?: number, now: Date = new Date()) {
  const count = await prisma.promoBanner.count({
    where: {
      branchId,
      deletedAt: null,
      isActive: true,
      endsAt: { gt: now },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    },
  });
  if (count >= PROMO_BRANCH_LIMIT) {
    throw new PromoError(
      StatusCode.CONFLICT,
      "PROMO_LIMIT_REACHED",
      `Your branch already has ${PROMO_BRANCH_LIMIT} live or scheduled posters. Turn one off or delete it first.`,
    );
  }
}
