import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import type { VehicleSwap } from "@/types/vehicleSwap";

export const SWAP_PHOTOS_MISSING_NOTE =
  "No photos were taken of the replacement vehicle at the swap — check its condition carefully.";

/**
 * The replacement's photos taken at a mid-rental swap (swap history), or the
 * warning when none were taken (older app build). Renders nothing for a swap
 * that needs no photos (before pickup) or rows from an older server.
 */
export function SwapPhotoStrip({ swap, className }: { swap: VehicleSwap; className?: string }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const photos = swap.photos ?? [];
  const regNo = swap.newVehicle?.regNo;

  if (swap.photosMissing) {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs text-amber-700", className)}>
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        {SWAP_PHOTOS_MISSING_NOTE}
      </p>
    );
  }
  if (photos.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {photos.map((photo, i) => (
        <button
          key={photo.publicId}
          type="button"
          onClick={() => setViewerIndex(i)}
          className="relative h-12 w-16 overflow-hidden rounded border bg-gray-50 cursor-zoom-in"
          aria-label={`View ${photo.captureLabel ?? "swap"} photo`}
          title={photo.captureLabel ?? undefined}
        >
          <img src={photo.url} alt={photo.captureLabel ?? "Swap photo"} className="h-full w-full object-cover" loading="lazy" />
          <span className="absolute top-0.5 left-0.5 min-w-4 h-4 px-0.5 rounded-full bg-black/65 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums pointer-events-none">
            {i + 1}
          </span>
          <ZoomBadge />
        </button>
      ))}
      <PhotoLightbox
        open={viewerIndex !== null}
        onOpenChange={(o) => !o && setViewerIndex(null)}
        items={photos.map((p, i) => ({
          url: p.url,
          mime: p.mime,
          label: `${regNo ? `${regNo} at swap` : "At swap"} #${i + 1}${p.captureLabel ? ` · ${p.captureLabel}` : ""}`,
        }))}
        startIndex={viewerIndex ?? 0}
        title={regNo ? `Photos of ${regNo} at the swap` : "Photos at the swap"}
      />
    </div>
  );
}
