import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Shield, Loader2 } from 'lucide-react';
import axios from 'axios';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DocumentTypeSelector } from '@/components/verification/DocumentTypeSelector';
import { DocumentUploadZone } from '@/components/verification/DocumentUploadZone';
import { UploadedDocumentsGrid } from '@/components/verification/UploadedDocumentsGrid';

import { useKycStore } from '@/store/kyc.store';
import { useAuthStore } from '@/store/auth.store';
import { kycService } from '@/services/kyc.service';

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
                    toast.error('Please sign in to continue');
                    navigate('/auth/sign-in', { replace: true });
                } else {
                    toast.error('Failed to load documents');
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
                toast.error('Please select a document type first');
                return;
            }

            setUploadError(null);
            setIsUploading(true);

            try {
                const response = await kycService.uploadDocument(file, selectedDocumentType);
                addDocument(response.data);
                setSelectedDocumentType(null);
                toast.success('Document uploaded successfully');
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    if (error.response?.status === 403) {
                        toast.error('Please sign in to continue');
                        navigate('/auth/sign-in', { replace: true });
                    } else if (error.response?.status === 409) {
                        setUploadError('Document of this type already exists. Delete it first to upload a new one.');
                        toast.error('Document already exists');
                    } else {
                        setUploadError(error.response?.data?.message || 'Upload failed');
                        toast.error('Failed to upload document');
                    }
                } else {
                    setUploadError('An unexpected error occurred');
                    toast.error('Failed to upload document');
                }
            } finally {
                setIsUploading(false);
            }
        },
        [selectedDocumentType, addDocument, setIsUploading, setSelectedDocumentType, navigate]
    );

    // Handle document deletion
    const handleDeleteDocument = useCallback(
        async (publicId: string) => {
            setDeletingDocumentId(publicId);

            try {
                await kycService.deleteDocument(publicId);
                removeDocument(publicId);
                toast.success('Document deleted successfully');
            } catch (error) {
                if (axios.isAxiosError(error) && error.response?.status === 403) {
                    toast.error('Please sign in to continue');
                    navigate('/auth/sign-in', { replace: true });
                } else {
                    toast.error('Failed to delete document');
                }
            } finally {
                setDeletingDocumentId(null);
            }
        },
        [removeDocument, setDeletingDocumentId, navigate]
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
                <div className="mb-6">
                    <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                        Documents
                    </h1>
                    <p className="mt-1 text-muted-foreground">
                        Manage your identity verification documents
                    </p>
                </div>

                {/* Main Card */}
                <Card className="shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xl font-semibold">
                            Identity Verification
                        </CardTitle>
                        <CardDescription>
                            Upload your official documents to maintain premium service standards.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-8 pt-6">
                        {/* Document Type Selection */}
                        <section>
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
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
                                <p className="text-sm text-muted-foreground text-center mt-2">
                                    Please select a document type above to enable upload
                                </p>
                            )}
                        </section>

                        {/* Uploaded Documents Grid */}
                        <section>
                            {isFetching ? (
                                <div className="space-y-4">
                                    <Skeleton className="h-4 w-48" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {[1, 2, 3].map((i) => (
                                            <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
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
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="w-4 h-4" />
                    <span>Your documents are encrypted and stored securely.</span>
                </div>
            </div>
        </DashboardLayout>
    );
}
