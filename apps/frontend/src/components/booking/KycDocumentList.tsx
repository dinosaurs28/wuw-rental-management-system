import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Check, FileText, ArrowRight, Eye, Upload, User, Trash2 } from 'lucide-react';
import type { KycDocument } from '@/services/kyc.service';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const KYC_TYPE_LABELS: Record<string, string> = {
    DL: "Driver's License",
    AADHAAR: 'Aadhaar Card',
    PAN: 'PAN Card',
};

const KYC_TYPE_ICONS: Record<string, string> = {
    DL: '🪪',
    AADHAAR: '🆔',
    PAN: '💳',
};

interface KycDocumentListProps {
    documents: KycDocument[];
    isLoading?: boolean;
    selectedId?: string | null;
    onSelect: (doc: KycDocument) => void;
    onUploadClick?: () => void;
    onDelete?: (doc: KycDocument) => void;
    uploadLink?: string;
    userId?: string; // For making sure we don't show irrelevant info?
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
    uploadLink = '/verification/kyc',
    profileNotFound,
    error,
    className,
    pendingCount = 0
}: KycDocumentListProps) => {
    const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

    const handleViewDocument = (e: React.MouseEvent, doc: KycDocument) => {
        e.stopPropagation();
        if (doc.file?.url) {
            setPreviewImage({
                url: doc.file.url,
                title: KYC_TYPE_LABELS[doc.type] || doc.type,
            });
        }
    };

    if (isLoading) {
        return (
            <Card className={cn('bg-white border border-zinc-200 rounded-xl shadow-sm', className)}>
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

    if (profileNotFound) {
        return (
            <Card className={cn('bg-white border border-orange-200 rounded-xl shadow-sm', className)}>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="mb-4 rounded-full bg-orange-100 p-4">
                            <User className="size-8 text-orange-600" />
                        </div>
                        <p className="text-base font-medium text-orange-800 mb-1">
                            Complete Profile First
                        </p>
                        <p className="text-sm text-orange-700 mb-6 max-w-xs">
                            Profile completion is required before uploading KYC documents.
                        </p>
                        <Button
                            className="bg-orange-600 hover:bg-orange-700"
                            asChild
                        >
                            <Link to="/profile">
                                Complete Profile
                                <ArrowRight className="ml-2 size-4" />
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Error handling (removed early return)
    const errorAlert = error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
        </div>
    ) : null;

    if (documents.length === 0) {
        return (
            <Card className={cn('bg-white border border-zinc-200 rounded-xl shadow-sm', className)}>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
                </CardHeader>
                <CardContent>
                    {errorAlert}
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <FileText className="size-14 text-zinc-300 mb-4" />
                        {pendingCount > 0 ? (
                            <>
                                <p className="text-base font-medium text-foreground mb-1">
                                    Document Pending Approval
                                </p>
                                <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                                    {pendingCount} document(s) pending verification.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-base font-medium text-foreground mb-1">
                                    No documents found
                                </p>
                                <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                                    Please upload KYC documents to proceed.
                                </p>
                            </>
                        )}


                        {onUploadClick ? (
                            <Button onClick={onUploadClick} className="bg-primary hover:bg-primary/90">
                                {pendingCount > 0 ? 'Upload More' : 'Upload Document'}
                                <Upload className="ml-2 size-4" />
                            </Button>
                        ) : (
                            <Button asChild className="bg-primary hover:bg-primary/90">
                                <Link to={uploadLink}>
                                    {pendingCount > 0 ? 'Manage KYC Documents' : 'Complete KYC Verification'}
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
                            <img
                                src={previewImage.url}
                                alt={previewImage.title}
                                className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Card className={cn('bg-white border border-zinc-200 rounded-xl shadow-sm', className)}>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold">Select KYC Document</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Choose a document for this booking
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {errorAlert}
                    {documents.map((doc) => {
                        const isSelected = selectedId === doc.publicId;
                        const maskedId = `•••• •••• ${doc.file.publicId.slice(-4)}`;

                        return (
                            <div
                                key={doc.publicId}
                                onClick={() => onSelect(doc)}
                                className={cn(
                                    'w-full flex items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg border-2 transition-all duration-200 text-left cursor-pointer',
                                    isSelected
                                        ? 'border-primary bg-primary/5'
                                        : 'border-zinc-200 hover:border-zinc-300 bg-white'
                                )}
                            >
                                <div className={cn(
                                    'flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden border-2',
                                    isSelected ? 'border-primary' : 'border-zinc-200'
                                )}>
                                    {doc.file?.url ? (
                                        <img
                                            src={doc.file.url}
                                            alt={KYC_TYPE_LABELS[doc.type] || doc.type}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className={cn(
                                            'w-full h-full flex items-center justify-center text-lg',
                                            isSelected ? 'bg-primary/10' : 'bg-zinc-100'
                                        )}>
                                            {KYC_TYPE_ICONS[doc.type] || '📄'}
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                        <span className={cn(
                                            'font-medium text-sm',
                                            isSelected ? 'text-primary' : 'text-foreground'
                                        )}>
                                            {KYC_TYPE_LABELS[doc.type] || doc.type}
                                        </span>
                                        <span className={cn(
                                            'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full w-fit',
                                            doc.status === 'APPROVED' && 'bg-green-100 text-green-700',
                                            doc.status === 'PENDING' && 'bg-amber-100 text-amber-700',
                                            doc.status === 'REJECTED' && 'bg-red-100 text-red-700'
                                        )}>
                                            {doc.status === 'APPROVED' ? 'Verified' : doc.status === 'PENDING' ? 'Pending' : 'Rejected'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {maskedId}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {doc.file?.url && (
                                        <button
                                            onClick={(e) => handleViewDocument(e, doc)}
                                            className="p-2 rounded-lg hover:bg-zinc-100 transition-colors"
                                            title="View document"
                                        >
                                            <Eye className="size-4 sm:size-5 text-zinc-500" />
                                        </button>
                                    )}

                                    {onDelete && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDelete(doc);
                                            }}
                                            className="p-2 rounded-lg hover:bg-red-50 text-zinc-500 hover:text-red-600 transition-colors"
                                            title="Delete document"
                                        >
                                            <Trash2 className="size-4 sm:size-5" />
                                        </button>
                                    )}

                                    <div className={cn(
                                        'w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center transition-all',
                                        isSelected
                                            ? 'border-primary bg-primary'
                                            : 'border-zinc-300 bg-white'
                                    )}>
                                        {isSelected && <Check className="size-3 sm:size-4 text-white" />}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    <div className="pt-3 border-t border-zinc-100">
                        {onUploadClick ? (
                            <button
                                onClick={onUploadClick}
                                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
                            >
                                <Upload className="size-4" />
                                <span>Not the document you have? <span className="text-primary font-medium">Upload new</span></span>
                            </button>
                        ) : (
                            <Link
                                to={uploadLink}
                                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2"
                            >
                                <Upload className="size-4" />
                                <span>Not the document you uploaded? <span className="text-primary font-medium">Upload here</span></span>
                            </Link>
                        )}
                    </div>
                </CardContent>
            </Card>
        </>
    );
};
