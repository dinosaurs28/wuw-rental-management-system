import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { KycDocument } from '@/services/kyc.service';
import { FileText, Trash2, Eye, X, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose,
} from '@/components/ui/dialog';

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
    const [isViewOpen, setIsViewOpen] = useState(false);
    const isImage = isImageFile(document.file.mime);
    const fileName = document.file.key.split('/').pop() || 'Document';

    return (
        <>
            <div
                className={cn(
                    'group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden transition-all duration-200',
                    'hover:shadow-md hover:border-primary/30',
                    isDeleting && 'opacity-60 pointer-events-none'
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

                {/* Info & Actions */}
                <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
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

                        {/* Action Icons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {/* View Button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsViewOpen(true)}
                                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                title="View document"
                            >
                                <Eye className="w-4 h-4" />
                            </Button>

                            {/* Delete Button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onDelete(document.publicId)}
                                disabled={isDeleting}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Delete document"
                            >
                                {isDeleting ? (
                                    <Spinner className="w-4 h-4" />
                                ) : (
                                    <Trash2 className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* View Image Dialog */}
            <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
                <DialogContent className="max-w-3xl w-[95vw] p-0 overflow-hidden">
                    <DialogHeader className="p-4 pb-2">
                        <DialogTitle className="text-lg font-semibold">
                            {getDocumentTypeName(document.type)}
                        </DialogTitle>
                        <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                        </DialogClose>
                    </DialogHeader>
                    <div className="relative w-full max-h-[70vh] overflow-auto bg-muted">
                        {isImage ? (
                            <img
                                src={document.file.url}
                                alt={getDocumentTypeName(document.type)}
                                className="w-full h-auto object-contain"
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center py-16 gap-4">
                                <FileText className="w-16 h-16 text-muted-foreground" />
                                <p className="text-muted-foreground">PDF Preview not available</p>
                                <Button asChild variant="outline">
                                    <a
                                        href={document.file.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open PDF in new tab
                                    </a>
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="p-4 pt-2 border-t bg-card">
                        <p className="text-sm text-muted-foreground truncate">
                            {fileName}
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};
