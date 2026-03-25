import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Shield, Loader2 } from "lucide-react";
import axios from "axios";

import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    isUploading,
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

  // Fetch existing documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsFetching(true);
      try {
        const response = await kycService.getDocuments();
        setUploadedDocuments(response.data);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          toast.error("Please sign in to continue");
          navigate("/auth/sign-in", { replace: true });
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
    async (file: File) => {
      if (!selectedDocumentType) {
        toast.error("Please select a document type first");
        return;
      }

      setUploadError(null);
      setIsUploading(true);

      try {
        const processedFile = await compressImage(file);
        const response = await kycService.uploadDocument(
          processedFile,
          selectedDocumentType,
        );
        addDocument(response.data);
        setSelectedDocumentType(null);
        toast.success("Document uploaded successfully");
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 403) {
            toast.error("Please sign in to continue");
            navigate("/auth/sign-in", { replace: true });
          } else if (error.response?.status === 409) {
            setUploadError(
              "Document of this type already exists. Delete it first to upload a new one.",
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

  // Get already uploaded document types (to disable in selector)
  const uploadedTypes = uploadedDocuments.map((doc) => doc.type);

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
            {/* Document Type Selection */}
            <section>
              <h2 className="text-xs font-black text-zinc-500/80 uppercase tracking-widest mb-6 pb-2 border-b border-zinc-200">
                Select Document Type
              </h2>
              <DocumentTypeSelector
                selectedType={selectedDocumentType}
                onSelectType={setSelectedDocumentType}
                disabledTypes={uploadedTypes}
              />
            </section>

            {/* Upload Zone */}
            <section>
              <DocumentUploadZone
                onFileSelect={handleFileSelect}
                isUploading={isUploading}
                disabled={!selectedDocumentType}
                error={uploadError}
              />
              {!selectedDocumentType && !isUploading && (
                <p className="text-sm font-medium text-zinc-500 text-center mt-4">
                  Please select a document type above to enable the upload zone
                </p>
              )}
            </section>

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
