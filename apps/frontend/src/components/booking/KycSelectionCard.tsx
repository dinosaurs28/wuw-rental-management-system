import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import { useKycStore } from "@/store/kyc.store";
import { kycService, type KycDocument } from "@/services/kyc.service";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, FileText, ArrowRight, Eye, Upload, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const KYC_TYPE_LABELS: Record<string, string> = {
  DL: "Driver's License",
  AADHAAR: "Aadhaar Card",
  PAN: "PAN Card",
};

const KYC_TYPE_ICONS: Record<string, string> = {
  DL: "🪪",
  AADHAAR: "🆔",
  PAN: "💳",
};

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
  const [pendingCount, setPendingCount] = useState(0);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Fetch KYC documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsFetching(true);
      setError(null);
      setProfileNotFound(false);
      try {
        const response = await kycService.getDocuments();
        // Show all documents regardless of status
        setUploadedDocuments(response.data);
        const pendingDocs = response.data.filter(
          (doc) => doc.status === "PENDING",
        );
        setPendingCount(pendingDocs.length);
      } catch (err: any) {
        const status = err?.response?.status;
        const message =
          err?.response?.data?.message || "Failed to load KYC documents";

        // Handle "Customer profile not found" error specifically
        if (
          (status === 400 || status === 404) &&
          message === "Customer profile not found"
        ) {
          setProfileNotFound(true);
          setIsFetching(false);
          return; // Don't show error toast for this case
        }

        setError(message);
        toast.error(message);
      } finally {
        setIsFetching(false);
      }
    };

    fetchDocuments();
  }, [setUploadedDocuments, setIsFetching]);

  const handleSelectDocument = (doc: KycDocument) => {
    setSelectedKyc(doc.file.publicId);
  };

  const handleViewDocument = (e: React.MouseEvent, doc: KycDocument) => {
    e.stopPropagation(); // Prevent selecting the document
    if (doc.file?.url) {
      setPreviewImage({
        url: doc.file.url,
        title: KYC_TYPE_LABELS[doc.type] || doc.type,
      });
    }
  };

  // Loading state
  if (isFetching) {
    return (
      <Card
        className={cn(
          "bg-white border border-zinc-200 rounded-xl shadow-sm",
          className,
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">
            Select KYC Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Profile not found state - user needs to complete profile first
  if (profileNotFound) {
    return (
      <Card
        className={cn(
          "bg-white border border-orange-200 rounded-xl shadow-sm",
          className,
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">
            Select KYC Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-4 rounded-full bg-orange-100 p-4">
              <User className="size-8 text-orange-600" />
            </div>
            <p className="text-base font-medium text-orange-800 mb-1">
              Complete Your Profile First
            </p>
            <p className="text-sm text-orange-700 mb-6 max-w-xs">
              Please complete your profile before uploading KYC documents and
              proceeding with booking.
            </p>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => navigate("/profile")}
            >
              Complete Profile
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card
        className={cn(
          "bg-white border border-zinc-200 rounded-xl shadow-sm",
          className,
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">
            Select KYC Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  // No approved documents - show appropriate message
  if (uploadedDocuments.length === 0) {
    return (
      <Card
        className={cn(
          "bg-white border border-zinc-200 rounded-xl shadow-sm",
          className,
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">
            Select KYC Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="size-14 text-zinc-300 mb-4" />
            {pendingCount > 0 ? (
              <>
                <p className="text-base font-medium text-foreground mb-1">
                  Document Pending Approval
                </p>
                <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                  You have {pendingCount} document{pendingCount > 1 ? "s" : ""}{" "}
                  pending verification. Please wait for approval or upload
                  additional documents.
                </p>
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                  <span className="text-amber-600 text-sm font-medium">
                    ⏳ {pendingCount} pending verification
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-foreground mb-1">
                  No documents found
                </p>
                <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                  Please upload and verify your KYC documents to proceed with
                  the booking.
                </p>
              </>
            )}
            <Button asChild className="bg-primary hover:bg-primary/90">
              <Link to="/verification/kyc">
                {pendingCount > 0
                  ? "Manage KYC Documents"
                  : "Complete KYC Verification"}
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
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
              <img
                src={previewImage.url}
                alt={previewImage.title}
                className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card
        className={cn(
          "bg-white border border-zinc-200 rounded-xl shadow-sm",
          className,
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">
            Select KYC Document
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose a document for this booking
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {uploadedDocuments.map((doc) => {
            const isSelected = selectedKycFilePublicId === doc.file.publicId;
            const maskedId = `•••• •••• ${doc.file.publicId.slice(-4)}`;

            return (
              <button
                key={doc.publicId}
                onClick={() => handleSelectDocument(doc)}
                className={cn(
                  "w-full flex items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg border-2 transition-all duration-200 text-left",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-zinc-200 hover:border-zinc-300 bg-white",
                )}
              >
                {/* Document Image Thumbnail */}
                <div
                  className={cn(
                    "flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden border-2",
                    isSelected ? "border-primary" : "border-zinc-200",
                  )}
                >
                  {doc.file?.url ? (
                    <img
                      src={doc.file.url}
                      alt={KYC_TYPE_LABELS[doc.type] || doc.type}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className={cn(
                        "w-full h-full flex items-center justify-center text-lg",
                        isSelected ? "bg-primary/10" : "bg-zinc-100",
                      )}
                    >
                      {KYC_TYPE_ICONS[doc.type] || "📄"}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span
                      className={cn(
                        "font-medium text-sm",
                        isSelected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {KYC_TYPE_LABELS[doc.type] || doc.type}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full w-fit",
                        doc.status === "APPROVED" &&
                          "bg-green-100 text-green-700",
                        doc.status === "PENDING" &&
                          "bg-amber-100 text-amber-700",
                        doc.status === "REJECTED" && "bg-red-100 text-red-700",
                      )}
                    >
                      {doc.status === "APPROVED"
                        ? "Verified"
                        : doc.status === "PENDING"
                          ? "Pending"
                          : "Rejected"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {maskedId}
                  </p>
                </div>

                {/* Actions: View + Selection */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* View Button */}
                  {doc.file?.url && (
                    <button
                      onClick={(e) => handleViewDocument(e, doc)}
                      className="p-2 rounded-lg hover:bg-zinc-100 transition-colors"
                      title="View document"
                    >
                      <Eye className="size-4 sm:size-5 text-zinc-500" />
                    </button>
                  )}

                  {/* Selection Indicator */}
                  <div
                    className={cn(
                      "w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center transition-all",
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-zinc-300 bg-white",
                    )}
                  >
                    {isSelected && (
                      <Check className="size-3 sm:size-4 text-white" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Upload New Document Link */}
          <div className="pt-3 border-t border-zinc-100">
            <Link
              to="/verification/kyc"
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
            >
              <Upload className="size-4" />
              <span>
                Not the document you uploaded?{" "}
                <span className="text-primary font-medium">Upload here</span>
              </span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
};
