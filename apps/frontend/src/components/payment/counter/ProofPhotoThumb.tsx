import { useState } from "react";
import { ImageOff } from "lucide-react";

import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { cn } from "@/lib/utils";

/** `proofPhoto` as list endpoints return it (presigned URL, 15 minutes). */
export interface ProofPhotoInfo {
  proofFileId?: string;
  publicId?: string;
  /** The stored photo (up to 2000 px) — shown in the zoom viewer. */
  url: string;
  /**
   * Nov 2026: ~1200 px copy for showing the photo at a readable size (equals
   * `url` for older photos; missing from older servers → falls back to `url`).
   */
  displayUrl?: string | null;
  mime?: string | null;
  capturedAt?: string | null;
}

interface ProofPhotoThumbProps {
  photo: ProofPhotoInfo | null | undefined;
  /**
   * Every photo of the payment (`proofs` on transaction rows — up to 3 when the
   * customer paid in several UPI transactions). The small sizes show the first
   * and page through all of them in the viewer; "read" shows every photo.
   */
  photos?: (ProofPhotoInfo | null | undefined)[] | null;
  /** Caption in the zoom viewer, e.g. "UPI payment · BK123 · ₹1,200". */
  caption?: string;
  /**
   * sm / md / lg: thumbnails (tight lists). "read": every photo large enough to
   * read the amount, time and reference without zooming (BM review screens).
   */
  size?: "sm" | "md" | "lg" | "read";
  /** What the photo is, for labels: "UPI payment" (default), "Card receipt", "Refund"… */
  kind?: string;
  className?: string;
}

const SIZES = {
  sm: "h-10 w-8",
  md: "h-16 w-12",
  lg: "h-40 w-28",
};

const srcOf = (p: ProofPhotoInfo) => p.displayUrl || p.url;

function BrokenPhoto({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400",
        className,
      )}
      title="The photo link expired — refresh the list to view it"
    >
      <ImageOff className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * A payment-success / receipt photo (#3) so the branch manager can check the
 * amount and time. Shows the ~1200 px display copy (falls back to the
 * original); clicking opens the zoom viewer (PhotoLightbox + ZoomableImage)
 * on the full-size photo. A broken link (the URL expired) asks for a refresh.
 */
export function ProofPhotoThumb({ photo, photos, caption, size = "sm", kind = "UPI payment", className }: ProofPhotoThumbProps) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const all = (photos ?? []).filter((p): p is ProofPhotoInfo => !!p?.url);
  const list = all.length > 0 ? all : photo?.url ? [photo] : [];
  const first = list[0];
  if (!first) return null;
  const many = list.length > 1;
  const noun = kind.toLowerCase().includes("receipt") ? kind : `${kind} photo`;

  const lightbox = (
    <PhotoLightbox
      open={open}
      onOpenChange={setOpen}
      startIndex={start}
      title={many ? `${noun}s` : noun}
      items={list.map((p, i) => ({
        url: p.url,
        previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : null,
        mime: p.mime ?? "image/jpeg",
        label: many ? `${caption ? `${caption} · ` : ""}Photo ${i + 1} of ${list.length}` : (caption ?? null),
      }))}
    />
  );
  const openAt = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setStart(i);
    setOpen(true);
  };

  if (size === "read") {
    return (
      <>
        <div className={cn("flex flex-wrap gap-3", className)}>
          {list.map((p, i) =>
            broken[i] ? (
              <BrokenPhoto key={i} className="h-40 w-28" />
            ) : (
              <button
                key={p.publicId ?? p.proofFileId ?? i}
                type="button"
                onClick={openAt(i)}
                className="group relative block w-[min(320px,80vw)] shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 cursor-zoom-in"
                aria-label={`Enlarge the ${noun.toLowerCase()}${many ? ` ${i + 1} of ${list.length}` : ""}`}
                title="Click to enlarge and zoom"
              >
                <img
                  src={srcOf(p)}
                  alt={noun}
                  loading="lazy"
                  className="block h-auto max-h-[640px] w-full object-contain object-top"
                  onError={() => setBroken((b) => ({ ...b, [i]: true }))}
                />
                {many ? (
                  <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-semibold leading-5 text-white">
                    {i + 1} / {list.length}
                  </span>
                ) : null}
                <ZoomBadge />
              </button>
            ),
          )}
        </div>
        {lightbox}
      </>
    );
  }

  if (broken[0]) return <BrokenPhoto className={cn(SIZES[size], className)} />;

  return (
    <>
      <button
        type="button"
        onClick={openAt(0)}
        className={cn(
          "group relative inline-block shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100 cursor-zoom-in",
          SIZES[size],
          className,
        )}
        aria-label={many ? `View the ${list.length} ${noun.toLowerCase()}s` : `View the ${noun.toLowerCase()}`}
        title={many ? `View the ${list.length} ${noun.toLowerCase()}s` : `View the ${noun.toLowerCase()}`}
      >
        <img src={srcOf(first)} alt={noun} className="h-full w-full object-cover" onError={() => setBroken({ 0: true })} />
        {many ? (
          <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold leading-4 text-white">
            {list.length}
          </span>
        ) : null}
        {size !== "sm" && <ZoomBadge />}
      </button>
      {lightbox}
    </>
  );
}
