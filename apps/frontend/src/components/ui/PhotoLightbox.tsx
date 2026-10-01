import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZoomableImage } from "@/components/ui/ZoomableImage";

export interface LightboxItem {
  url: string;
  /** Caption shown under the photo, e.g. vehicle reg no / photo type. */
  label?: string | null;
  mime?: string | null;
}

interface PhotoLightboxProps {
  items: LightboxItem[];
  /** Index of the photo to show when the lightbox opens. */
  startIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

const isImageItem = (item: LightboxItem) => {
  if (item.mime) return item.mime.startsWith("image/");
  return !/\.(pdf|docx?|xlsx?|mp4|mov)(\?|$)/i.test(item.url);
};

/**
 * Multi-photo viewer: Radix Dialog + ZoomableImage with prev/next buttons,
 * ArrowLeft/ArrowRight keys, an "n / N" counter and a caption.
 * ZoomableImage provides zoom 1-5x, drag-pan and reset.
 */
export function PhotoLightbox({
  items,
  startIndex = 0,
  open,
  onOpenChange,
  title = "Photos",
}: PhotoLightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const count = items.length;

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));
  }, [open, startIndex, count]);

  const prev = useCallback(
    () => setIndex((i) => (count ? (i - 1 + count) % count : 0)),
    [count],
  );
  const next = useCallback(
    () => setIndex((i) => (count ? (i + 1) % count : 0)),
    [count],
  );

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, prev, next]);

  const item = items[Math.min(index, count - 1)];

  return (
    <Dialog open={open && count > 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] p-4 gap-3 bg-white">
        <DialogTitle className="text-sm font-semibold text-zinc-900 pr-6">
          {title}
          {count > 0 && (
            <span className="ml-2 text-xs font-medium text-zinc-500 tabular-nums">
              {Math.min(index, count - 1) + 1} / {count}
            </span>
          )}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Use the arrow keys or buttons to move between photos. Zoom with scroll, pinch or the zoom buttons, and drag to pan.
        </DialogDescription>
        {item && (
          <div className="relative">
            {isImageItem(item) ? (
              <ZoomableImage
                key={`${index}-${item.url}`}
                src={item.url}
                alt={item.label || `Photo ${index + 1}`}
                maxHeight="70vh"
                canvasClassName="min-h-[40vh]"
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-lg bg-zinc-100">
                <FileText className="w-14 h-14 text-zinc-400" />
                <p className="text-sm text-zinc-500">Preview not available</p>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" />
                    Open in new tab
                  </a>
                </Button>
              </div>
            )}
            {count > 1 && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={prev}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full shadow-md bg-white/90 hover:bg-white"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={next}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full shadow-md bg-white/90 hover:bg-white"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </>
            )}
          </div>
        )}
        {item?.label && (
          <p className="text-center text-sm font-medium text-zinc-700 truncate">{item.label}</p>
        )}
        {count > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((it, i) => (
              <button
                key={`${i}-${it.url}`}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                className={`shrink-0 h-12 w-16 rounded-md overflow-hidden border-2 bg-zinc-100 flex items-center justify-center ${
                  i === index ? "border-[#ff6a1f]" : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                {isImageItem(it) ? (
                  <img src={it.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <FileText className="w-5 h-5 text-zinc-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Hover overlay that makes a thumbnail's zoom affordance visible. Put inside a `relative group` wrapper. */
export function ZoomBadge() {
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
      <ZoomIn className="h-3.5 w-3.5" />
    </span>
  );
}
