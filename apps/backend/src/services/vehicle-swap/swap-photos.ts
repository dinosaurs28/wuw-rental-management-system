/**
 * Photos of the replacement car at a mid-rental swap (client item 2) — the
 * pure rules, no database.
 *
 *  - Required shots: every REQUIRED labelled shot of the branch's pickup
 *    capture config for the replacement's category; a config with no required
 *    shot needs at least one photo; no config needs at least four.
 *  - Who must send them: a request carrying `replacementPhotos` (current app
 *    builds and the web portals, even as an empty list) is held to the rule.
 *    Old app builds (1.0.0 / 1.0.1) don't send the field: their swap goes
 *    ahead and is flagged as taken without photos.
 *  - FASTag balances (both cars' balance at the swap) follow the same rule,
 *    required for the cars marked as having a FASTag; a balance read for any
 *    other car is kept too.
 *  - At the drop, the car coming back is shown with the photos of its own
 *    handover: the last mid-rental swap's, else the pickup's.
 */

/** Photos needed at a swap when the branch has no capture config for the category. */
export const MIN_SWAP_PHOTOS_WITHOUT_CONFIG = 4;

export interface CaptureField {
  name: string;
  required: boolean;
}

/** VehiclePhotoCaptureConfig.fields (JSON) → its valid fields, names trimmed, repeats dropped. */
export function parseCaptureFields(raw: unknown): CaptureField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: CaptureField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name.trim() : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    fields.push({ name, required: (item as { required?: unknown }).required === true });
  }
  return fields;
}

export interface SwapPhotoRequirement {
  /** The capture config's labelled shots ([] = the branch has no config for the category) */
  fields: CaptureField[];
  /** Fewest photos in all (labelled + extra) */
  minPhotos: number;
}

export function swapPhotoRequirement(fields: CaptureField[]): SwapPhotoRequirement {
  if (fields.length === 0) return { fields, minPhotos: MIN_SWAP_PHOTOS_WITHOUT_CONFIG };
  return { fields, minPhotos: Math.max(1, fields.filter((f) => f.required).length) };
}

export interface ReplacementPhotoInput {
  fileId: string;
  label?: string;
}

/**
 * NOT_REQUIRED = before pickup (the pickup photographs the new car) or the
 * extension path (no camera step); LEGACY = an old app build that doesn't
 * send the field; STRICT = photos and FASTag balances are required.
 */
export type SwapPhotoMode = "NOT_REQUIRED" | "LEGACY" | "STRICT";

export function swapPhotoMode(input: {
  stage: "PRE_PICKUP" | "ACTIVE_RENTAL";
  source: "STAFF" | "EXTENSION";
  replacementPhotos: ReplacementPhotoInput[] | undefined;
}): SwapPhotoMode {
  if (input.stage !== "ACTIVE_RENTAL" || input.source !== "STAFF") return "NOT_REQUIRED";
  return input.replacementPhotos === undefined ? "LEGACY" : "STRICT";
}

/**
 * One entry per file (a file sent twice counts once). Labels matching a config
 * shot (any case) take the config's spelling; a blank label is an extra photo.
 * Two different files for one label can't both be kept: the last one is, and
 * the earlier ones come back in `duplicates` — the swap refuses them
 * (SWAP_PHOTOS_INVALID) rather than leave them unattached.
 */
export function normalizeReplacementPhotos(
  photos: ReplacementPhotoInput[],
  fields: CaptureField[],
): { photos: ReplacementPhotoInput[]; duplicates: string[] } {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.name]));
  const seenFiles = new Set<string>();
  const labelled = new Map<string, ReplacementPhotoInput>();
  const extra: ReplacementPhotoInput[] = [];
  const duplicates: string[] = [];
  for (const photo of photos) {
    const fileId = photo.fileId.trim();
    if (!fileId || seenFiles.has(fileId)) continue;
    seenFiles.add(fileId);
    const typed = photo.label?.trim();
    if (!typed) {
      extra.push({ fileId });
      continue;
    }
    const label = byName.get(typed.toLowerCase()) ?? typed;
    const earlier = labelled.get(label.toLowerCase());
    if (earlier) duplicates.push(earlier.fileId);
    labelled.delete(label.toLowerCase());
    labelled.set(label.toLowerCase(), { fileId, label });
  }
  return { photos: [...labelled.values(), ...extra], duplicates };
}

export interface SwapPhotoShortfall {
  /** Required capture-config shots with no photo */
  missingLabels: string[];
  minPhotos: number;
  photoCount: number;
}

/** What is still missing from (normalized) photos; null = enough. */
export function replacementPhotoShortfall(
  photos: ReplacementPhotoInput[],
  requirement: SwapPhotoRequirement,
): SwapPhotoShortfall | null {
  const taken = new Set(photos.map((p) => p.label?.toLowerCase()).filter((l): l is string => !!l));
  const missingLabels = requirement.fields
    .filter((f) => f.required && !taken.has(f.name.toLowerCase()))
    .map((f) => f.name);
  if (missingLabels.length === 0 && photos.length >= requirement.minPhotos) return null;
  return { missingLabels, minPhotos: requirement.minPhotos, photoCount: photos.length };
}

export type FastagBalanceField = "oldVehicleFastagBalance" | "newVehicleFastagBalance";

export interface FastagBalanceInput {
  stage: "PRE_PICKUP" | "ACTIVE_RENTAL";
  oldVehicleHasFastag: boolean;
  newVehicleHasFastag: boolean;
  oldVehicleFastagBalance?: number;
  newVehicleFastagBalance?: number;
}

/**
 * The balances stored on the swap: only mid-rental, for any car they were read
 * for — a car not marked as having a FASTag counts as one for the booking once a
 * balance is recorded for it (fastag-usage countsAsFastagCar).
 */
export function fastagBalancesToStore(input: FastagBalanceInput): {
  oldVehicleFastagBalance: number | null;
  newVehicleFastagBalance: number | null;
} {
  const midRental = input.stage === "ACTIVE_RENTAL";
  return {
    oldVehicleFastagBalance: midRental ? (input.oldVehicleFastagBalance ?? null) : null,
    newVehicleFastagBalance: midRental ? (input.newVehicleFastagBalance ?? null) : null,
  };
}

/** Balances a STRICT swap still needs — only cars marked as having a FASTag (none in the other modes). */
export function missingFastagBalances(mode: SwapPhotoMode, input: FastagBalanceInput): FastagBalanceField[] {
  if (mode !== "STRICT") return [];
  const stored = fastagBalancesToStore(input);
  const missing: FastagBalanceField[] = [];
  if (input.oldVehicleHasFastag && stored.oldVehicleFastagBalance == null) missing.push("oldVehicleFastagBalance");
  if (input.newVehicleHasFastag && stored.newVehicleFastagBalance == null) missing.push("newVehicleFastagBalance");
  return missing;
}

// ── Which photos show the car being returned ────────────────────────────────

export interface VehicleRef {
  regNo: string;
  make: string;
  model: string;
}

export interface SwapWithPhotos<P> {
  publicId: string;
  swappedAt: Date;
  /** PICKED_UP = mid-rental, CONFIRMED = before pickup, null = row from before the column */
  bookingStatusAtSwap: string | null;
  originalVehicle: VehicleRef;
  newVehicle: VehicleRef;
  photos: P[];
}

/**
 * A mid-rental swap: recorded as PICKED_UP; an older row without the status
 * counts when it was made at/after the pickup marker, or always without one
 * (the rule getOdometerSegments uses).
 */
export function isMidRentalSwap(
  swap: { bookingStatusAtSwap: string | null; swappedAt: Date },
  pickedUpAt: Date | null,
): boolean {
  if (swap.bookingStatusAtSwap === "PICKED_UP") return true;
  if (swap.bookingStatusAtSwap != null) return false;
  return !pickedUpAt || swap.swappedAt.getTime() >= pickedUpAt.getTime();
}

/**
 * A mid-rental swap with no photo of the replacement (old app build, or the
 * extension path). The one rule for the swap history and the drop screens.
 */
export function swapPhotosMissing(
  swap: { bookingStatusAtSwap: string | null; swappedAt: Date; photos: unknown[] },
  pickedUpAt: Date | null,
): boolean {
  return isMidRentalSwap(swap, pickedUpAt) && swap.photos.length === 0;
}

export interface ConditionPhotoSet<P> {
  /** PICKUP = the handover photos, SWAP = the replacement's photos at a mid-rental swap */
  source: "PICKUP" | "SWAP";
  /** The car in the photos (null = unknown: pickup photos of a booking that has no car) */
  vehicle: VehicleRef | null;
  /** SWAP: when the swap was made; PICKUP: the first photo's time (null without photos) */
  takenAt: Date | null;
  swapPublicId: string | null;
  /** A mid-rental swap where no photo of the replacement was taken */
  photosMissing: boolean;
  /** The car was swapped out later in the rental */
  replaced: boolean;
  photos: P[];
}

export interface ReturnConditionPhotos<P> {
  /** The car being returned: its own handover photos */
  current: ConditionPhotoSet<P>;
  /** Cars swapped out during the rental, newest first (the original pickup last); sets with photos only */
  earlier: ConditionPhotoSet<P>[];
  /** The booking had a mid-rental swap */
  swapped: boolean;
  /** No photo was taken of the car being returned when it was handed over at a swap */
  photosMissing: boolean;
}

export function selectReturnConditionPhotos<P extends { createdAt: Date }>(input: {
  pickupPhotos: P[];
  swaps: SwapWithPhotos<P>[];
  /** The booking's car now (the one being returned) */
  currentVehicle: VehicleRef | null;
  /** Pickup marker, for swap rows from before bookingStatusAtSwap */
  pickedUpAt: Date | null;
}): ReturnConditionPhotos<P> {
  const firstPhotoAt = input.pickupPhotos.reduce<Date | null>(
    (min, p) => (!min || p.createdAt.getTime() < min.getTime() ? p.createdAt : min),
    null,
  );
  const midSwaps = input.swaps
    .filter((s) => isMidRentalSwap(s, input.pickedUpAt))
    .sort((a, b) => a.swappedAt.getTime() - b.swappedAt.getTime());

  const pickupSet: ConditionPhotoSet<P> = {
    source: "PICKUP",
    vehicle: midSwaps[0]?.originalVehicle ?? input.currentVehicle,
    takenAt: firstPhotoAt,
    swapPublicId: null,
    photosMissing: false,
    replaced: midSwaps.length > 0,
    photos: input.pickupPhotos,
  };
  if (midSwaps.length === 0) {
    return { current: pickupSet, earlier: [], swapped: false, photosMissing: false };
  }

  const swapSets: ConditionPhotoSet<P>[] = midSwaps.map((swap, i) => ({
    source: "SWAP",
    vehicle: swap.newVehicle,
    takenAt: swap.swappedAt,
    swapPublicId: swap.publicId,
    photosMissing: swapPhotosMissing(swap, input.pickedUpAt),
    replaced: i < midSwaps.length - 1,
    photos: swap.photos,
  }));
  const current = swapSets[swapSets.length - 1]!;
  const earlier = [...swapSets.slice(0, -1).reverse(), pickupSet].filter((set) => set.photos.length > 0);
  return { current, earlier, swapped: true, photosMissing: current.photosMissing };
}
