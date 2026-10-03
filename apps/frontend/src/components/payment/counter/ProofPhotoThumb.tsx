import { useState } from "react";
import { ImageOff } from "lucide-react";

import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { cn } from "@/lib/utils";

/** `proofPhoto` as list endpoints return it (presigned URL, 15 minutes). */
export interface ProofPhotoInfo {
  proofFileId?: string;
  publicId?: string;
  url: string;
  mime?: string | null;
  capturedAt?: string | null;
}

interface ProofPhotoThumbProps {
  photo: ProofPhotoInfo | null | undefined;
  /** Caption in the zoom viewer, e.g. "UPI payment · BK123 · ₹1,200". */
  caption?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-10 w-8",
  md: "h-16 w-12",
  lg: "h-40 w-28",
};

/**
 * Zoomable thumbnail of a UPI payment-screen photo (#3) so the branch manager
 * can check the amount and time before confirming. A broken link (the URL
 * expired) asks for a refresh.
 */
export function ProofPhotoThumb({ photo, caption, size = "sm", className }: ProofPhotoThumbProps) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!photo?.url) return null;

  if (broken) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400",
          SIZES[size],
          className,
        )}
        title="The photo link expired — refresh the list to view it"
      >
        <ImageOff className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "group relative inline-block shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100 cursor-zoom-in",
          SIZES[size],
          className,
        )}
        aria-label="View the UPI payment photo"
        title="View the UPI payment photo"
      >
        <img src={photo.url} alt="UPI payment screen" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        {size !== "sm" && <ZoomBadge />}
      </button>
      <PhotoLightbox
        open={open}
        onOpenChange={setOpen}
        title="UPI payment photo"
        items={[{ url: photo.url, mime: photo.mime ?? "image/jpeg", label: caption ?? null }]}
      />
    </>
  );
}
