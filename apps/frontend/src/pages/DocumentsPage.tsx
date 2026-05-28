import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Shield, Loader2, User } from "lucide-react";
import axios from "axios";
import type { KycDocumentType, KycSide } from "@/services/kyc.service";

import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentTypeSelector } from "@/components/verification/DocumentTypeSelector";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import { compressImage } from "@/lib/utils";
import { UploadedDocumentsGrid } from "@/components/verification/UploadedDocumentsGrid";

import { useKycStore } from "@/store/kyc.store";
import { useAuthStore } from "@/store/auth.store";
import { kycService } from "@/services/kyc.service";

export function DocumentsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();

  const {
    selectedDocumentType,
    uploadedDocuments,
    isFetching,
    deletingDocumentId,
    setSelectedDocumentType,
    setUploadedDocuments,
    addDocument,
    removeDocument,
    setIsUploading,
    setIsFetching,
    setDeletingDocumentId,
  } = useKycStore();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProfileMissing, setIsProfileMissing] = useState(false);
  const [uploadingSide, setUploadingSide] = useState<KycSide | null>(null);
  const [selectedSide, setSelectedSide] = useState<KycSide | null>(null);

  const handleSelectType = useCallback(
    (type: KycDocumentType | null) => {
      setSelectedDocumentType(type);
      setSelectedSide(null);
      setUploadError(null);
    },
    [setSelectedDocumentType],
  );

  // Fetch existing documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsFetching(true);
      try {
        const response = await kycService.getDocuments();
        setUploadedDocuments(response.data);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 403) {
            toast.error("Please sign in to continue");
            navigate("/auth/sign-in", { replace: true });
          } else if (
            error.response?.status === 404 &&
            error.response?.data?.message === "Customer profile not found"
          ) {
            setIsProfileMissing(true);
          } else {
            toast.error("Failed to load documents");
          }
        } else {
          toast.error("Failed to load documents");
        }
      } finally {
        setIsFetching(false);
      }
    };

    if (isAuthenticated) {
      fetchDocuments();
    }
  }, [isAuthenticated, setUploadedDocuments, setIsFetching, navigate]);

  // Handle file upload
  const handleFileSelect = useCallback(
    async (file: File, side: KycSide) => {
      if (!selectedDocumentType) {
        toast.error("Please select a document type first");
        return;
      }

      setUploadError(null);
      setUploadingSide(side);
      setIsUploading(true);

      try {
        const processedFile = await compressImage(file);
        const response = await kycService.uploadDocument(
          processedFile,
          selectedDocumentType,
          side,
        );
        addDocument(response.data);
        toast.success(`${side === "FRONT" ? "Front" : "Back"} side uploaded`);
        setSelectedSide(null);

        // Auto-deselect type once both sides are uploaded
        const allDocs = useKycStore.getState().uploadedDocuments;
        const hasFront = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "FRONT",
        );
        const hasBack = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "BACK",
        );
        if (hasFront && hasBack) {
          setSelectedDocumentType(null);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 403) {
            toast.error("Please sign in to continue");
            navigate("/auth/sign-in", { replace: true });
          } else if (error.response?.status === 409) {
            setUploadError(
              "This side already exists. Delete it first to re-upload.",
            );
            toast.error("Document already exists");
          } else {
            setUploadError(error.response?.data?.message || "Upload failed");
            toast.error("Failed to upload document");
          }
        } else {
          setUploadError("An unexpected error occurred");
          toast.error("Failed to upload document");
        }
      } finally {
        setIsUploading(false);
        setUploadingSide(null);
      }
    },
    [
      selectedDocumentType,
      addDocument,
      setIsUploading,
      setSelectedDocumentType,
      navigate,
    ],
  );

  // Handle document deletion
  const handleDeleteDocument = useCallback(
    async (publicId: string) => {
      const user = useAuthStore.getState().user;
      if (!user?.id) {
        toast.error("User information missing");
        return;
      }

      setDeletingDocumentId(publicId);

      try {
        await kycService.deleteDocument(publicId, user.id);
        removeDocument(publicId);
        toast.success("Document deleted successfully");
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          toast.error("Please sign in to continue");
          navigate("/auth/sign-in", { replace: true });
        } else {
          toast.error("Failed to delete document");
        }
      } finally {
        setDeletingDocumentId(null);
      }
    },
    [removeDocument, setDeletingDocumentId, navigate],
  );

  const KYC_TYPES: KycDocumentType[] = ["DL", "AADHAAR", "PAN"];

  const fullyUploadedTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some((d) => d.type === type && d.side === "FRONT");
    const hasBack = uploadedDocuments.some((d) => d.type === type && d.side === "BACK");
    return hasFront && hasBack;
  });

  const partialTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some((d) => d.type === type && d.side === "FRONT");
    const hasBack = uploadedDocuments.some((d) => d.type === type && d.side === "BACK");
    return (hasFront || hasBack) && !(hasFront && hasBack);
  });

  const frontDoc = selectedDocumentType
    ? uploadedDocuments.find((d) => d.type === selectedDocumentType && d.side === "FRONT")
    : null;
  const backDoc = selectedDocumentType
    ? uploadedDocuments.find((d) => d.type === selectedDocumentType && d.side === "BACK")
    : null;

  // Loading state
  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center p-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-serif font-black tracking-tight text-zinc-900 md:text-4xl">
              Documents
            </h1>
            <p className="mt-2 text-zinc-400 font-medium">
              Manage your premium identity verification documents
            </p>
          </div>
        </div>

        {/* Main Card */}
        <Card className="border-0 shadow-2xl bg-white rounded-[2rem] overflow-hidden relative">
          {/* Subtle Inner Glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />

          <CardHeader className="pb-6 pt-8 px-8 border-b border-zinc-200 relative z-10">
            <CardTitle className="text-2xl font-serif font-black tracking-tight text-zinc-900">
              Identity Verification
            </CardTitle>
            <CardDescription className="text-zinc-400 font-medium text-sm">
              Upload your official documents to maintain premium service
              standards.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-10 pt-8 px-8 pb-8 relative z-10">
            {isProfileMissing ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-zinc-100">
                  <User className="w-10 h-10 text-zinc-300" />
                </div>
                <h2 className="text-2xl font-serif font-black text-zinc-900 mb-3">
                  Complete Your Profile
                </h2>
                <p className="text-zinc-500 max-w-md mx-auto mb-8 font-medium leading-relaxed">
                  To access identity verification and upload documents, you first need to complete your customer profile with basic information.
                </p>
                <Button
                  size="lg"
                  onClick={() => navigate("/profile")}
                  className="rounded-full px-10 h-14 bg-zinc-900 text-white hover:bg-zinc-800 transition-all duration-300 font-bold shadow-xl shadow-zinc-200"
                >
                  Complete Profile
                </Button>
              </div>
            ) : (
              <>
                {/* Step 1 — Document Type */}
                <section>
                  <h2 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-zinc-200">
                    Step 1 — Select Document Type
                  </h2>
                  <DocumentTypeSelector
                    selectedType={selectedDocumentType}
                    onSelectType={handleSelectType}
                    disabledTypes={fullyUploadedTypes}
                    partialTypes={partialTypes}
                  />
                </section>

                {/* Step 2 — Side Selection */}
                {selectedDocumentType && (
                  <section>
                    <h2 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-zinc-200">
                      Step 2 — Select Side
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                      {(["FRONT", "BACK"] as KycSide[]).map((side) => {
                        const isUploaded = side === "FRONT" ? !!frontDoc : !!backDoc;
                        const isSelected = selectedSide === side;
                        return (
                          <button
                            key={side}
                            type="button"
                            onClick={() => !isUploaded && setSelectedSide(side)}
                            disabled={isUploaded}
                            className={[
                              "relative flex flex-col items-center justify-center gap-2 p-5 rounded-[1.5rem] border-2 transition-all duration-200 focus:outline-none",
                              isSelected
                                ? "border-orange-400 bg-orange-50 shadow-[0_0_20px_rgba(249,115,22,0.1)]"
                                : isUploaded
                                  ? "border-emerald-200 bg-emerald-50/50 opacity-70 cursor-not-allowed"
                                  : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 cursor-pointer",
                            ].join(" ")}
                          >
                            {isUploaded && (
                              <span className="absolute top-3 right-3 text-[9px] font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                Uploaded
                              </span>
                            )}
                            <span className="text-base font-bold text-zinc-900">
                              {side === "FRONT" ? "Front Side" : "Back Side"}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {side === "FRONT"
                                ? "Photo / ID number side"
                                : "Address / signature side"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Step 3 — Upload Zone */}
                {selectedDocumentType && selectedSide && (
                  <section>
                    <h2 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-zinc-200">
                      Step 3 — Upload {selectedSide === "FRONT" ? "Front" : "Back"} Side
                    </h2>
                    <DocumentUploadZone
                      side={selectedSide}
                      onFileSelect={(file) => handleFileSelect(file, selectedSide)}
                      isUploading={!!uploadingSide}
                      disabled={false}
                      error={uploadError}
                    />
                  </section>
                )}

                {!selectedDocumentType && (
                  <p className="text-sm font-medium text-zinc-500 text-center">
                    Select a document type above to continue
                  </p>
                )}

                {/* Uploaded Documents Grid */}
                <section>
                  <h2 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-zinc-200">
                    Uploaded Documents
                  </h2>
                  {isFetching ? (
                    <div className="space-y-4">
                      <Skeleton className="h-4 w-48 rounded-full" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map((i) => (
                          <Skeleton
                            key={i}
                            className="aspect-[1.586/1] rounded-2xl bg-white/10"
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <UploadedDocumentsGrid
                      documents={uploadedDocuments}
                      onDeleteDocument={handleDeleteDocument}
                      deletingDocumentId={deletingDocumentId}
                    />
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>

        {/* Security Note */}
        <div className="mt-8 flex items-center justify-center gap-2 text-sm font-medium text-zinc-500">
          <Shield className="w-4 h-4 text-emerald-500/80" />
          <span>
            Your documents are encrypted and stored securely within our private
            vault.
          </span>
        </div>
      </div>
    </DashboardLayout>
  );
}
