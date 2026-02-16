import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { Upload, FileImage, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

interface DocumentUploadZoneProps {
    onFileSelect: (file: File) => void;
    isUploading: boolean;
    disabled?: boolean;
    error?: string | null;
}

const ACCEPTED_TYPES = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf'],
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB as per docs

export const DocumentUploadZone = ({
    onFileSelect,
    isUploading,
    disabled = false,
    error,
}: DocumentUploadZoneProps) => {
    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length > 0 && !isUploading && !disabled) {
                onFileSelect(acceptedFiles[0]);
            }
        },
        [onFileSelect, isUploading, disabled]
    );

    const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } =
        useDropzone({
            onDrop,
            accept: ACCEPTED_TYPES,
            maxSize: MAX_FILE_SIZE,
            multiple: false,
            disabled: isUploading || disabled,
        });

    // Get rejection error message
    const rejectionError = fileRejections[0]?.errors[0]?.message;

    return (
        <div className="space-y-2">
            <div
                {...getRootProps()}
                className={cn(
                    'relative flex flex-col items-center justify-center w-full min-h-[200px] p-6 sm:p-8',
                    'border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    isDragActive && !isDragReject
                        ? 'border-primary bg-primary/5'
                        : isDragReject
                            ? 'border-destructive bg-destructive/5'
                            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
                    (isUploading || disabled) && 'opacity-60 cursor-not-allowed'
                )}
            >
                <input {...getInputProps()} />

                {isUploading ? (
                    <div className="flex flex-col items-center gap-3">
                        <Spinner className="w-10 h-10 text-primary" />
                        <p className="text-sm font-medium text-muted-foreground">
                            Uploading document...
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Icon */}
                        <div
                            className={cn(
                                'p-4 rounded-full mb-4 transition-colors',
                                isDragActive && !isDragReject
                                    ? 'bg-primary text-primary-foreground'
                                    : isDragReject
                                        ? 'bg-destructive text-destructive-foreground'
                                        : 'bg-muted text-muted-foreground'
                            )}
                        >
                            {isDragReject ? (
                                <AlertCircle className="w-8 h-8" />
                            ) : isDragActive ? (
                                <FileImage className="w-8 h-8" />
                            ) : (
                                <Upload className="w-8 h-8" />
                            )}
                        </div>

                        {/* Text */}
                        <p className="text-base font-medium text-foreground text-center mb-1">
                            {isDragReject
                                ? 'Invalid file type'
                                : isDragActive
                                    ? 'Drop your document here'
                                    : 'Drag and drop your documents here'}
                        </p>
                        <p className="text-sm text-muted-foreground text-center">
                            Or{' '}
                            <span className="text-primary font-medium hover:underline">
                                browse files
                            </span>{' '}
                            from your computer
                        </p>

                        {/* Format info */}
                        <div className="flex flex-wrap items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <FileImage className="w-3 h-3" />
                                JPG, PNG, PDF
                            </span>
                            <span>•</span>
                            <span>Max 15MB per file</span>
                        </div>
                    </>
                )}
            </div>

            {/* Error messages */}
            {(error || rejectionError) && (
                <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {error || rejectionError}
                </p>
            )}
        </div>
    );
};
