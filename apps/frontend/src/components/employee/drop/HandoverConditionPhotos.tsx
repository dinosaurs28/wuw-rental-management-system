import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZoomBadge, type LightboxItem } from "@/components/ui/PhotoLightbox";
import { SWAP_PHOTOS_MISSING_NOTE } from "@/components/swap/SwapPhotoStrip";

/**
 * GET /employee/return/:bookingId/pickup-captures. `photos` = the pickup
 * photos; the rest (client item 2) is absent on older servers.
 */
export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  url: string;
  mime: string;
}

export interface ConditionPhotoSet {
  /** PICKUP = handover photos, SWAP = the replacement's photos at a mid-rental swap */
  source: "PICKUP" | "SWAP";
  vehicle: { regNo: string; make: string; model: string } | null;
  takenAt: string | null;
  swapPublicId: string | null;
  /** A mid-rental swap where no photo of the replacement was taken */
  photosMissing: boolean;
  /** This car was swapped out later in the rental */
  replaced: boolean;
  photos: ConditionPhoto[];
}

export interface ReturnConditionCaptures {
  photos: ConditionPhoto[];
  /** The car being returned: its own handover photos */
  currentVehicleCaptures?: ConditionPhotoSet;
  /** Swapped-out cars, newest first, the original pickup last */
  earlierCaptures?: ConditionPhotoSet[];
  swapped?: boolean;
  photosMissing?: boolean;
}

const fmt = (iso: string) => format(new Date(iso), "d MMM, h:mm a");

/** Something to show: photos of the returning car, its missing-photos warning, or earlier cars' photos. */
export function hasHandoverReference(data?: ReturnConditionCaptures | null): boolean {
  if (!data) return false;
  const current = data.currentVehicleCaptures;
  if (!current) return data.photos.length > 0;
  return current.photos.length > 0 || current.photosMissing || (data.earlierCaptures?.length ?? 0) > 0;
}

/** Heading of the reference block: the car's handover at its swap, or the pickup. */
export function handoverReferenceHeading(data?: ReturnConditionCaptures | null): {
  title: string;
  subtitle: string;
} {
  const current = data?.currentVehicleCaptures;
  if (current?.source === "SWAP") {
    return {
      title: "Condition at handover",
      subtitle: `${current.vehicle?.regNo ?? "The replacement"} was handed over at a swap${
        current.takenAt ? ` on ${fmt(current.takenAt)}` : ""
      } — compare against its current condition`,
    };
  }
  return {
    title: "Pre-delivery Reference Photos",
    subtitle: "Taken at vehicle pickup — compare against current condition",
  };
}

function setTitle(set: ConditionPhotoSet): string {
  const reg = set.vehicle?.regNo;
  if (set.source === "SWAP") {
    return `Photos of ${reg ?? "the replacement"} at swap${set.takenAt ? `, ${fmt(set.takenAt)}` : ""}${
      set.replaced ? " (replaced)" : ""
    }`;
  }
  return set.replaced ? `Original pickup — ${reg ?? "first vehicle"} (replaced)` : `Pickup${reg ? ` — ${reg}` : ""}`;
}

function lightboxItems(set: ConditionPhotoSet): LightboxItem[] {
  const prefix = set.source === "SWAP" ? `${set.vehicle?.regNo ?? "Swap"} at swap` : "Pickup";
  return set.photos.map((p, i) => ({
    url: p.url,
    mime: p.mime,
    label: p.captureLabel ? `${prefix}: ${p.captureLabel}` : `${prefix} photo ${i + 1}`,
  }));
}

function PhotoGrid({
  set,
  onOpen,
  gridClassName,
}: {
  set: ConditionPhotoSet;
  onOpen: (items: LightboxItem[], index: number) => void;
  gridClassName: string;
}) {
  const items = lightboxItems(set);
  return (
    <div className={cn("grid gap-3", gridClassName)}>
      {set.photos.map((photo, i) => (
        <div key={photo.publicId} className="rounded-lg overflow-hidden border bg-gray-50">
          <button
            type="button"
            className="relative block w-full group"
            onClick={() => onOpen(items, i)}
            aria-label="View handover photo"
          >
            <img
              src={photo.url}
              alt={photo.captureLabel ?? "Handover photo"}
              className="w-full h-28 object-cover cursor-zoom-in"
              loading="lazy"
            />
            <ZoomBadge />
          </button>
          {photo.captureLabel && (
            <div className="px-2 py-1 bg-white border-t">
              <p className="text-xs font-medium truncate">{photo.captureLabel}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EarlierSet({
  set,
  onOpen,
  gridClassName,
}: {
  set: ConditionPhotoSet;
  onOpen: (items: LightboxItem[], index: number) => void;
  gridClassName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="flex-1 font-medium">{setTitle(set)}</span>
        <span className="text-xs text-gray-400">
          {set.photos.length} photo{set.photos.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <PhotoGrid set={set} onOpen={onOpen} gridClassName={gridClassName} />
        </div>
      )}
    </div>
  );
}

/**
 * Drop screen reference photos (client item 2): the handover photos of the car
 * actually being returned — after a mid-rental swap, the replacement's photos
 * taken at the swap (or a warning when none were taken) — with the swapped-out
 * cars' photos collapsed below.
 */
export function HandoverConditionPhotos({
  data,
  onOpen,
  gridClassName = "grid-cols-2 sm:grid-cols-4",
}: {
  data: ReturnConditionCaptures;
  onOpen: (items: LightboxItem[], index: number) => void;
  gridClassName?: string;
}) {
  const current: ConditionPhotoSet = data.currentVehicleCaptures ?? {
    source: "PICKUP",
    vehicle: null,
    takenAt: null,
    swapPublicId: null,
    photosMissing: false,
    replaced: false,
    photos: data.photos,
  };
  const earlier = data.earlierCaptures ?? [];

  return (
    <div className="space-y-3">
      {current.photosMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            {current.vehicle?.regNo ? `${current.vehicle.regNo}: ` : ""}
            {SWAP_PHOTOS_MISSING_NOTE}
          </p>
        </div>
      )}
      {current.photos.length > 0 && (
        <>
          {current.source === "SWAP" && (
            <p className="text-xs font-medium text-gray-600">{setTitle(current)}</p>
          )}
          <PhotoGrid set={current} onOpen={onOpen} gridClassName={gridClassName} />
        </>
      )}
      {earlier.map((set) => (
        <EarlierSet
          key={set.swapPublicId ?? "pickup"}
          set={set}
          onOpen={onOpen}
          gridClassName={gridClassName}
        />
      ))}
    </div>
  );
}
