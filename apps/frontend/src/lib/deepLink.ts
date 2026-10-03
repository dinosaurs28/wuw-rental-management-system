import {
  type DeferredLinkPlatform,
  vehicleAppPath,
} from "@repo/schemas";

// Shared vehicle links (#16): https://whatuwantrentals.com/app/vehicle/<id>.
// When the app is installed, Android App Links / iOS Universal Links open it
// before this website loads. Otherwise /app/vehicle/:id records a deferred link
// (so the freshly installed app can open the same vehicle on first launch) and
// sends the visitor to their store.

export const DEFAULT_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.whatuwantrentals.rentals";

function storeUrlFromEnv(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  return /^https:\/\/\S+$/i.test(url) ? url : null;
}

/** Google Play listing (build-time VITE_PLAY_STORE_URL). */
export const PLAY_STORE_URL: string =
  storeUrlFromEnv(import.meta.env.VITE_PLAY_STORE_URL) ?? DEFAULT_PLAY_STORE_URL;

export const DEFAULT_APP_STORE_URL = "https://apps.apple.com/app/id6801821149";

/** App Store listing (build-time VITE_APP_STORE_URL overrides the live listing). */
export const APP_STORE_URL: string | null =
  storeUrlFromEnv(import.meta.env.VITE_APP_STORE_URL) ?? DEFAULT_APP_STORE_URL;

/** android / ios for phones and tablets, null for everything else (desktop). */
export function detectLinkPlatform(): DeferredLinkPlatform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS Safari reports a desktop Mac user agent; touch support gives it away.
  if (
    (navigator.platform === "MacIntel" || /Macintosh/i.test(ua)) &&
    navigator.maxTouchPoints > 1
  ) {
    return "ios";
  }
  return null;
}

const DEFERRED_LINK_ENDPOINT = `${
  import.meta.env.VITE_API_URL || "http://localhost:3000/api"
}/public/deferred-links`;

/** The store redirect never waits longer than this for the record call. */
const RECORD_MAX_WAIT_MS = 1500;

/**
 * Saves the vehicle for this network + platform for an hour
 * (POST /public/deferred-links). Never throws: the store redirect happens
 * whatever the outcome.
 */
export async function recordDeferredLink(
  vehicleId: string,
  platform: DeferredLinkPlatform,
): Promise<void> {
  const body = JSON.stringify({ path: vehicleAppPath(vehicleId), platform });

  // sendBeacon posts the JSON as text/plain (no CORS preflight) and still
  // delivers it after the page is replaced by the store, so no need to wait.
  try {
    if (
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(DEFERRED_LINK_ENDPOINT, body)
    ) {
      return;
    }
  } catch {
    // fall back to fetch below
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), RECORD_MAX_WAIT_MS);
  try {
    await fetch(DEFERRED_LINK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      credentials: "omit",
      keepalive: true,
      signal: controller.signal,
    });
  } catch {
    // network error / timeout: the visitor still goes to the store
  } finally {
    window.clearTimeout(timer);
  }
}
