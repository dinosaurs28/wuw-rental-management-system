import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import { AlertCircle, Camera, CheckCircle2, Eye, RefreshCw } from "lucide-react";
import { kycPhotosState, type KycPhotoSide, type KycPhotoType } from "@repo/schemas";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { compressImage, cn } from "@/lib/utils";
import { useKycStore } from "@/store/kyc.store";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { kycService, type KycDocument } from "@/services/kyc.service";
import { DlPhotosAlertDialog, dlPairCompletedByUpload } from "./DlPhotosAlertDialog";

type DlPhotoSide = KycPhotoSide;

const SIDE_LABEL: Record<DlPhotoSide, string> = { FRONT: "Front", BACK: "Back" };

/** Per-document copy: the DL card (Oct 17 2026) and the Aadhaar card (Oct 25 2026). */
const COPY: Record<
  KycPhotoType,
  { title: string; intro: string; short: string; hint: Record<DlPhotoSide, string>; loadError: string }
> = {
  DL: {
    title: "Driving licence photos",
    intro: "Upload clear photos of both sides of your driving licence to book.",
    short: "licence",
    hint: { FRONT: "Photo and licence number", BACK: "Address / vehicle classes" },
    loadError: "Couldn't load your licence photos",
  },
  AADHAAR: {
    title: "Aadhaar photos",
    intro: "Upload clear photos of both sides of your Aadhaar card to book.",
    short: "Aadhaar",
    hint: { FRONT: "Photo and Aadhaar number", BACK: "Address side" },
    loadError: "Couldn't load your Aadhaar photos",
  },
};

interface KycPhotosCheckoutCardProps {
  type: KycPhotoType;
  className?: string;
  /** Load the KYC documents on mount (one card per page does; default true). */
  fetchOnMount?: boolean;
}

/**
 * Checkout step: both sides of the driving licence (Oct 17 2026) and of the
 * Aadhaar card (Oct 25 2026) are required to book — one card per document.
 * Uploads either side inline (a side staff rejected is replaced). The DL card
 * attaches the DL front as the booking's KYC document. The pay button reads
 * the same rule from the KYC store (requiredKycPhotosState).
 */
export const KycPhotosCheckoutCard = ({ type, className, fetchOnMount = true }: KycPhotosCheckoutCardProps) => {
  const { uploadedDocuments, setUploadedDocuments, addDocument, isFetching, setIsFetching } = useKycStore();
  const { selectedKycFilePublicId, setSelectedKyc } = useVehicleRentalStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadingSide, setUploadingSide] = useState<DlPhotoSide | null>(null);
  const [dlAlertOpen, setDlAlertOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const inputs = { FRONT: useRef<HTMLInputElement>(null), BACK: useRef<HTMLInputElement>(null) };
  const copy = COPY[type];
  const isDl = type === "DL";

  const dl = kycPhotosState(type, uploadedDocuments);

  const fetchDocuments = useCallback(async () => {
    setIsFetching(true);
    setLoadError(null);
    try {
      const response = await kycService.getDocuments();
      setUploadedDocuments(response.data);
    } catch (err: any) {
      setLoadError(err?.response?.data?.message || copy.loadError);
    } finally {
      setIsFetching(false);
    }
  }, [setUploadedDocuments, setIsFetching, copy.loadError]);

  useEffect(() => {
    if (fetchOnMount) fetchDocuments();
  }, [fetchDocuments, fetchOnMount]);

  // The DL front is the booking's KYC document — attached automatically.
  const frontFilePublicId = dl.ok ? dl.front?.file?.publicId ?? null : null;
  useEffect(() => {
    if (!isDl) return;
    if (selectedKycFilePublicId !== frontFilePublicId) setSelectedKyc(frontFilePublicId);
  }, [isDl, frontFilePublicId, selectedKycFilePublicId, setSelectedKyc]);

  const handleFile = async (side: DlPhotoSide, file: File | undefined) => {
    if (!file) return;
    setUploadingSide(side);
    try {
      const processed = await compressImage(file);
      const before = useKycStore.getState().uploadedDocuments;
      const response = await kycService.uploadDocument(processed, type, side);
      const completesPair = dlPairCompletedByUpload(before, type, side);
      // A replaced (rejected) side keeps its publicId — addDocument swaps it in
      addDocument(response.data);
      toast.success(`${isDl ? "Licence" : "Aadhaar"} ${SIDE_LABEL[side].toLowerCase()} uploaded`);
      if (completesPair) setDlAlertOpen(true);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.status === 409
          ? "This side is already uploaded. Refresh the page to see it."
          : error.response?.data?.message || "Upload failed"
        : "Upload failed";
      toast.error(message);
    } finally {
      setUploadingSide(null);
      const input = inputs[side].current;
      if (input) input.value = "";
    }
  };

  const header = (
    <CardHeader className="pb-3">
      <CardTitle className="text-lg font-semibold flex items-center gap-2">
        {copy.title}
        <span className="text-xs font-semibold rounded-full bg-orange-100 text-orange-700 px-2 py-0.5">
          Required
        </span>
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        {copy.intro}
      </p>
    </CardHeader>
  );

  if (isFetching && uploadedDocuments.length === 0) {
    return (
      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        {header}
        <CardContent className="grid grid-cols-2 gap-3">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        {header}
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={fetchDocuments}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tile = (side: DlPhotoSide) => {
    const doc: KycDocument | null = side === "FRONT" ? dl.front : dl.back;
    const rejected = dl.rejectedSides.includes(side);
    const uploading = uploadingSide === side;
    return (
      <div
        key={side}
        className={cn(
          "rounded-lg border-2 p-3 flex flex-col gap-2",
          doc ? "border-emerald-200 bg-emerald-50/40" : rejected ? "border-red-200 bg-red-50/50" : "border-dashed border-zinc-300",
        )}
      >
        <input
          ref={inputs[side]}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(side, e.target.files?.[0])}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-900">{SIDE_LABEL[side]}</span>
          {doc && (
            <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="size-3.5" />
              {doc.status === "APPROVED" ? "Verified" : "Uploaded"}
            </span>
          )}
        </div>
        {doc?.file?.url ? (
          <button
            type="button"
            onClick={() => setPreview({ url: doc.file.url, title: `${copy.title.replace(/ photos$/, "")} — ${SIDE_LABEL[side]}` })}
            className="relative h-24 w-full overflow-hidden rounded-md border border-zinc-200 group"
            aria-label={`View ${copy.short} ${SIDE_LABEL[side].toLowerCase()}`}
          >
            <img src={doc.file.url} alt={`${copy.short} ${SIDE_LABEL[side].toLowerCase()}`} className="h-full w-full object-cover" />
            <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Eye className="size-4 text-white" />
            </span>
          </button>
        ) : (
          <div className="h-24 w-full rounded-md bg-zinc-50 flex flex-col items-center justify-center text-center px-2">
            {rejected ? (
              <p className="text-xs text-red-700">Rejected by our team — upload a clearer photo</p>
            ) : (
              <p className="text-xs text-zinc-500">{copy.hint[side]}</p>
            )}
          </div>
        )}
        {!doc && (
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={!!uploadingSide}
            onClick={() => inputs[side].current?.click()}
          >
            {uploading ? (
              <Spinner className="size-4 mr-1.5" />
            ) : rejected ? (
              <RefreshCw className="size-4 mr-1.5" />
            ) : (
              <Camera className="size-4 mr-1.5" />
            )}
            {uploading ? "Uploading…" : rejected ? `Replace ${SIDE_LABEL[side].toLowerCase()}` : `Upload ${SIDE_LABEL[side].toLowerCase()}`}
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <DlPhotosAlertDialog open={dlAlertOpen} onOpenChange={setDlAlertOpen} />
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>{preview?.title}</DialogTitle>
          </DialogHeader>
          <div className="p-4">{preview?.url && <ZoomableImage src={preview.url} alt={preview.title} />}</div>
        </DialogContent>
      </Dialog>

      <Card
        className={cn(
          "bg-white border rounded-xl shadow-sm",
          dl.ok ? "border-zinc-200" : "border-orange-200",
          className,
        )}
      >
        {header}
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">{(["FRONT", "BACK"] as DlPhotoSide[]).map(tile)}</div>
          {dl.ok ? (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5" />
              {isDl ? "Attached to this booking." : "On file for this booking."}
            </p>
          ) : (
            <p className="text-xs text-orange-700 flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              Upload the {dl.missingSides.map((s) => SIDE_LABEL[s].toLowerCase()).join(" and ")} of your {copy.short} to continue.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
};

/** Checkout card for the driving licence photos (Oct 17 2026); loads the KYC documents. */
export const DlPhotosCheckoutCard = ({ className }: { className?: string }) => (
  <KycPhotosCheckoutCard type="DL" className={className} />
);

/** Checkout card for the Aadhaar photos (Oct 25 2026); next to the DL card, which loads the documents. */
export const AadhaarPhotosCheckoutCard = ({ className, fetchOnMount = false }: { className?: string; fetchOnMount?: boolean }) => (
  <KycPhotosCheckoutCard type="AADHAAR" className={className} fetchOnMount={fetchOnMount} />
);
