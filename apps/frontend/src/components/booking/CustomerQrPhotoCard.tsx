import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageOff, Loader2, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { cn } from "@/lib/utils";
import {
  QR_PHOTO_ACCEPT,
  QR_PHOTO_HELPER,
  QR_PHOTO_LABEL,
  prepareQrPhotoFile,
  qrPhotoErrorCode,
  qrPhotoErrorMessage,
} from "@/lib/qrPhoto";
import {
  qrPhotoKeys,
  useBookingQrPhoto,
  useCustomerQrPhoto,
  type QrPhotoRole,
} from "@/hooks/useQrPhoto";
import { kycService } from "@/services/kyc.service";
import { managerDashboardService } from "@/services/managerDashboard.service";
import type {
  BookingQrPhotoData,
  CustomerQrPhotoData,
  QrPhotoCustomer,
  QrPhotoSource,
  QrPhotoView,
} from "@/types/qrPhoto";

/**
 * Customer level (walk-in flow): the customer's current photo; Fleet can
 * capture, replace and remove it. Booking level (pickup, BM): the booking's
 * snapshot or else the customer's current photo; replaceable only while the
 * booking is HOLD/CONFIRMED.
 */
export type QrPhotoTarget =
  | { kind: "customer"; customerPublicId: string }
  | { kind: "booking"; bookingId: string; role: QrPhotoRole };

interface CustomerQrPhotoCardProps {
  target: QrPhotoTarget;
  /** Walk-in flow: the photo must exist before the booking is created. */
  required?: boolean;
  /** Customer target only: show "Remove". */
  allowDelete?: boolean;
  /** Hide capture/replace even when the server would allow it. */
  readOnly?: boolean;
  id?: string;
  className?: string;
}

const formatCapturedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

const SOURCE_NOTE: Record<Exclude<QrPhotoSource, null>, string> = {
  BOOKING: "Captured for this booking",
  CUSTOMER: "Customer's current QR photo (not captured for this booking)",
};

export function CustomerQrPhotoCard({
  target,
  required = false,
  allowDelete = false,
  readOnly = false,
  id,
  className,
}: CustomerQrPhotoCardProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const customerQuery = useCustomerQrPhoto(
    target.kind === "customer" ? target.customerPublicId : null,
  );
  const bookingQuery = useBookingQrPhoto(
    target.kind === "booking" ? target.role : "staff",
    target.kind === "booking" ? target.bookingId : null,
  );
  const query = target.kind === "customer" ? customerQuery : bookingQuery;

  const bookingData = target.kind === "booking" ? bookingQuery.data : undefined;
  const photo: QrPhotoView | null = query.data?.qrPhoto ?? null;
  const customer: QrPhotoCustomer | null = query.data?.customer ?? null;
  const source: QrPhotoSource = bookingData?.source ?? (photo ? "CUSTOMER" : null);
  const canCapture =
    !readOnly && (target.kind === "customer" || bookingData?.canReplace === true);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (target.kind === "customer") {
        return kycService.uploadCustomerQrPhoto(target.customerPublicId, file);
      }
      return target.role === "manager"
        ? managerDashboardService.uploadBookingQrPhoto(target.bookingId, file)
        : kycService.uploadBookingQrPhoto(target.bookingId, file);
    },
    onSuccess: (res) => {
      setUploadError(null);
      if (target.kind === "customer") {
        queryClient.setQueryData<CustomerQrPhotoData>(
          qrPhotoKeys.customer(target.customerPublicId),
          res.data as CustomerQrPhotoData,
        );
        // Booking views without a snapshot show the customer's current photo.
        queryClient.invalidateQueries({ queryKey: qrPhotoKeys.allBookings });
      } else {
        queryClient.setQueryData<BookingQrPhotoData>(
          qrPhotoKeys.booking(target.role, target.bookingId),
          res.data as BookingQrPhotoData,
        );
        // The booking upload also became the customer's current photo.
        queryClient.invalidateQueries({ queryKey: qrPhotoKeys.customer(res.data.customer.publicId) });
      }
      toast.success(res.message || "QR code photo saved");
    },
    onError: (err) => {
      const message = qrPhotoErrorMessage(err, "Couldn't save the QR code photo. Please try again.");
      setUploadError(message);
      toast.error(message);
      // Booking moved past CONFIRMED meanwhile: refresh so Retake disappears.
      if (qrPhotoErrorCode(err) === "QR_PHOTO_FROZEN") void query.refetch();
    },
    onSettled: () => setLocalPreview(null),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (target.kind !== "customer") throw new Error("Only a customer's photo can be removed");
      return kycService.deleteCustomerQrPhoto(target.customerPublicId);
    },
    onSuccess: (res) => {
      if (target.kind === "customer") {
        queryClient.setQueryData<CustomerQrPhotoData>(
          qrPhotoKeys.customer(target.customerPublicId),
          res.data,
        );
        queryClient.invalidateQueries({ queryKey: qrPhotoKeys.allBookings });
      }
      setUploadError(null);
      toast.success(res.message || "QR code photo removed");
    },
    onError: (err) => {
      toast.error(qrPhotoErrorMessage(err, "Couldn't remove the QR code photo. Please try again."));
      if (qrPhotoErrorCode(err) === "QR_PHOTO_NOT_FOUND") void query.refetch();
    },
    onSettled: () => setConfirmRemove(false),
  });

  const isUploading = uploadMutation.isPending;
  const isBusy = isUploading || deleteMutation.isPending;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!picked) return;

    const prepared = await prepareQrPhotoFile(picked);
    if ("error" in prepared) {
      setUploadError(prepared.error);
      toast.error(prepared.error);
      return;
    }
    setUploadError(null);
    setLocalPreview(URL.createObjectURL(prepared.file));
    uploadMutation.mutate(prepared.file);
  };

  const missing = !photo && !query.isLoading && !query.isError;
  const thumbUrl = localPreview ?? photo?.url ?? null;

  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border bg-white p-4",
        required && missing ? "border-amber-300 bg-amber-50/40" : "border-zinc-200",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-50">
          <QrCode className="h-4 w-4 text-[#FF5F00]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-900">{QR_PHOTO_LABEL}</p>
            {photo ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Captured
              </span>
            ) : required && missing ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Required
              </span>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">{QR_PHOTO_HELPER}</p>
        </div>
      </div>

      <div className="mt-3">
        {query.isLoading ? (
          <div className="flex gap-4">
            <Skeleton className="h-28 w-28 rounded-md" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-32" />
            </div>
          </div>
        ) : query.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-xs text-red-700">
              {qrPhotoErrorMessage(query.error, "Couldn't load the QR code photo.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            {thumbUrl ? (
              <button
                type="button"
                className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 cursor-zoom-in disabled:cursor-default"
                onClick={() => photo && setViewerOpen(true)}
                disabled={!photo || isUploading}
                aria-label={`View ${QR_PHOTO_LABEL}`}
              >
                <img src={thumbUrl} alt={QR_PHOTO_LABEL} className="h-full w-full object-cover" />
                {isUploading ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                ) : (
                  photo && <ZoomBadge />
                )}
              </button>
            ) : (
              <div className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-400">
                <ImageOff className="h-5 w-5" />
                <span className="text-[10px] font-medium">No photo</span>
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1.5">
              {customer && (
                <p className="truncate text-xs font-medium text-zinc-700">
                  {customer.name} · {customer.phone}
                </p>
              )}
              {isUploading ? (
                <p className="text-xs text-zinc-500">Uploading…</p>
              ) : photo ? (
                <>
                  <p className="text-xs text-zinc-500">Captured {formatCapturedAt(photo.capturedAt)}</p>
                  {target.kind === "booking" && source && (
                    <p
                      className={cn(
                        "text-xs",
                        source === "CUSTOMER" ? "text-amber-700" : "text-zinc-500",
                      )}
                    >
                      {SOURCE_NOTE[source]}
                    </p>
                  )}
                </>
              ) : (
                <p className={cn("text-xs", required ? "text-amber-700" : "text-zinc-500")}>
                  {required
                    ? "Photograph the QR the customer shows before creating the booking."
                    : target.kind === "booking"
                      ? "No QR code photo for this booking."
                      : "No QR code photo on file."}
                </p>
              )}

              {target.kind === "booking" && bookingData && !bookingData.canReplace && !readOnly && (
                <p className="text-[11px] text-zinc-400">
                  It can only be changed while the booking is on hold or confirmed.
                </p>
              )}

              {(canCapture || (allowDelete && target.kind === "customer" && photo)) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {canCapture && (
                    <Button
                      type="button"
                      size="sm"
                      variant={photo ? "outline" : "default"}
                      className={cn("h-8", !photo && "bg-[#FF5F00] text-white hover:bg-[#e55500]")}
                      disabled={isBusy}
                      onClick={() => inputRef.current?.click()}
                    >
                      {isUploading ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : photo ? (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      ) : (
                        <Camera className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {photo ? "Retake" : "Capture photo"}
                    </Button>
                  )}
                  {allowDelete && target.kind === "customer" && photo && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={isBusy}
                      onClick={() => setConfirmRemove(true)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  )}
                </div>
              )}

              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            </div>
          </div>
        )}
      </div>

      {canCapture && (
        <input
          ref={inputRef}
          type="file"
          accept={QR_PHOTO_ACCEPT}
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
      )}

      {photo && (
        <PhotoLightbox
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={QR_PHOTO_LABEL}
          items={[
            {
              url: photo.url,
              mime: photo.mime,
              label: customer ? `${customer.name} · ${customer.phone}` : QR_PHOTO_LABEL,
            },
          ]}
        />
      )}

      {allowDelete && target.kind === "customer" && (
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove QR code photo?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears {customer?.name ?? "the customer"}'s current QR code photo. Bookings
                that already have it keep their copy. A new photo is needed before the next
                walk-in booking.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  deleteMutation.mutate();
                }}
              >
                {deleteMutation.isPending ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
