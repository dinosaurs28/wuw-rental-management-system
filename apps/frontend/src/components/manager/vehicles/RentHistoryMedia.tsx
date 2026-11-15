/**
 * A rental's pickup / drop photos and damage in a vehicle's rent history
 * (Nov 14 2026, client: "show the Pickup images and Drop images, and any Damage,
 * in the same history"). Thumbnails of the first few, "View all" = every photo
 * in one column in the order taken; a photo opens the zoomable viewer.
 */
import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ImageOff, Images } from "lucide-react";
import { PhotoLightbox, type LightboxItem } from "@/components/ui/PhotoLightbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhotoNumber, photoCaption } from "@/components/employee/drop/HandoverConditionPhotos";
import { usePhotoFallback } from "@/components/employee/drop/usePhotoFallback";
import { cn } from "@/lib/utils";

export interface RentHistoryPhoto {
  publicId: string;
  label: string | null;
  url: string;
  displayUrl: string;
  takenAt: string;
  mime: string;
}

export type DamagePaymentStatus =
  | "COMPANY_EXPENSE"
  | "PAID"
  | "ON_DROP_BILL"
  | "AWAITING_REVIEW"
  | "CHARGED"
  | "NOT_CHARGED";

export interface RentHistoryDamage {
  publicId: string;
  source: "DROP" | "REPORT";
  severity: string;
  amount: number;
  estimatedCost: number;
  chargeType: "PENALTY" | "COMPENSATION";
  status: "PENDING" | "APPROVED" | "REJECTED";
  disposition: string | null;
  billing: "DROP" | "MANAGER" | "COMPANY" | null;
  paymentStatus: DamagePaymentStatus;
  notes: {
    area: string | null;
    description: string | null;
    items: Array<{ area: string | null; severity: string | null; description: string | null }>;
  };
  reportedAt: string;
  photos: RentHistoryPhoto[];
}

/** Thumbnails shown in the history row; the rest are behind "View all". */
export const THUMB_COUNT = 4;

export const DAMAGE_PAYMENT_LABEL: Record<DamagePaymentStatus, { label: string; className: string }> = {
  COMPANY_EXPENSE: { label: "Company expense", className: "border-zinc-200 bg-zinc-50 text-zinc-700" },
  PAID: { label: "Paid on drop bill", className: "border-green-200 bg-green-50 text-green-700" },
  ON_DROP_BILL: { label: "On drop bill — not settled", className: "border-amber-200 bg-amber-50 text-amber-800" },
  AWAITING_REVIEW: { label: "Awaiting manager review", className: "border-amber-200 bg-amber-50 text-amber-800" },
  CHARGED: { label: "Charged by manager", className: "border-green-200 bg-green-50 text-green-700" },
  NOT_CHARGED: { label: "Not charged", className: "border-zinc-200 bg-zinc-50 text-zinc-700" },
};

const fmt = (iso: string) => format(new Date(iso), "d MMM, h:mm a");
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function lightboxItems(photos: RentHistoryPhoto[], prefix: string): LightboxItem[] {
  return photos.map((p, i) => ({
    url: p.url,
    previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : null,
    mime: p.mime,
    label: `${prefix} · ${photoCaption(i, p.label)}`,
  }));
}

function Img({ photo, className }: { photo: RentHistoryPhoto; className?: string }) {
  const { src, attempt, status, onLoad, onError } = usePhotoFallback(photo.url, photo.displayUrl);
  return (
    <div className={cn("relative overflow-hidden bg-gray-100", className)}>
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-gray-200" />}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          <ImageOff className="h-4 w-4" />
        </div>
      ) : (
        <img
          key={attempt}
          src={src}
          alt={photo.label ?? "Vehicle photo"}
          className={cn("absolute inset-0 h-full w-full object-cover", status === "loaded" ? "opacity-100" : "opacity-0")}
          loading="lazy"
          decoding="async"
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}

/** Every photo of a set, one per row in the order taken. */
function AllPhotosDialog({
  open,
  onOpenChange,
  title,
  photos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  photos: RentHistoryPhoto[];
}) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle>
            {title} ({photos.length})
          </DialogTitle>
          <DialogDescription>In the order they were taken. Click a photo to zoom.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-4 py-4 space-y-4">
          {photos.map((p, i) => (
            <div key={p.publicId} className="rounded-lg overflow-hidden border bg-white">
              <button type="button" className="relative block w-full" onClick={() => setIndex(i)}>
                <Img photo={p} className="aspect-[4/3] w-full" />
                <PhotoNumber n={i + 1} className="top-2 left-2 min-w-6 h-6 text-xs" />
              </button>
              <div className="flex items-baseline gap-2 px-3 py-2 border-t">
                <p className="flex-1 text-sm font-medium truncate">{photoCaption(i, p.label)}</p>
                <p className="text-xs text-gray-500 shrink-0">{fmt(p.takenAt)}</p>
              </div>
            </div>
          ))}
        </div>
        <PhotoLightbox
          open={index != null}
          onOpenChange={(o) => !o && setIndex(null)}
          items={lightboxItems(photos, title)}
          startIndex={index ?? 0}
          title={title}
        />
      </DialogContent>
    </Dialog>
  );
}

/** A labelled thumbnail strip: the first few photos and "View all (N)". */
export function PhotoStrip({
  title,
  photos,
  emptyText = "No photos recorded",
}: {
  title: string;
  photos: RentHistoryPhoto[];
  emptyText?: string;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const thumbs = photos.slice(0, THUMB_COUNT);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-700">
        {title}
        {photos.length > 0 ? ` (${photos.length})` : ""}
      </p>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {thumbs.map((p, i) => (
            <button
              key={p.publicId}
              type="button"
              className="relative rounded-md overflow-hidden border"
              onClick={() => setIndex(i)}
              aria-label={`${title}: ${photoCaption(i, p.label)}`}
              title={photoCaption(i, p.label)}
            >
              <Img photo={p} className="h-14 w-[4.5rem]" />
              <PhotoNumber n={i + 1} className="min-w-4 h-4 text-[10px]" />
            </button>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setAllOpen(true)}>
            <Images className="h-3.5 w-3.5" />
            View all{photos.length > THUMB_COUNT ? ` (${photos.length})` : ""}
          </Button>
        </div>
      )}
      <PhotoLightbox
        open={index != null}
        onOpenChange={(o) => !o && setIndex(null)}
        items={lightboxItems(photos, title)}
        startIndex={index ?? 0}
        title={title}
      />
      <AllPhotosDialog open={allOpen} onOpenChange={setAllOpen} title={title} photos={photos} />
    </div>
  );
}

/** This car's damage on a rental (only rendered when there is some). */
export function DamageSection({ damages }: { damages: RentHistoryDamage[] }) {
  if (damages.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-2.5 space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        Damage ({damages.length})
      </p>
      {damages.map((d) => {
        const pay = DAMAGE_PAYMENT_LABEL[d.paymentStatus];
        const lines = d.notes.items.length
          ? d.notes.items
          : [{ area: d.notes.area, severity: d.severity, description: d.notes.description }];
        return (
          <div key={d.publicId} className="space-y-1.5 border-t border-red-100 pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-gray-900">{inr(d.amount)}</span>
              <Badge variant="outline" className={cn("text-[11px]", pay.className)}>
                {pay.label}
              </Badge>
              <span className="text-gray-500">
                {d.source === "DROP" ? "Recorded at drop" : "Damage report"} · {fmt(d.reportedAt)}
              </span>
              {d.status !== "PENDING" && (
                <span className="text-gray-500">
                  · Review {d.status === "APPROVED" ? "closed" : "rejected"}
                  {d.disposition ? ` (${d.disposition.toLowerCase()})` : ""}
                </span>
              )}
            </div>
            {lines.map((l, i) =>
              l.area || l.description || l.severity ? (
                <p key={i} className="text-xs text-gray-700">
                  {[l.area, l.severity].filter(Boolean).join(" · ")}
                  {l.description ? `${l.area || l.severity ? " — " : ""}${l.description}` : ""}
                </p>
              ) : null,
            )}
            <PhotoStrip title="Damage photos" photos={d.photos} />
          </div>
        );
      })}
    </div>
  );
}
