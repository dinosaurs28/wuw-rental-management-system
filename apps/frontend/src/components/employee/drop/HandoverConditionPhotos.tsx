import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ImageOff, Images, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge, type LightboxItem } from "@/components/ui/PhotoLightbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SWAP_PHOTOS_MISSING_NOTE } from "@/components/swap/SwapPhotoStrip";
import { usePhotoFallback } from "./usePhotoFallback";

/** A photo's number in its set (the order taken): #1 at pickup is compared with #1 at the drop. */
export function PhotoNumber({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn(
        "absolute top-1 left-1 z-[1] min-w-5 h-5 px-1 rounded-full bg-black/65 text-white text-[11px] font-semibold flex items-center justify-center tabular-nums pointer-events-none",
        className,
      )}
    >
      {n}
    </span>
  );
}

/**
 * GET /employee/return/:bookingId/pickup-captures. `photos` = the pickup
 * photos; the rest (client item 2) is absent on older servers.
 */
export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  /** The original (full-screen viewer) */
  url: string;
  /** ~1200 px copy for the strip; absent on older servers */
  displayUrl?: string;
  /** When the photo was saved; absent on older servers */
  takenAt?: string;
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

/** Photos shown on the drop screen itself; the rest are behind "View all" (client TODO 8). */
export const PREVIEW_COUNT = 2;

/** "Photo 3 · Front left": the photos come in the order they were taken (older ones: as saved). */
export function photoCaption(index: number, label: string | null | undefined): string {
  return `Photo ${index + 1}${label ? ` · ${label}` : ""}`;
}

function lightboxItems(set: ConditionPhotoSet): LightboxItem[] {
  const prefix = set.source === "SWAP" ? `${set.vehicle?.regNo ?? "Swap"} at swap · ` : "";
  return set.photos.map((p, i) => ({
    url: p.url,
    previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : null,
    mime: p.mime,
    label: `${prefix}${photoCaption(i, p.captureLabel)}`,
  }));
}

/**
 * A photo: loading skeleton; the display copy first, the original if it
 * fails, two automatic retries with backoff, then a "Retry" button
 * (usePhotoFallback). The original is offered through srcset for screens
 * dense enough to use it. Off-screen photos load lazily (fewer requests at
 * once to the photo host).
 */
function PhotoImage({ photo, alt, sizes }: { photo: ConditionPhoto; alt: string; sizes: string }) {
  const { src, usingDisplay, attempt, status, onLoad, onError, retry: restart } = usePhotoFallback(photo.url, photo.displayUrl);
  const retry = (e: React.MouseEvent) => {
    e.stopPropagation();
    restart();
  };
  const withOriginal = usingDisplay && src !== photo.url;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-gray-200" />}
      {status === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500">
          <ImageOff className="h-6 w-6" />
          <span className="text-xs">Photo didn&apos;t load</span>
          <span
            role="button"
            tabIndex={0}
            onClick={retry}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") retry(e as unknown as React.MouseEvent);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </span>
        </div>
      ) : (
        <img
          key={attempt}
          src={src}
          srcSet={withOriginal ? `${src} 1200w, ${photo.url} 2000w` : undefined}
          sizes={withOriginal ? sizes : undefined}
          alt={alt}
          className={cn(
            "absolute inset-0 h-full w-full object-cover cursor-zoom-in transition-opacity",
            status === "loaded" ? "opacity-100" : "opacity-0",
          )}
          loading="lazy"
          decoding="async"
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}

/** One photo with its number, and its caption and time under it. Click = zoomable viewer. */
function PhotoCard({
  photo,
  index,
  total,
  sizes,
  onOpen,
}: {
  photo: ConditionPhoto;
  index: number;
  total: number;
  sizes: string;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden border bg-white">
      <button
        type="button"
        className="relative block w-full group"
        onClick={onOpen}
        aria-label={`View handover photo ${index + 1} of ${total}${photo.captureLabel ? `, ${photo.captureLabel}` : ""}`}
      >
        <PhotoImage photo={photo} alt={photo.captureLabel ?? "Handover photo"} sizes={sizes} />
        <PhotoNumber n={index + 1} className="top-2 left-2 min-w-6 h-6 text-xs" />
        <ZoomBadge />
      </button>
      <div className="flex items-baseline gap-2 px-3 py-2 border-t">
        <p className="flex-1 text-sm font-medium truncate">{photoCaption(index, photo.captureLabel)}</p>
        {photo.takenAt && <p className="text-xs text-gray-500 shrink-0">{fmt(photo.takenAt)}</p>}
      </div>
    </div>
  );
}

/**
 * "View all": every photo, one full-width photo per row in the order taken —
 * the returning car's set first, then (after a swap) the earlier cars' sets.
 * Its own lightbox, nested so it stacks above this dialog.
 */
function AllPhotosDialog({
  open,
  onOpenChange,
  current,
  earlier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ConditionPhotoSet;
  earlier: ConditionPhotoSet[];
}) {
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const sets = [current, ...earlier].filter((s) => s.photos.length > 0);
  const total = current.photos.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle>
            {current.source === "SWAP" ? "Handover photos" : "Pickup photos"}
            {total > 0 ? ` (${total})` : ""}
          </DialogTitle>
          <DialogDescription>In the order they were taken. Click a photo to zoom.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-4 py-4 space-y-5">
          {sets.map((set, si) => (
            <div key={set.swapPublicId ?? `pickup-${si}`} className="space-y-4">
              {(si > 0 || set.source === "SWAP" || earlier.length > 0) && (
                <p className="text-sm font-semibold text-gray-700">
                  {setTitle(set)} · {set.photos.length} photo{set.photos.length === 1 ? "" : "s"}
                </p>
              )}
              {set.photos.map((photo, i) => (
                <PhotoCard
                  key={photo.publicId}
                  photo={photo}
                  index={i}
                  total={set.photos.length}
                  sizes="(min-width: 672px) 640px, 90vw"
                  onOpen={() => setLightbox({ items: lightboxItems(set), index: i })}
                />
              ))}
            </div>
          ))}
        </div>
        <PhotoLightbox
          open={!!lightbox}
          onOpenChange={(o) => !o && setLightbox(null)}
          items={lightbox?.items ?? []}
          startIndex={lightbox?.index ?? 0}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Drop screen reference photos (client item 2; TODO 8): the first photos of the
 * car actually being returned — after a mid-rental swap, the replacement's
 * photos taken at the swap (or a warning when none were taken) — and
 * "View all (N)", a dialog with every photo, the swapped-out cars' sets below.
 */
export function HandoverConditionPhotos({
  data,
  onOpen,
}: {
  data: ReturnConditionCaptures;
  onOpen: (items: LightboxItem[], index: number) => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const current: ConditionPhotoSet = data.currentVehicleCaptures ?? {
    source: "PICKUP",
    vehicle: null,
    takenAt: null,
    swapPublicId: null,
    photosMissing: false,
    replaced: false,
    photos: data.photos,
  };
  const earlier = (data.earlierCaptures ?? []).filter((s) => s.photos.length > 0);
  const preview = current.photos.slice(0, PREVIEW_COUNT);
  const total = current.photos.length;
  const earlierCount = earlier.reduce((n, s) => n + s.photos.length, 0);

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
      {preview.length > 0 && (
        <>
          {current.source === "SWAP" && <p className="text-xs font-medium text-gray-600">{setTitle(current)}</p>}
          <div className={cn("grid gap-3", preview.length > 1 ? "grid-cols-2" : "grid-cols-1 max-w-[520px]")}>
            {preview.map((photo, i) => (
              <PhotoCard
                key={photo.publicId}
                photo={photo}
                index={i}
                total={total}
                sizes={preview.length > 1 ? "(min-width: 640px) 320px, 45vw" : "(min-width: 640px) 520px, 90vw"}
                onOpen={() => onOpen(lightboxItems(current), i)}
              />
            ))}
          </div>
        </>
      )}
      {(total > preview.length || earlierCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setAllOpen(true)}>
            <Images className="h-4 w-4" />
            {total > 0 ? `View all (${total})` : `View earlier photos (${earlierCount})`}
          </Button>
          {earlierCount > 0 && total > 0 && (
            <span className="text-xs text-gray-500">
              The earlier car{earlier.length === 1 ? "'s" : "s'"} photos ({earlierCount}) are in View all.
            </span>
          )}
        </div>
      )}
      <AllPhotosDialog open={allOpen} onOpenChange={setAllOpen} current={current} earlier={earlier} />
    </div>
  );
}
