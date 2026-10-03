import { createHash } from "crypto";
import { isIP } from "net";
import {
  DEFERRED_LINK_TTL_SECONDS,
  type DeferredLinkPlatform,
  type ParsedVehicleLink,
  type VehicleLinkKind,
} from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { rateLimit } from "../../utils/rateLimiter.js";

/**
 * Deferred deep links (#16). The website's /app/vehicle/:id page records the
 * vehicle a visitor opened just before it sends them to the app store; the app
 * claims it on its first launch and opens that vehicle.
 *
 * The only thing tying the two together is the visitor's network address and
 * platform: an entry is keyed by a SHA-256 of the client IP (IPv6 reduced to
 * its /64, which survives privacy-address rotation) plus "android" / "ios". The
 * raw IP is never stored; the value holds only the vehicle path. Entries expire
 * after DEFERRED_LINK_TTL_SECONDS and a claim deletes the entry atomically.
 */

const KEY_PREFIX = "deferredlink:v1";
const RATE_WINDOW_SECONDS = 600;
// Generous on purpose: carrier-grade NAT puts many phones behind one IPv4.
const RECORD_LIMIT_PER_WINDOW = 60;
const CLAIM_LIMIT_PER_WINDOW = 60;

export interface DeferredLinkEntry {
  path: string;
  vehicleId: string;
  kind: VehicleLinkKind;
  createdAt: string;
}

// GET then DEL in one step, so two first launches can't both receive the link.
// (GETDEL needs Redis 6.2+; this works on every version.)
const CLAIM_SCRIPT = `local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`;

function ipv6Prefix64(addr: string): string | null {
  // An embedded IPv4 tail (e.g. 64:ff9b::192.0.2.1) fills the last two groups.
  const lower = addr.toLowerCase().replace(/\d+\.\d+\.\d+\.\d+$/, "0:0");
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * The network identity used to match the browser visit with the app's first
 * launch: the IPv4 address, or the IPv6 /64. Null when there is no usable IP.
 */
export function clientNetworkKey(ip: string | undefined | null): string | null {
  if (!ip) return null;
  let addr = ip.trim();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.toLowerCase().startsWith("::ffff:") && isIP(addr.slice(7)) === 4) {
    addr = addr.slice(7);
  }
  const version = isIP(addr);
  if (version === 4) return addr;
  if (version === 6) return ipv6Prefix64(addr);
  return null;
}

function hashNetwork(networkKey: string): string {
  return createHash("sha256").update(`deferred-link|${networkKey}`).digest("base64url").slice(0, 32);
}

function entryKey(platform: DeferredLinkPlatform, networkKey: string): string {
  return `${KEY_PREFIX}:${platform}:${hashNetwork(networkKey)}`;
}

/**
 * Platform from the User-Agent when the caller didn't say: mobile browsers
 * (Android / iPhone / iPad / iPod) and the app's own HTTP stacks (okhttp on
 * Android, CFNetwork / Darwin on iOS). iPadOS Safari reports a Mac UA, so the
 * website must send platform explicitly.
 */
export function detectPlatformFromUserAgent(ua: string | undefined): DeferredLinkPlatform | null {
  if (!ua) return null;
  if (/android|okhttp/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|cfnetwork|darwin/i.test(ua)) return "ios";
  return null;
}

/** False when this network has used up its allowance for the action. */
export async function deferredLinkRateLimitOk(
  action: "record" | "claim",
  networkKey: string,
): Promise<boolean> {
  const limit = action === "record" ? RECORD_LIMIT_PER_WINDOW : CLAIM_LIMIT_PER_WINDOW;
  return rateLimit(`${KEY_PREFIX}:rl:${action}:${hashNetwork(networkKey)}`, limit, RATE_WINDOW_SECONDS);
}

/** Saves (or replaces) the network's pending link for the platform. */
export async function recordDeferredLink(
  networkKey: string,
  platform: DeferredLinkPlatform,
  link: ParsedVehicleLink,
): Promise<DeferredLinkEntry & { expiresAt: string }> {
  const now = new Date();
  const entry: DeferredLinkEntry = {
    path: link.appPath,
    vehicleId: link.vehicleId,
    kind: link.kind,
    createdAt: now.toISOString(),
  };
  await redis.set(entryKey(platform, networkKey), JSON.stringify(entry), "EX", DEFERRED_LINK_TTL_SECONDS);
  return {
    ...entry,
    expiresAt: new Date(now.getTime() + DEFERRED_LINK_TTL_SECONDS * 1000).toISOString(),
  };
}

/** Returns and deletes the network's pending link for the platform, if any. */
export async function claimDeferredLink(
  networkKey: string,
  platform: DeferredLinkPlatform,
): Promise<DeferredLinkEntry | null> {
  const raw = (await redis.eval(CLAIM_SCRIPT, 1, entryKey(platform, networkKey))) as string | null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeferredLinkEntry>;
    if (
      typeof parsed.path !== "string" ||
      typeof parsed.vehicleId !== "string" ||
      (parsed.kind !== "group" && parsed.kind !== "vehicle") ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return {
      path: parsed.path,
      vehicleId: parsed.vehicleId,
      kind: parsed.kind,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}
