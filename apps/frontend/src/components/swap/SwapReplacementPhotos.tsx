import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, ImageIcon, Loader2, X } from "lucide-react";
import { cn, compressImage } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import {
  employeeVehicleSwapService,
  vehicleSwapService,
} from "@/services/vehicleSwap.service";
import type { SwapPhotoRequirement } from "@/types/vehicleSwap";
import { insertInCaptureOrder, nextCaptureAt } from "@/lib/photoOrder";

/** A photo of the replacement uploaded for the swap (label = capture-config shot). */
export interface SwapUploadedPhoto {
  fileId: string;
  url: string;
  label?: string;
  /** When it was picked (ms): the list (and the swap's photos) stay in the order taken */
  capturedAt?: number;
}

/** Required shots still missing and whether the minimum count is met. */
export function swapPhotosShortfall(
  photos: SwapUploadedPhoto[],
  requirement: SwapPhotoRequirement,
): { missingLabels: string[]; short: number } {
  const taken = new Set(photos.map((p) => p.label?.toLowerCase()).filter(Boolean));
  const missingLabels = requirement.fields
    .filter((f) => f.required && !taken.has(f.name.toLowerCase()))
    .map((f) => f.name);
  return { missingLabels, short: Math.max(0, requirement.minPhotos - photos.length) };
}

interface SwapReplacementPhotosProps {
  regNo: string;
  requirement: SwapPhotoRequirement;
  /** Which API uploads the photos (Fleet = employee, BM = manager) */
  role: "employee" | "manager";
  value: SwapUploadedPhoto[];
  onChange: (photos: SwapUploadedPhoto[]) => void;
  /** Photos still uploading — the swap waits for them */
  onUploadingChange?: (count: number) => void;
  disabled?: boolean;
  /** The swap is being sent: if this unmounts meanwhile (swap done), the photos are kept */
  submitting?: boolean;
  /** Highlight the shots still missing (after a submit attempt) */
  showMissing?: boolean;
}

/**
 * "Photos of <reg no>" for a mid-rental swap (client item 2): the branch's
 * pickup capture-config shots for the replacement's category (required ones
 * marked), plus extra photos; without a config, at least minPhotos photos.
 * Same upload as the pickup photos (pickup/ keys).
 */
export function SwapReplacementPhotos({
  regNo,
  requirement,
  role,
  value,
  onChange,
  onUploadingChange,
  disabled = false,
  submitting = false,
  showMissing = false,
}: SwapReplacementPhotosProps) {
  const service = role === "manager" ? vehicleSwapService : employeeVehicleSwapService;
  const [uploadingSlots, setUploadingSlots] = useState<string[]>([]);
  const [genericUploads, setGenericUploads] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Uploads overlap: build the next list from the latest value, not the closure's
  const valueRef = useRef(value);
  valueRef.current = value;
  const uploadingRef = useRef(0);

  // Closed or Back without swapping: delete the uploads nothing will use
  // (best-effort; the delete keeps any photo already saved with a booking).
  // Unmounted while the swap was being sent = the swap went through.
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const deleteRef = useRef(service.deleteSwapPhoto);
  deleteRef.current = service.deleteSwapPhoto;
  useEffect(
    () => () => {
      if (submittingRef.current) return;
      valueRef.current.forEach((p) => void deleteRef.current(p.fileId).catch(() => {}));
    },
    [],
  );

  const setUploading = (delta: number) => {
    uploadingRef.current += delta;
    onUploadingChange?.(uploadingRef.current);
  };

  const commit = (next: SwapUploadedPhoto[]) => {
    valueRef.current = next;
    onChange(next);
  };

  const uploadOne = async (file: File, label?: string) => {
    const capturedAt = nextCaptureAt();
    setUploading(1);
    if (label) setUploadingSlots((s) => [...s, label]);
    else setGenericUploads((n) => n + 1);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const { fileId, url } = await service.uploadSwapPhoto(formData);
      const current = valueRef.current;
      // Where it was taken in the sequence, not where its upload finished
      commit(
        label
          ? insertInCaptureOrder(current.filter((p) => p.label !== label), { fileId, url, label, capturedAt })
          : insertInCaptureOrder(current, { fileId, url, capturedAt }),
      );
      setUploadError(null);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Photo upload failed — try again.";
      setUploadError(message);
      toast.error(label ? `${label}: ${message}` : message);
    } finally {
      setUploading(-1);
      if (label) setUploadingSlots((s) => s.filter((l) => l !== label));
      else setGenericUploads((n) => n - 1);
    }
  };

  const remove = (fileId: string) => {
    commit(valueRef.current.filter((p) => p.fileId !== fileId));
    // Not saved with anything yet; a failed delete only leaves an unused upload
    void service.deleteSwapPhoto(fileId).catch(() => {});
  };

  const { missingLabels, short } = swapPhotosShortfall(value, requirement);
  const extraPhotos = value.filter((p) => !p.label || !requirement.fields.some((f) => f.name === p.label));
  // Lightbox order: config shots first, then the extra photos
  const viewerItems = [
    ...requirement.fields.flatMap((f) => {
      const shot = value.find((p) => p.label === f.name);
      return shot ? [{ url: shot.url, label: f.name, fileId: shot.fileId }] : [];
    }),
    ...extraPhotos.map((p, i) => ({ url: p.url, label: p.label ?? `Photo ${i + 1}`, fileId: p.fileId })),
  ];
  const openViewer = (fileId: string) =>
    setViewerIndex(Math.max(0, viewerItems.findIndex((item) => item.fileId === fileId)));

  const hasConfig = requirement.fields.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Camera className="w-4 h-4 text-gray-500 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-800">
            Photos of <span className="font-mono">{regNo}</span>{" "}
            <span className="text-red-500">*</span>
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {hasConfig
              ? "Take every required shot of the replacement before handing it over — the drop is checked against these."
              : `Take at least ${requirement.minPhotos} photos of the replacement before handing it over — the drop is checked against these.`}
          </p>
        </div>
      </div>

      {hasConfig && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {requirement.fields.map((field) => {
            const shot = value.find((p) => p.label === field.name) ?? null;
            const uploading = uploadingSlots.includes(field.name);
            const flagged = showMissing && field.required && !shot && !uploading;
            return (
              <div
                key={field.name}
                className={cn(
                  "border rounded-lg overflow-hidden bg-gray-50",
                  flagged && "border-red-300 ring-1 ring-red-200",
                )}
              >
                {shot ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => openViewer(shot.fileId)}
                      aria-label={`Zoom ${field.name} photo`}
                      className="relative block w-full cursor-zoom-in"
                    >
                      <img src={shot.url} alt={field.name} className="w-full h-24 object-cover" />
                      <span className="absolute top-1 left-1 min-w-5 h-5 px-1 rounded-full bg-black/65 text-white text-[11px] font-semibold flex items-center justify-center">
                        {value.findIndex((p) => p.fileId === shot.fileId) + 1}
                      </span>
                      <ZoomBadge />
                    </button>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => remove(shot.fileId)}
                        aria-label={`Remove ${field.name} photo`}
                        className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <label
                    className={cn(
                      "flex flex-col items-center justify-center h-24 cursor-pointer gap-1 text-muted-foreground hover:bg-gray-100 transition-colors",
                      (disabled || uploading) && "cursor-default opacity-60",
                    )}
                  >
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-5 w-5 opacity-50" />
                    )}
                    <span className="text-xs">{uploading ? "Uploading…" : "Tap to upload"}</span>
                    {!disabled && !uploading && (
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadOne(f, field.name);
                          e.target.value = "";
                        }}
                      />
                    )}
                  </label>
                )}
                <div className="px-2 py-1.5 bg-white border-t flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{field.name}</span>
                  {field.required && <span className="text-orange-500 text-xs shrink-0">*</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Extra photos (all photos when the branch has no capture config) */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {extraPhotos.map((p) => (
          <div key={p.fileId} className="relative rounded-lg overflow-hidden border bg-gray-50">
            <button
              type="button"
              onClick={() => openViewer(p.fileId)}
              aria-label="Zoom photo"
              className="relative block w-full cursor-zoom-in"
            >
              <img src={p.url} alt="Replacement vehicle" className="w-full h-20 object-cover" />
              <span className="absolute top-1 left-1 min-w-5 h-5 px-1 rounded-full bg-black/65 text-white text-[11px] font-semibold flex items-center justify-center">
                {value.findIndex((x) => x.fileId === p.fileId) + 1}
              </span>
              <ZoomBadge />
            </button>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(p.fileId)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: genericUploads }).map((_, i) => (
          <div key={`uploading-${i}`} className="flex items-center justify-center h-20 rounded-lg border bg-gray-50">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ))}
        {!disabled && (
          <label className="flex flex-col items-center justify-center h-20 rounded-lg border-2 border-dashed border-gray-200 cursor-pointer gap-1 text-muted-foreground hover:bg-gray-50 transition-colors">
            <Camera className="h-4 w-4 opacity-60" />
            <span className="text-[11px]">{hasConfig ? "More photos" : "Add photo"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                Array.from(e.target.files ?? []).forEach((f) => void uploadOne(f));
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {uploadError ? (
        <p className="text-xs text-red-600">{uploadError}</p>
      ) : uploadingRef.current > 0 ? (
        <p className="text-xs text-gray-500">Uploading photos…</p>
      ) : missingLabels.length > 0 ? (
        <p className={cn("text-xs", showMissing ? "text-red-600" : "text-gray-500")}>
          Still needed: {missingLabels.join(", ")}
        </p>
      ) : short > 0 ? (
        <p className={cn("text-xs", showMissing ? "text-red-600" : "text-gray-500")}>
          {value.length} of {requirement.minPhotos} photos taken
        </p>
      ) : null}

      <PhotoLightbox
        open={viewerIndex !== null}
        onOpenChange={(o) => !o && setViewerIndex(null)}
        items={viewerItems}
        startIndex={viewerIndex ?? 0}
        title={`Photos of ${regNo}`}
      />
    </div>
  );
}
