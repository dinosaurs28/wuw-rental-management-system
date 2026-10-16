/**
 * Display copies of public photos (drop screen strips): key naming, which
 * files get one, the URL fallback for photos without one, and the resize
 * itself (local sharp, no network).
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  DISPLAY_VARIANT_SUFFIX,
  canHaveDisplayVariant,
  displayVariantKey,
  isDisplayVariantKey,
  photoUrls,
  variantSaveOutcome,
} from "./photo-variant.js";
import { DISPLAY_IMAGE_MAX_PX, processDisplayImage } from "./image-processor.js";

const BASE = "https://pub-abc.r2.dev";
const pickup = (over: Partial<Parameters<typeof photoUrls>[0]> = {}) => ({
  key: "pickup/2026-10-01/abc123.jpg",
  url: `${BASE}/pickup/2026-10-01/abc123.jpg`,
  mime: "image/jpeg",
  displayKey: null as string | null,
  ...over,
});

test("display key sits beside the original", () => {
  assert.equal(displayVariantKey("pickup/2026-10-01/abc.jpg"), "pickup/2026-10-01/abc.jpg__md.jpg");
  assert.equal(displayVariantKey("returns/2026-10-01/abc"), `returns/2026-10-01/abc${DISPLAY_VARIANT_SUFFIX}`);
  assert.equal(isDisplayVariantKey(displayVariantKey("pickup/x.png")), true);
  assert.equal(isDisplayVariantKey("pickup/x.png"), false);
});

test("only public images get a display copy", () => {
  assert.equal(canHaveDisplayVariant(pickup()), true);
  // private files store the key itself in url (presigned per view)
  assert.equal(canHaveDisplayVariant(pickup({ url: "pickup/2026-10-01/abc123.jpg" })), false);
  assert.equal(canHaveDisplayVariant(pickup({ mime: "application/pdf" })), false);
  assert.equal(canHaveDisplayVariant(pickup({ key: "" })), false);
  const variant = displayVariantKey("pickup/2026-10-01/abc123.jpg");
  assert.equal(canHaveDisplayVariant(pickup({ key: variant, url: `${BASE}/${variant}` })), false);
});

test("displayUrl uses the copy on the current public base", () => {
  const file = pickup({ displayKey: displayVariantKey("pickup/2026-10-01/abc123.jpg") });
  assert.deepEqual(photoUrls(file, BASE), {
    url: `${BASE}/pickup/2026-10-01/abc123.jpg`,
    displayUrl: `${BASE}/pickup/2026-10-01/abc123.jpg__md.jpg`,
  });
  // moved to a custom domain: both follow it
  assert.deepEqual(photoUrls(file, "https://photos.example.com/"), {
    url: "https://photos.example.com/pickup/2026-10-01/abc123.jpg",
    displayUrl: "https://photos.example.com/pickup/2026-10-01/abc123.jpg__md.jpg",
  });
});

test("displayUrl falls back to the original", () => {
  const original = `${BASE}/pickup/2026-10-01/abc123.jpg`;
  assert.deepEqual(photoUrls(pickup(), BASE), { url: original, displayUrl: original });
  assert.deepEqual(photoUrls(pickup({ displayKey: "pickup/2026-10-01/abc123.jpg__md.jpg" }), undefined), {
    url: original,
    displayUrl: original,
  });
  assert.deepEqual(photoUrls(pickup({ displayKey: "pickup/2026-10-01/abc123.jpg__md.jpg" }), "  "), {
    url: original,
    displayUrl: original,
  });
});

test("display image: ≤1200 px longest side, baseline JPEG, never enlarged", async () => {
  const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#c33" } })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  const out = await processDisplayImage(big);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(out.mimeType, "image/jpeg");
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, DISPLAY_IMAGE_MAX_PX);
  assert.equal(meta.height, 900);
  assert.equal(meta.isProgressive, false);
  assert.ok(out.size < big.length);

  const portrait = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: "#3c3" } })
    .png()
    .toBuffer();
  const p = await sharp((await processDisplayImage(portrait)).buffer).metadata();
  assert.equal(p.height, DISPLAY_IMAGE_MAX_PX);
  assert.equal(p.width, 900);

  const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#33c" } })
    .jpeg()
    .toBuffer();
  const s = await sharp((await processDisplayImage(small)).buffer).metadata();
  assert.equal(s.width, 640);
  assert.equal(s.height, 480);
});

test("a display copy written for a photo deleted meanwhile is an orphan", () => {
  assert.equal(variantSaveOutcome(1, true), "saved");
  // another request stored the same key first: the object is in use, keep it
  assert.equal(variantSaveOutcome(0, true), "kept");
  assert.equal(variantSaveOutcome(0, false), "orphan");
});
