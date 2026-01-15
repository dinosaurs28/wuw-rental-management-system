import { cn } from '@/lib/utils';
import type { KycDocument } from '@/services/kyc.service';
import { FileText, Trash2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

interface UploadedDocumentCardProps {
    document: KycDocument;
    onDelete: (publicId: string) => void;
    isDeleting: boolean;
}

// Helper to get document type display name
const getDocumentTypeName = (type: string): string => {
    switch (type) {
        case 'DL':
            return "Driver's License";
        case 'AADHAAR':
            return 'Aadhaar';
        case 'PAN':
            return 'PAN Card';
        default:
            return type;
    }
};

// Helper to check if file is an image
const isImageFile = (mime: string): boolean => {
    return mime.startsWith('image/');
};

export const UploadedDocumentCard = ({
    document,
    onDelete,
    isDeleting,
}: UploadedDocumentCardProps) => {
    const isImage = isImageFile(document.file.mime);
    const fileName = document.file.key.split('/').pop() || 'Document';

    return (
        <div
            className={cn(
                'group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden transition-all duration-200',
                'hover:shadow-md hover:border-primary/30',
                isDeleting && 'opacity-60'
            )}
        >
            {/* Thumbnail / Preview */}
            <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                {isImage ? (
                    <img
                        src={document.file.url}
                        alt={getDocumentTypeName(document.type)}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="w-12 h-12" />
                        <span className="text-xs font-medium">PDF Document</span>
                    </div>
                )}

                {/* Delete Button Overlay */}
                <div
                    className={cn(
                        'absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-200',
                        isDeleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                >
                    {isDeleting ? (
                        <Spinner className="w-6 h-6 text-white" />
                    ) : (
                        <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => onDelete(document.publicId)}
                            className="rounded-full"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}
                </div>

                {/* Status Badge */}
                <span
                    className={cn(
                        'absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        document.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700'
                            : document.status === 'REJECTED'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                    )}
                >
                    {document.status}
                </span>
            </div>

            {/* Info */}
            <div className="p-3">
                <p className="text-sm font-semibold text-foreground truncate">
                    {getDocumentTypeName(document.type)}
                </p>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                    {isImage ? (
                        <ImageIcon className="w-3 h-3 flex-shrink-0" />
                    ) : (
                        <FileText className="w-3 h-3 flex-shrink-0" />
                    )}
                    {fileName}
                </p>
            </div>
        </div>
    );
};
