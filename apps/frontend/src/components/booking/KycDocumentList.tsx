import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { cn } from "@/lib/utils";
import {
  Check,
  FileText,
  ArrowRight,
  Eye,
  Upload,
  User,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type { KycDocument, KycDocumentType } from "@/services/kyc.service";
import { useState } from "react";
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

interface KycDocumentListProps {
  documents: KycDocument[];
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect: (doc: KycDocument) => void;
  onUploadClick?: () => void;
  onDelete?: (doc: KycDocument) => void;
  uploadLink?: string;
  profileNotFound?: boolean;
  error?: string | null;
  className?: string;
  pendingCount?: number;
}

export const KycDocumentList = ({
  documents,
  isLoading,
  selectedId,
  onSelect,
  onUploadClick,
  onDelete,
  uploadLink = "/verification/kyc",
  profileNotFound,
  error,
  className,
  pendingCount = 0,
}: KycDocumentListProps) => {
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Group documents by type
  const docGroups: DocGroup[] = KYC_TYPES.map((type) => {
    const front = documents.find((d) => d.type === type && d.side === "FRONT") ?? null;
    const back = documents.find((d) => d.type === type && d.side === "BACK") ?? null;
    return { type, front, back, isComplete: !!front && !!back };
  }).filter((g) => g.front || g.back);

  const completeGroups = docGroups.filter((g) => g.isComplete);
  const incompleteGroups = docGroups.filter((g) => !g.isComplete);

  const handleViewDoc = (e: React.MouseEvent, doc: KycDocument, label: string) => {
    e.stopPropagation();
    if (doc.file?.url) setPreviewImage({ url: doc.file.url, title: label });
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
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
            <p className="text-base font-medium text-orange-800 mb-1">Complete Profile First</p>
            <p className="text-sm text-orange-700 mb-6 max-w-xs">
              Profile completion is required before uploading KYC documents.
            </p>
            <Button className="bg-orange-600 hover:bg-orange-700" asChild>
              <Link to="/profile">
                Complete Profile <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const errorAlert = error ? (
    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
      {error}
    </div>
  ) : null;

  // ── No documents ─────────────────────────────────────────────────────────────
  if (documents.length === 0) {
    return (
      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
        </CardHeader>
        <CardContent>
          {errorAlert}
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="size-14 text-zinc-300 mb-4" />
            {pendingCount > 0 ? (
              <>
                <p className="text-base font-medium text-foreground mb-1">Document Pending Approval</p>
                <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                  {pendingCount} document(s) pending verification.
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-foreground mb-1">No documents found</p>
                <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                  Upload both front and back of a government ID to proceed.
                </p>
              </>
            )}
            {onUploadClick ? (
              <Button onClick={onUploadClick} className="bg-primary hover:bg-primary/90">
                {pendingCount > 0 ? "Upload More" : "Upload Document"}
                <Upload className="ml-2 size-4" />
              </Button>
            ) : (
              <Button asChild className="bg-primary hover:bg-primary/90">
                <Link to={uploadLink}>
                  {pendingCount > 0 ? "Manage KYC Documents" : "Complete KYC Verification"}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>{previewImage?.title}</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            {previewImage?.url && (
              <ZoomableImage
                src={previewImage.url}
                alt={previewImage.title}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
          <p className="text-sm text-muted-foreground">
            Both front and back sides required to proceed with booking
          </p>
        </CardHeader>

        <CardContent className="space-y-3">
          {errorAlert}

          {/* Complete groups — selectable */}
          {completeGroups.map((group) => {
            const isSelected = selectedId === group.front?.publicId;
            const label = KYC_TYPE_LABELS[group.type] || group.type;

            return (
              <div
                key={group.type}
                onClick={() => onSelect(group.front!)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200 cursor-pointer",
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
                            onClick={(e) =>
                              handleViewDoc(e, doc, `${label} — ${i === 0 ? "Front" : "Back"}`)
                            }
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

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("font-medium text-sm", isSelected ? "text-primary" : "text-foreground")}>
                      {label}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                      Both sides ✓
                    </span>
                    {group.front?.status === "APPROVED" && group.back?.status === "APPROVED" ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                        Pending
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete + selection */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onDelete && group.front && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(group.front!); }}
                      className="p-2 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors"
                      title="Delete front"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                    isSelected ? "border-primary bg-primary" : "border-zinc-300 bg-white",
                  )}>
                    {isSelected && <Check className="size-4 text-white" />}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Incomplete groups — warning */}
          {incompleteGroups.map((group) => {
            const label = KYC_TYPE_LABELS[group.type] || group.type;
            const missingSide = group.front ? "Back" : "Front";
            const presentDoc = group.front ?? group.back!;

            return (
              <div
                key={group.type}
                className="flex items-center gap-3 p-3 rounded-lg border-2 border-amber-200 bg-amber-50/50"
              >
                {/* Uploaded side thumbnail */}
                <div className="relative w-12 h-12 rounded-lg overflow-hidden border-2 border-amber-200 flex-shrink-0">
                  {presentDoc.file?.url ? (
                    <img src={presentDoc.file.url} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-amber-100 flex items-center justify-center">
                      <FileText className="size-4 text-amber-500" />
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 text-[8px] font-black text-center bg-black/50 text-white py-0.5">
                    {group.front ? "FRONT" : "BACK"}
                  </span>
                </div>

                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <AlertCircle className="size-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{label}</p>
                    <p className="text-xs text-amber-700">
                      {missingSide} side missing — required for booking
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {onDelete && (
                    <button
                      onClick={() => onDelete(presentDoc)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                  {onUploadClick && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-100 text-xs h-8"
                      onClick={onUploadClick}
                    >
                      Upload {missingSide}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Upload new */}
          <div className="pt-3 border-t border-zinc-100">
            {onUploadClick ? (
              <button
                onClick={onUploadClick}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                <Upload className="size-4" />
                <span>
                  Upload a new document —{" "}
                  <span className="text-primary font-medium">Upload here</span>
                </span>
              </button>
            ) : (
              <Link
                to={uploadLink}
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                <Upload className="size-4" />
                <span>
                  Upload here <span className="text-primary font-medium">→</span>
                </span>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};
