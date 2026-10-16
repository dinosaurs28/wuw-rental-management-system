import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ImageOff, RefreshCw } from "lucide-react";
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

function lightboxItems(set: ConditionPhotoSet): LightboxItem[] {
  const prefix = set.source === "SWAP" ? `${set.vehicle?.regNo ?? "Swap"} at swap` : "Pickup";
  return set.photos.map((p, i) => ({
    url: p.url,
    previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : null,
    mime: p.mime,
    label: p.captureLabel ? `${prefix}: ${p.captureLabel}` : `${prefix} photo ${i + 1}`,
  }));
}

const RETRY_DELAYS_MS = [800, 2500];

/**
 * A strip photo: loading skeleton, two automatic retries with backoff, then
 * a "Retry" button. The display copy is the default source; the original is
 * offered through srcset for screens dense enough to use it.
 */
function StripImage({ photo, alt }: { photo: ConditionPhoto; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const display = photo.displayUrl || photo.url;
  const onError = () => {
    const next = failures + 1;
    setFailures(next);
    const delay = RETRY_DELAYS_MS[next - 1];
    if (delay == null) {
      setStatus("error");
      return;
    }
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay);
  };
  const retry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFailures(0);
    setStatus("loading");
    setAttempt((n) => n + 1);
  };

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
          src={display}
          srcSet={display !== photo.url ? `${display} 1200w, ${photo.url} 2000w` : undefined}
          sizes={display !== photo.url ? "(min-width: 640px) 520px, 85vw" : undefined}
          alt={alt}
          className={cn(
            "absolute inset-0 h-full w-full object-cover cursor-zoom-in transition-opacity",
            status === "loaded" ? "opacity-100" : "opacity-0",
          )}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={onError}
        />
      )}
    </div>
  );
}

/**
 * Large handover photos (client item 6): a horizontal, snapping strip of
 * ~520 px 4:3 photos (85% wide on phones), label and time under each, with a
 * "3 / 8" counter and previous / next buttons.
 */
function PhotoStrip({
  set,
  onOpen,
}: {
  set: ConditionPhotoSet;
  onOpen: (items: LightboxItem[], index: number) => void;
}) {
  const items = lightboxItems(set);
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = set.photos.length;

  const step = () => {
    const el = scroller.current;
    const first = el?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + 12 : 1;
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setIndex(Math.min(Math.max(Math.round(el.scrollLeft / step()), 0), total - 1));
  };
  const go = (to: number) => {
    scroller.current?.scrollTo({ left: Math.min(Math.max(to, 0), total - 1) * step(), behavior: "smooth" });
  };

  return (
    <div className="space-y-2">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 [scrollbar-width:thin]"
      >
        {set.photos.map((photo, i) => (
          <div
            key={photo.publicId}
            className="snap-start shrink-0 w-[85%] sm:w-[520px] rounded-lg overflow-hidden border bg-white"
          >
            <button
              type="button"
              className="relative block w-full group"
              onClick={() => onOpen(items, i)}
              aria-label={`View handover photo ${i + 1} of ${total}${photo.captureLabel ? `, ${photo.captureLabel}` : ""}`}
            >
              <StripImage photo={photo} alt={photo.captureLabel ?? "Handover photo"} />
              <ZoomBadge />
            </button>
            <div className="flex items-baseline gap-2 px-3 py-2 border-t">
              <p className="flex-1 text-sm font-medium truncate">{photo.captureLabel ?? `Photo ${i + 1}`}</p>
              {photo.takenAt && <p className="text-xs text-gray-500 shrink-0">{fmt(photo.takenAt)}</p>}
            </div>
          </div>
        ))}
      </div>
      {total > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous photo"
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-full border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {total <= 12 && (
            <div className="flex items-center gap-1.5">
              {set.photos.map((photo, i) => (
                <button
                  key={photo.publicId}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Go to photo ${i + 1}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-4 bg-[#ff6a1f]" : "w-1.5 bg-gray-300 hover:bg-gray-400",
                  )}
                />
              ))}
            </div>
          )}
          <span className="text-xs font-medium text-gray-500 tabular-nums">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            aria-label="Next photo"
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-full border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function EarlierSet({
  set,
  onOpen,
}: {
  set: ConditionPhotoSet;
  onOpen: (items: LightboxItem[], index: number) => void;
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
          <PhotoStrip set={set} onOpen={onOpen} />
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
}: {
  data: ReturnConditionCaptures;
  onOpen: (items: LightboxItem[], index: number) => void;
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
          <PhotoStrip set={current} onOpen={onOpen} />
        </>
      )}
      {earlier.map((set) => (
        <EarlierSet key={set.swapPublicId ?? "pickup"} set={set} onOpen={onOpen} />
      ))}
    </div>
  );
}
