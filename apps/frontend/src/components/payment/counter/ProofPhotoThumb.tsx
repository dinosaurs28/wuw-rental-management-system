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
  /**
   * Every photo of the payment (`proofs` on transaction rows — up to 3 when the
   * customer paid in several UPI transactions). The thumbnail shows the first;
   * the viewer pages through all of them.
   */
  photos?: (ProofPhotoInfo | null | undefined)[] | null;
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
export function ProofPhotoThumb({ photo, photos, caption, size = "sm", className }: ProofPhotoThumbProps) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const all = (photos ?? []).filter((p): p is ProofPhotoInfo => !!p?.url);
  const list = all.length > 0 ? all : photo?.url ? [photo] : [];
  const first = list[0];
  if (!first) return null;
  const many = list.length > 1;

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
        aria-label={many ? `View the ${list.length} UPI payment photos` : "View the UPI payment photo"}
        title={many ? `View the ${list.length} UPI payment photos` : "View the UPI payment photo"}
      >
        <img src={first.url} alt="UPI payment screen" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        {many ? (
          <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold leading-4 text-white">
            {list.length}
          </span>
        ) : null}
        {size !== "sm" && <ZoomBadge />}
      </button>
      <PhotoLightbox
        open={open}
        onOpenChange={setOpen}
        title={many ? "UPI payment photos" : "UPI payment photo"}
        items={list.map((p, i) => ({
          url: p.url,
          mime: p.mime ?? "image/jpeg",
          label: many ? `${caption ? `${caption} · ` : ""}Screenshot ${i + 1} of ${list.length}` : (caption ?? null),
        }))}
      />
    </>
  );
}
