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
  ConfirmedDisplayKeys,
  DISPLAY_VARIANT_SUFFIX,
  canHaveDisplayVariant,
  confirmedDisplayKey,
  displayVariantKey,
  isDisplayVariantKey,
  photoUrls,
  variantSaveOutcome,
  type DisplayCopyDeps,
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

// ── Only a display copy known to exist (drop screen "pickup photos not loading", Oct 25 2026) ──

const COPY = "pickup/2026-10-01/abc123.jpg__md.jpg";
function fakeDeps(over: { inBucket?: string[]; existsThrows?: boolean; makes?: string | null; makeThrows?: boolean } = {}) {
  const calls: string[] = [];
  const inBucket = new Set(over.inBucket ?? []);
  const deps: DisplayCopyDeps = {
    async exists(key) {
      calls.push(`exists:${key}`);
      if (over.existsThrows) throw new Error("timeout");
      return inBucket.has(key);
    },
    async forget(id, key) {
      calls.push(`forget:${id}:${key}`);
    },
    async make(file) {
      calls.push(`make:${file.id}:${file.displayKey}`);
      if (over.makeThrows) throw new Error("sharp");
      return over.makes === undefined ? COPY : over.makes;
    },
  };
  return { deps, calls };
}
const stored = (displayKey: string | null = COPY) => ({ id: 7, ...pickup({ displayKey }) });

test("a stored copy is linked once confirmed in the bucket, then not checked again", async () => {
  const confirmed = new ConfirmedDisplayKeys();
  const { deps, calls } = fakeDeps({ inBucket: [COPY] });
  assert.equal(await confirmedDisplayKey(stored(), deps, confirmed), COPY);
  assert.equal(await confirmedDisplayKey(stored(), deps, confirmed), COPY);
  assert.deepEqual(calls, [`exists:${COPY}`]);
});

test("a stored copy missing from the bucket is forgotten and made again", async () => {
  const { deps, calls } = fakeDeps({ inBucket: [] });
  assert.equal(await confirmedDisplayKey(stored(), deps, new ConfirmedDisplayKeys()), COPY);
  assert.deepEqual(calls, [`exists:${COPY}`, `forget:7:${COPY}`, "make:7:null"]);
});

test("a missing copy that can't be made again → the original (null), never the missing key", async () => {
  for (const over of [{ makes: null }, { makeThrows: true }]) {
    const { deps } = fakeDeps({ inBucket: [], ...over });
    assert.equal(await confirmedDisplayKey(stored(), deps, new ConfirmedDisplayKeys()), null);
  }
});

test("the bucket check failing (timeout, R2 down) → the original, nothing cleared", async () => {
  const confirmed = new ConfirmedDisplayKeys();
  const { deps, calls } = fakeDeps({ existsThrows: true });
  assert.equal(await confirmedDisplayKey(stored(), deps, confirmed), null);
  assert.deepEqual(calls, [`exists:${COPY}`]);
  assert.equal(confirmed.size, 0);
});

test("a photo without a copy gets one made; a failed copy → the original", async () => {
  const confirmed = new ConfirmedDisplayKeys();
  const ok = fakeDeps();
  assert.equal(await confirmedDisplayKey(stored(null), ok.deps, confirmed), COPY);
  assert.deepEqual(ok.calls, ["make:7:null"]);
  assert.equal(confirmed.has(7, COPY), true);
  const failed = fakeDeps({ makes: null });
  assert.equal(await confirmedDisplayKey({ ...stored(null), id: 8 }, failed.deps, confirmed), null);
});

test("private files and non-images never get a display copy linked", async () => {
  const { deps, calls } = fakeDeps({ inBucket: [COPY] });
  const privateFile = { id: 9, ...pickup({ url: "pickup/2026-10-01/abc123.jpg", displayKey: COPY }) };
  assert.equal(await confirmedDisplayKey(privateFile, deps, new ConfirmedDisplayKeys()), null);
  assert.equal(await confirmedDisplayKey({ id: 10, ...pickup({ mime: "application/pdf" }) }, deps, new ConfirmedDisplayKeys()), null);
  assert.deepEqual(calls, []);
});

test("confirmed keys: a different key for the photo isn't confirmed; bounded size", () => {
  const confirmed = new ConfirmedDisplayKeys(2);
  confirmed.add(1, "a");
  assert.equal(confirmed.has(1, "a"), true);
  assert.equal(confirmed.has(1, "b"), false);
  confirmed.add(2, "b");
  confirmed.add(3, "c");
  assert.equal(confirmed.size, 2);
  assert.equal(confirmed.has(1, "a"), false);
  assert.equal(confirmed.has(3, "c"), true);
});
