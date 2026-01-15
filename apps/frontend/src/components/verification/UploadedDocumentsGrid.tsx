import type { KycDocument } from '@/services/kyc.service';
import { UploadedDocumentCard } from './UploadedDocumentCard';
import { FileX } from 'lucide-react';

interface UploadedDocumentsGridProps {
    documents: KycDocument[];
    onDeleteDocument: (publicId: string) => void;
    deletingDocumentId: string | null;
}

export const UploadedDocumentsGrid = ({
    documents,
    onDeleteDocument,
    deletingDocumentId,
}: UploadedDocumentsGridProps) => {
    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="p-4 bg-muted rounded-full mb-4">
                    <FileX className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-1">
                    No documents uploaded
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                    Select a document type above and upload your KYC documents to continue
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Uploaded Documents ({documents.length})
                </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {documents.map((doc) => (
                    <UploadedDocumentCard
                        key={doc.publicId}
                        document={doc}
                        onDelete={onDeleteDocument}
                        isDeleting={deletingDocumentId === doc.publicId}
                    />
                ))}
            </div>
        </div>
    );
};
