import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { cn } from "@/lib/utils";
import {
  PAYMENT_PROOF_ACCEPT,
  PAYMENT_PROOF_HELPER,
  PAYMENT_PROOF_LABEL,
  paymentProofUploadMessage,
  preparePaymentProofFile,
  type CounterProof,
} from "@/lib/counterPayment";
import { paymentProofService, type PaymentProofRole } from "@/services/paymentProof.service";

interface PaymentProofFieldProps {
  /** Which upload route to use: Fleet Executive or Branch Manager. */
  role: PaymentProofRole;
  value: CounterProof | null;
  onChange: (proof: CounterProof | null) => void;
  /** Server error about this photo (e.g. DUPLICATE_PAYMENT_PROOF) — staff take a new one. */
  error?: string | null;
  required?: boolean;
  label?: string;
  helper?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const formatCapturedAt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

/**
 * Camera capture of the customer's UPI payment-success screen (#3). On a phone
 * the input opens the rear camera; on a desktop it opens the file picker. The
 * photo is uploaded straight away and its id is what the payment sends.
 */
export function PaymentProofField({
  role,
  value,
  onChange,
  error,
  required = true,
  label = PAYMENT_PROOF_LABEL,
  helper = PAYMENT_PROOF_HELPER,
  disabled = false,
  id,
  className,
}: PaymentProofFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  // The presigned URL lasts 15 minutes — fetch a fresh one once if it fails to load.
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const upload = useMutation({
    mutationFn: (file: File) => paymentProofService.upload(role, file),
    onSuccess: (view) => {
      setUploadError(null);
      onChange({ proofFileId: view.proofFileId, url: view.url, mime: view.mime, capturedAt: view.capturedAt });
    },
    onError: (err) => setUploadError(paymentProofUploadMessage(err)),
    onSettled: () => setLocalPreview(null),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange
    e.target.value = "";
    if (!picked) return;
    const prepared = await preparePaymentProofFile(picked);
    if ("error" in prepared) {
      setUploadError(prepared.error);
      return;
    }
    setUploadError(null);
    setLocalPreview(URL.createObjectURL(prepared.file));
    upload.mutate(prepared.file);
  };

  const handleImageError = () => {
    if (!value || refreshedFor.current === value.proofFileId) return;
    refreshedFor.current = value.proofFileId;
    paymentProofService
      .get(role, value.proofFileId)
      .then((view) => onChange({ ...value, url: view.url }))
      .catch(() => {
        // Gone or from another branch — staff retake it
        setUploadError("This photo can't be shown any more. Take it again.");
      });
  };

  const isUploading = upload.isPending;
  const thumbUrl = localPreview ?? value?.url ?? null;
  const shownError = uploadError ?? error ?? null;
  const inputId = id ? `${id}-input` : undefined;

  return (
    <div id={id} className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-800">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </span>
        {!required && <span className="text-[11px] text-neutral-400">Optional</span>}
      </div>

      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-2.5",
          shownError ? "border-red-300 bg-red-50/40" : value ? "border-neutral-200 bg-white" : "border-dashed border-neutral-300 bg-neutral-50",
        )}
      >
        {thumbUrl ? (
          <button
            type="button"
            className="group relative h-20 w-16 shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 cursor-zoom-in disabled:cursor-default"
            onClick={() => value && setViewerOpen(true)}
            disabled={!value || isUploading}
            aria-label={`View ${label}`}
          >
            <img src={thumbUrl} alt={label} className="h-full w-full object-cover" onError={handleImageError} />
            {isUploading ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              </span>
            ) : (
              value && <ZoomBadge />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white text-neutral-500 hover:border-orange-300 hover:text-orange-600 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || isUploading}
            aria-label="Take photo"
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px] font-medium">Photo</span>
          </button>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          {isUploading ? (
            <p className="text-xs text-neutral-500">Uploading the photo…</p>
          ) : value ? (
            <p className="text-xs text-emerald-700 font-medium">
              Photo added · {formatCapturedAt(value.capturedAt)}
            </p>
          ) : (
            <p className="text-xs text-neutral-500">{helper}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={value ? "outline" : "default"}
              className={cn("h-8", !value && "bg-orange-500 text-white hover:bg-orange-600")}
              disabled={disabled || isUploading}
              onClick={() => inputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : value ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Camera className="mr-1.5 h-3.5 w-3.5" />
              )}
              {value ? "Retake" : "Take photo"}
            </Button>
            {value && !isUploading && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={disabled}
                onClick={() => {
                  setUploadError(null);
                  onChange(null);
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {shownError && <p className="text-xs text-red-600">{shownError}</p>}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={PAYMENT_PROOF_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={handleFile}
        disabled={disabled}
      />

      {value && (
        <PhotoLightbox
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          title={label}
          items={[{ url: value.url, mime: value.mime, label }]}
        />
      )}
    </div>
  );
}
