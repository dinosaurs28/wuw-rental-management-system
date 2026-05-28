import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { Upload, FileImage, AlertCircle, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { KycSide } from "@/services/kyc.service";

interface DocumentUploadZoneProps {
  onFileSelect: (file: File) => void;
  isUploading: boolean;
  disabled?: boolean;
  error?: string | null;
  side?: KycSide;
  alreadyUploaded?: boolean;
}

const ACCEPTED_TYPES = {
  "image/*": [".jpg", ".jpeg", ".png", ".heic", ".heif"],
  "application/pdf": [".pdf"],
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export const DocumentUploadZone = ({
  onFileSelect,
  isUploading,
  disabled = false,
  error,
  side,
  alreadyUploaded = false,
}: DocumentUploadZoneProps) => {
  const sideLabel = side === "FRONT" ? "Front Side" : side === "BACK" ? "Back Side" : null;
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: any[]) => {
      // If dropzone rejects it (e.g. because of MIME type vs extension mismatch)
      // but it's an image, we try to pass it anyway so our utility can try to fix it
      const fileToProcess =
        acceptedFiles[0] || (fileRejections[0]?.file as File);

      if (fileToProcess && !isUploading && !disabled) {
        onFileSelect(fileToProcess);
      }
    },
    [onFileSelect, isUploading, disabled],
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    fileRejections,
  } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: false,
    disabled: isUploading || disabled,
  });

  // Get rejection error message
  const rejectionError = fileRejections[0]?.errors[0]?.message;

  if (alreadyUploaded) {
    return (
      <div className="space-y-2">
        {sideLabel && (
          <p className="text-xs font-black tracking-widest uppercase text-zinc-500">
            {sideLabel}
          </p>
        )}
        <div className="flex flex-col items-center justify-center w-full min-h-[250px] p-8 border-2 border-dashed border-emerald-200 rounded-[2rem] bg-emerald-50/50">
          <div className="p-5 rounded-full bg-emerald-100 text-emerald-500 mb-4">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <p className="text-sm font-bold text-emerald-700 text-center">
            {sideLabel ?? "Document"} uploaded
          </p>
          <p className="text-xs text-emerald-600/70 mt-1 text-center">
            Delete the existing document below to re-upload
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sideLabel && (
        <p className="text-xs font-black tracking-widest uppercase text-zinc-500">
          {sideLabel}
        </p>
      )}
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center w-full min-h-[250px] p-8 sm:p-10",
          "border-2 border-dashed rounded-[2rem] cursor-pointer transition-all duration-300 overflow-hidden group",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40",
          isDragActive && !isDragReject
            ? "border-orange-400 bg-orange-50 shadow-[0_0_50px_rgba(249,115,22,0.1)]"
            : isDragReject
              ? "border-red-500/50 bg-red-500/5 shadow-[0_0_50px_rgba(239,68,68,0.1)]"
              : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100",
          (isUploading || disabled) &&
            "opacity-50 cursor-not-allowed hover:border-zinc-200 hover:bg-zinc-50",
        )}
      >
        {/* Subtle animated background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <input {...getInputProps()} />

        {isUploading ? (
          <div className="flex flex-col items-center gap-4 relative z-10">
            <Spinner className="w-12 h-12 text-zinc-700" />
            <p className="text-sm font-bold tracking-wide text-zinc-600 uppercase">
              Securely Uploading...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center relative z-10 transition-transform duration-300 group-hover:-translate-y-1">
            {/* Icon */}
            <div
              className={cn(
                "p-5 rounded-full mb-6 transition-all duration-300",
                isDragActive && !isDragReject
                  ? "bg-orange-500 text-white shadow-[0_0_30px_rgba(249,115,22,0.3)] scale-110"
                  : isDragReject
                    ? "bg-red-500/20 text-red-500 scale-110"
                    : "bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200 group-hover:text-zinc-700 group-hover:scale-105",
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
            <p className="text-lg font-bold text-zinc-900 text-center mb-2 tracking-wide">
              {isDragReject
                ? "Invalid file type detected"
                : isDragActive
                  ? "Drop to upload instantly"
                  : "Drag & drop your document securely"}
            </p>
            <p className="text-sm font-medium text-zinc-500 text-center">
              Or{" "}
              <span className="text-zinc-900 hover:text-zinc-600 font-bold underline underline-offset-4 decoration-zinc-400/30 transition-colors cursor-pointer">
                browse files
              </span>{" "}
              from your device
            </p>

            {/* Format info */}
            <div className="flex flex-wrap items-center justify-center gap-4 mt-8 pt-6 border-t border-zinc-200 text-[10px] font-black tracking-widest uppercase text-zinc-500 w-full max-w-xs">
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
