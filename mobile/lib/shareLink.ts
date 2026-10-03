/**
 * Vehicle share links and deferred deep links (#16). Mirror of
 * packages/schemas/src/share-link.ts (mobile does not import @repo/schemas) —
 * keep the two in sync. The zod request bodies are server-only and not copied.
 *
 *   Share link : https://whatuwantrentals.com/app/vehicle/<id>
 *   App route  : /vehicle/<id>          (app/vehicle/[id].tsx takes both kinds)
 *   Web routes : /vehicle/group/<key>   and /vehicle/<publicId>
 *
 * <id> is either a vehicle GROUP KEY exactly as the public listing returns it
 * (MAKE__MODEL__categoryId__branchId, e.g. "MARUTI SUZUKI__SWIFT__3__1") or a
 * single vehicle's publicId (nanoid). Ids are always URI-encoded inside paths
 * and URLs (group keys contain spaces).
 */

export const SHARE_LINK_HOST = 'whatuwantrentals.com';
export const SHARE_LINK_ORIGIN = `https://${SHARE_LINK_HOST}`;
export const VEHICLE_SHARE_PATH_PREFIX = '/app/vehicle/';
export const VEHICLE_APP_PATH_PREFIX = '/vehicle/';

export const VEHICLE_SHARE_MESSAGE_LEAD =
  'Check out this vehicle I found! You can view the details and book it here:';

/** Longest id accepted in a share / deferred link (group keys carry make + model). */
export const VEHICLE_LINK_ID_MAX = 200;

/** Android install referrer: the Play Store link carries referrer=vehicle%3D<id>. */
export const INSTALL_REFERRER_VEHICLE_PARAM = 'vehicle';

/** A recorded deferred link lives this long (seconds) unless claimed earlier. */
export const DEFERRED_LINK_TTL_SECONDS = 3600;

export const DEFERRED_LINK_PLATFORMS = ['android', 'ios'] as const;
export type DeferredLinkPlatform = (typeof DEFERRED_LINK_PLATFORMS)[number];

export type VehicleLinkKind = 'group' | 'vehicle';

export interface ParsedVehicleLink {
  /** The raw (decoded) id: a group key or a vehicle publicId. */
  vehicleId: string;
  kind: VehicleLinkKind;
  /** The in-app route, id encoded: /vehicle/<id>. */
  appPath: string;
}

const GROUP_KEY_RE = /^.+__.+__\d+__\d+$/;
const VEHICLE_PUBLIC_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_ID_CHARS_RE = /[\u0000-\u001f\u007f?#]/;

/** True for a group key (MAKE__MODEL__categoryId__branchId). */
export function isVehicleGroupKey(id: string): boolean {
  return GROUP_KEY_RE.test(id);
}

export function vehicleLinkKind(id: string): VehicleLinkKind {
  return isVehicleGroupKey(id) ? 'group' : 'vehicle';
}

/** A decoded id that may appear in a share link: a group key or a vehicle publicId. */
export function isValidVehicleLinkId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length < 1 || id.length > VEHICLE_LINK_ID_MAX) return false;
  if (UNSAFE_ID_CHARS_RE.test(id)) return false;
  return isVehicleGroupKey(id) || VEHICLE_PUBLIC_ID_RE.test(id);
}

/** https://whatuwantrentals.com/app/vehicle/<id> */
export function buildVehicleShareUrl(id: string, origin: string = SHARE_LINK_ORIGIN): string {
  return `${origin.replace(/\/+$/, '')}${VEHICLE_SHARE_PATH_PREFIX}${encodeURIComponent(id)}`;
}

/** The text sent with a share: never a bare link. */
export function buildVehicleShareMessage(id: string, origin: string = SHARE_LINK_ORIGIN): string {
  return `${VEHICLE_SHARE_MESSAGE_LEAD} ${buildVehicleShareUrl(id, origin)}`;
}

/** In-app route for the vehicle page. */
export function vehicleAppPath(id: string): string {
  return `${VEHICLE_APP_PATH_PREFIX}${encodeURIComponent(id)}`;
}

/** Website route for the vehicle page (group page for group keys). */
export function vehicleWebPath(id: string): string {
  return isVehicleGroupKey(id)
    ? `/vehicle/group/${encodeURIComponent(id)}`
    : `/vehicle/${encodeURIComponent(id)}`;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Accepts "/vehicle/<id>", "/app/vehicle/<id>", the website's
 * "/vehicle/group/<key>" or a full https://(www.)whatuwantrentals.com/... URL of
 * those shapes (query / fragment ignored). The id may be raw or URI-encoded, but
 * a "/" inside it must be encoded. Returns null for anything else.
 */
export function parseVehicleLinkPath(input: string): ParsedVehicleLink | null {
  if (typeof input !== 'string') return null;
  let path = input.trim();
  const hostRe = new RegExp(`^https?://(www\\.)?${SHARE_LINK_HOST.replace(/\./g, '\\.')}(?=/|$)`, 'i');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    if (!hostRe.test(path)) return null;
    path = path.replace(hostRe, '');
  }
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);

  let rest: string;
  if (path.startsWith(VEHICLE_SHARE_PATH_PREFIX)) {
    rest = path.slice(VEHICLE_SHARE_PATH_PREFIX.length);
  } else if (path.startsWith(VEHICLE_APP_PATH_PREFIX)) {
    rest = path.slice(VEHICLE_APP_PATH_PREFIX.length);
    if (rest.startsWith('group/')) rest = rest.slice('group/'.length);
  } else {
    return null;
  }
  rest = rest.replace(/\/$/, '');
  if (rest.includes('/')) return null;
  const vehicleId = safeDecode(rest);
  if (!vehicleId || !isValidVehicleLinkId(vehicleId)) return null;
  return { vehicleId, kind: vehicleLinkKind(vehicleId), appPath: vehicleAppPath(vehicleId) };
}

/**
 * Play Store URL that hands the vehicle to the app after install
 * (…&referrer=vehicle%3D<id>; the id itself is encoded once more inside).
 */
export function buildPlayStoreUrlWithReferrer(storeUrl: string, id: string): string {
  const referrer = `${INSTALL_REFERRER_VEHICLE_PARAM}=${encodeURIComponent(id)}`;
  const sep = storeUrl.includes('?') ? '&' : '?';
  return `${storeUrl}${sep}referrer=${encodeURIComponent(referrer)}`;
}

/**
 * Reads the vehicle id out of an Android install referrer string
 * ("vehicle=<id>", possibly alongside utm_* params, possibly still encoded).
 * Returns null when there is none or it is not a valid id.
 */
export function parseInstallReferrerVehicleId(referrer: string | null | undefined): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  let raw = referrer.trim();
  if (!raw.includes('=') && /%3d/i.test(raw)) raw = safeDecode(raw) ?? raw;
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq) !== INSTALL_REFERRER_VEHICLE_PARAM) continue;
    const id = safeDecode(pair.slice(eq + 1).replace(/\+/g, ' '));
    return id && isValidVehicleLinkId(id) ? id : null;
  }
  return null;
}

/**
 * The in-app vehicle route for a URL the OS hands the app — an Android App Link
 * / iOS Universal Link (https://whatuwantrentals.com/app/vehicle/<id>, the
 * website's /vehicle/<id> or /vehicle/group/<key>) or the custom scheme
 * (wuw://app/vehicle/<id>). Null when it isn't a vehicle link.
 */
export function vehicleAppPathFromSystemUrl(url: string): string | null {
  if (typeof url !== 'string' || !url) return null;
  const direct = parseVehicleLinkPath(url);
  if (direct) return direct.appPath;
  // Custom scheme: everything after "<scheme>://" is the path (the "host" is
  // its first segment), as expo-router reads it.
  const custom = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (!custom || /^https?$/i.test(custom[1])) return null;
  const parsed = parseVehicleLinkPath(`/${custom[2].replace(/^\/+/, '')}`);
  return parsed ? parsed.appPath : null;
}
