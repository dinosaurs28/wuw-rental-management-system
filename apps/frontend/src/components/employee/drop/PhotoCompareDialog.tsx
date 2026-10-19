import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface ComparePhoto {
  url: string;
  /** Smaller copy shown in the pane; `url` when absent */
  displayUrl?: string | null;
  label?: string | null;
}

/**
 * Handover photo #n beside drop photo #n (stacked on a phone), one pair at a
 * time: previous / next (or the arrow keys) move both to the next number. Each
 * list comes in the order its photos were taken.
 */
export function PhotoCompareDialog({
  open,
  onOpenChange,
  before,
  after,
  beforeTitle,
  afterTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  before: ComparePhoto[];
  after: ComparePhoto[];
  beforeTitle: string;
  afterTitle: string;
}) {
  const total = Math.max(before.length, after.length);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const go = useCallback((delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), total - 1)), [total]);
  useEffect(() => {
    if (!open || total < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, total, go]);

  const n = Math.min(index, Math.max(total - 1, 0)) + 1;
  const pane = (photo: ComparePhoto | undefined, title: string) => (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium text-zinc-800 truncate">
        {title} #{n}
        {photo?.label ? <span className="font-normal text-zinc-500"> · {photo.label}</span> : null}
      </p>
      {photo ? (
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            key={photo.url}
            src={photo.displayUrl || photo.url}
            alt={`${title} photo ${n}`}
            className="w-full aspect-[4/3] object-contain rounded-md bg-zinc-100"
          />
        </a>
      ) : (
        <div className="w-full aspect-[4/3] rounded-md border border-dashed bg-zinc-50 flex flex-col items-center justify-center gap-1.5 text-zinc-400">
          <ImageOff className="h-6 w-6" />
          <span className="text-xs">No {title.toLowerCase()} photo #{n}</span>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open && total > 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-4 gap-3 bg-white">
        <DialogTitle className="text-sm font-semibold text-zinc-900 pr-6">
          Compare photos
          <span className="ml-2 text-xs font-medium text-zinc-500 tabular-nums">
            {n} / {total}
          </span>
        </DialogTitle>
        <DialogDescription className="sr-only">
          {beforeTitle} photo and {afterTitle.toLowerCase()} photo with the same number, side by side. Use the arrow keys or buttons to move between numbers.
        </DialogDescription>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pane(before[n - 1], beforeTitle)}
          {pane(after[n - 1], afterTitle)}
        </div>
        {total > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => go(-1)} disabled={n === 1} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => go(1)} disabled={n === total} className="gap-1">
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
