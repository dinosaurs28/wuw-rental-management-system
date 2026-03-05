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
    'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.heif'],
    'application/pdf': ['.pdf'],
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export const DocumentUploadZone = ({
    onFileSelect,
    isUploading,
    disabled = false,
    error,
}: DocumentUploadZoneProps) => {
    const onDrop = useCallback(
        (acceptedFiles: File[], fileRejections: any[]) => {
            // If dropzone rejects it (e.g. because of MIME type vs extension mismatch)
            // but it's an image, we try to pass it anyway so our utility can try to fix it
            const fileToProcess = acceptedFiles[0] || (fileRejections[0]?.file as File);

            if (fileToProcess && !isUploading && !disabled) {
                onFileSelect(fileToProcess);
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
                    'relative flex flex-col items-center justify-center w-full min-h-[250px] p-8 sm:p-10',
                    'border-2 border-dashed rounded-[2rem] cursor-pointer transition-all duration-300 overflow-hidden group',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                    isDragActive && !isDragReject
                        ? 'border-white/50 bg-white/5 shadow-[0_0_50px_rgba(255,255,255,0.05)]'
                        : isDragReject
                            ? 'border-red-500/50 bg-red-500/5 shadow-[0_0_50px_rgba(239,68,68,0.1)]'
                            : 'border-white/10 bg-black/20 hover:border-white/30 hover:bg-black/40',
                    (isUploading || disabled) && 'opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-black/20'
                )}
            >
                {/* Subtle animated background gradient */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                <input {...getInputProps()} capture="environment" />

                {isUploading ? (
                    <div className="flex flex-col items-center gap-4 relative z-10">
                        <Spinner className="w-12 h-12 text-white" />
                        <p className="text-sm font-bold tracking-wide text-zinc-300 uppercase">
                            Securely Uploading...
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center relative z-10 transition-transform duration-300 group-hover:-translate-y-1">
                        {/* Icon */}
                        <div
                            className={cn(
                                'p-5 rounded-full mb-6 transition-all duration-300',
                                isDragActive && !isDragReject
                                    ? 'bg-white text-zinc-950 shadow-[0_0_30px_rgba(255,255,255,0.3)] scale-110'
                                    : isDragReject
                                        ? 'bg-red-500/20 text-red-500 scale-110'
                                        : 'bg-white/5 text-zinc-400 group-hover:bg-white/10 group-hover:text-white group-hover:scale-105'
                            )}
                        >
                            {isDragReject ? (
                                <AlertCircle className="w-10 h-10" />
                            ) : isDragActive ? (
                                <FileImage className="w-10 h-10" />
                            ) : (
                                <Upload className="w-10 h-10" />
                            )}
                        </div>

                        {/* Text */}
                        <p className="text-lg font-bold text-white text-center mb-2 tracking-wide">
                            {isDragReject
                                ? 'Invalid file type detected'
                                : isDragActive
                                    ? 'Drop to upload instantly'
                                    : 'Drag & drop your document securely'}
                        </p>
                        <p className="text-sm font-medium text-zinc-500 text-center">
                            Or{' '}
                            <span className="text-white hover:text-zinc-300 font-bold underline underline-offset-4 decoration-white/30 transition-colors cursor-pointer">
                                browse files
                            </span>{' '}
                            from your device
                        </p>

                        {/* Format info */}
                        <div className="flex flex-wrap items-center justify-center gap-4 mt-8 pt-6 border-t border-white/5 text-[10px] font-black tracking-widest uppercase text-zinc-600 w-full max-w-xs">
                            <span className="flex items-center gap-2">
                                <FileImage className="w-3.5 h-3.5" />
                                JPG, PNG, PDF, HEIC
                            </span>
                            <span className="text-zinc-700">•</span>
                            <span>Max 15MB</span>
                        </div>
                    </div>
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
