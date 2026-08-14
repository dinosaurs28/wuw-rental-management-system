import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { useKycStore } from "@/store/kyc.store";
import { useAuthStore } from "@/store/auth.store";
import { kycService, type KycDocument, type KycDocumentType } from "@/services/kyc.service";
import { InlineKycUpload } from "./InlineKycUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, FileText, ArrowRight, Eye, Upload, User, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const KYC_TYPE_LABELS: Record<string, string> = {
  DL: "Driver's License",
  AADHAAR: "Aadhaar Card",
  PAN: "PAN Card",
};

const KYC_TYPES: KycDocumentType[] = ["DL", "AADHAAR", "PAN"];

interface DocGroup {
  type: KycDocumentType;
  front: KycDocument | null;
  back: KycDocument | null;
  isComplete: boolean;
}

interface KycSelectionCardProps {
  className?: string;
}

export const KycSelectionCard = ({ className }: KycSelectionCardProps) => {
  const navigate = useNavigate();
  const { selectedKycFilePublicId, setSelectedKyc } = useVehicleRentalStore();
  const { uploadedDocuments, setUploadedDocuments, isFetching, setIsFetching } =
    useKycStore();
  const [error, setError] = useState<string | null>(null);
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [showInlineKycUpload, setShowInlineKycUpload] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Group documents by type, pairing front + back
  const docGroups: DocGroup[] = KYC_TYPES.map((type) => {
    const front = uploadedDocuments.find((d) => d.type === type && d.side === "FRONT") ?? null;
    const back = uploadedDocuments.find((d) => d.type === type && d.side === "BACK") ?? null;
    return { type, front, back, isComplete: !!front && !!back };
  }).filter((g) => g.front || g.back); // only show types with at least one side uploaded

  const completeGroups = docGroups.filter((g) => g.isComplete);
  const incompleteGroups = docGroups.filter((g) => !g.isComplete);

  const fetchDocuments = useCallback(async () => {
    setIsFetching(true);
    setError(null);
    setProfileNotFound(false);
    try {
      const response = await kycService.getDocuments();
      setUploadedDocuments(response.data);
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || "Failed to load KYC documents";
      if ((status === 400 || status === 404) && message === "Customer profile not found") {
        setProfileNotFound(true);
        setIsFetching(false);
        return;
      }
      setError(message);
      toast.error(message);
    } finally {
      setIsFetching(false);
    }
  }, [setUploadedDocuments, setIsFetching]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Auto-open inline upload when loading is done and no complete document exists
  useEffect(() => {
    if (!isFetching && !error && !profileNotFound && completeGroups.length === 0 && uploadedDocuments.length >= 0) {
      setShowInlineKycUpload(true);
    }
  }, [isFetching, error, profileNotFound, completeGroups.length, uploadedDocuments.length]);

  // Clear selection if the selected file no longer belongs to a complete type
  useEffect(() => {
    if (!selectedKycFilePublicId) return;
    const stillValid = completeGroups.some(
      (g) => g.front?.file.publicId === selectedKycFilePublicId,
    );
    if (!stillValid) setSelectedKyc(null);
  }, [completeGroups, selectedKycFilePublicId, setSelectedKyc]);

  const handleSelectGroup = (group: DocGroup) => {
    if (!group.isComplete) return;
    // Use the FRONT file's publicId as the booking KYC reference
    setSelectedKyc(group.front!.file.publicId);
  };

  const handleViewDoc = (e: React.MouseEvent, doc: KycDocument, label: string) => {
    e.stopPropagation();
    if (doc.file?.url) setPreviewImage({ url: doc.file.url, title: label });
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isFetching) {
    return (
      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // ── Profile missing ──────────────────────────────────────────────────────────
  if (profileNotFound) {
    return (
      <Card className={cn("bg-white border border-orange-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-4 rounded-full bg-orange-100 p-4">
              <User className="size-8 text-orange-600" />
            </div>
            <p className="text-base font-medium text-orange-800 mb-1">Complete Your Profile First</p>
            <p className="text-sm text-orange-700 mb-6 max-w-xs">
              Please complete your profile before uploading KYC documents and proceeding with booking.
            </p>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                useAuthStore.getState().setBookingIntent();
                navigate("/profile");
              }}
            >
              Complete Profile
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>{previewImage?.title}</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            {previewImage?.url && (
              <ZoomableImage src={previewImage.url} alt={previewImage.title} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
          <p className="text-sm text-muted-foreground">
            Both front and back sides are required for a valid document
          </p>
        </CardHeader>

        <CardContent className="space-y-3">
          {showInlineKycUpload ? (
            <InlineKycUpload
              onUploadSuccess={() => {
                setShowInlineKycUpload(false);
                fetchDocuments();
              }}
              onCancel={() => setShowInlineKycUpload(false)}
            />
          ) : (
            <>
              {/* Complete document groups — selectable */}
              {completeGroups.map((group) => {
                const isSelected = selectedKycFilePublicId === group.front?.file.publicId;
                const label = KYC_TYPE_LABELS[group.type] || group.type;

                return (
                  <button
                    key={group.type}
                    onClick={() => handleSelectGroup(group)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200 text-left",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-zinc-200 hover:border-zinc-300 bg-white",
                    )}
                  >
                    {/* Front + Back thumbnails */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      {[group.front, group.back].map((doc, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-12 h-12 rounded-lg overflow-hidden border-2 relative group/thumb",
                            isSelected ? "border-primary" : "border-zinc-200",
                          )}
                        >
                          {doc?.file?.url ? (
                            <>
                              <img
                                src={doc.file.url}
                                alt={i === 0 ? "Front" : "Back"}
                                className="w-full h-full object-cover"
                              />
                              <button
                                onClick={(e) => handleViewDoc(e, doc, `${label} — ${i === 0 ? "Front" : "Back"}`)}
                                className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity"
                              >
                                <Eye className="size-3.5 text-white" />
                              </button>
                            </>
                          ) : (
                            <div className="w-full h-full bg-zinc-100 flex items-center justify-center">
                              <FileText className="size-4 text-zinc-400" />
                            </div>
                          )}
                          <span className="absolute bottom-0 left-0 right-0 text-[8px] font-black text-center bg-black/50 text-white py-0.5">
                            {i === 0 ? "FRONT" : "BACK"}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Labels */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium text-sm", isSelected ? "text-primary" : "text-foreground")}>
                          {label}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          Both sides ✓
                        </span>
                      </div>
                      {group.front?.status === "APPROVED" && group.back?.status === "APPROVED" ? (
                        <p className="text-xs text-green-600 mt-0.5">Verified</p>
                      ) : (
                        <p className="text-xs text-amber-600 mt-0.5">Pending verification</p>
                      )}
                    </div>

                    {/* Selection indicator */}
                    <div className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                      isSelected ? "border-primary bg-primary" : "border-zinc-300 bg-white",
                    )}>
                      {isSelected && <Check className="size-4 text-white" />}
                    </div>
                  </button>
                );
              })}

              {/* Incomplete groups — warning + complete button */}
              {incompleteGroups.map((group) => {
                const label = KYC_TYPE_LABELS[group.type] || group.type;
                const missingSide = group.front ? "Back" : "Front";

                return (
                  <div
                    key={group.type}
                    className="flex items-center gap-3 p-3 rounded-lg border-2 border-amber-200 bg-amber-50/50"
                  >
                    <div className="p-2 rounded-full bg-amber-100 flex-shrink-0">
                      <AlertCircle className="size-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800">{label}</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {missingSide} side missing — upload to use for booking
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-100 flex-shrink-0 text-xs"
                      onClick={() => setShowInlineKycUpload(true)}
                    >
                      Upload {missingSide}
                    </Button>
                  </div>
                );
              })}

              {/* No documents at all */}
              {docGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="size-14 text-zinc-300 mb-4" />
                  <p className="text-base font-medium text-foreground mb-1">No documents found</p>
                  <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                    Upload both front and back of a government ID to proceed with booking.
                  </p>
                </div>
              )}

              {/* Upload / manage button */}
              <div className="pt-3 border-t border-zinc-100">
                <button
                  onClick={() => setShowInlineKycUpload(true)}
                  className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2 w-full"
                >
                  <Upload className="size-4" />
                  <span>
                    Upload a new document —{" "}
                    <span className="text-primary font-medium">Upload here</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
};
