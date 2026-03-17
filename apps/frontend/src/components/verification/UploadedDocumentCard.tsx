import { useState } from "react";
import { cn } from "@/lib/utils";
import type { KycDocument } from "@/services/kyc.service";
import { FileText, Trash2, Eye, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";

interface UploadedDocumentCardProps {
  document: KycDocument;
  onDelete: (publicId: string) => void;
  isDeleting: boolean;
}

// Helper to get document type display name
const getDocumentTypeName = (type: string): string => {
  switch (type) {
    case "DL":
      return "Driver's License";
    case "AADHAAR":
      return "Aadhaar";
    case "PAN":
      return "PAN Card";
    default:
      return type;
  }
};

// Helper to check if file is an image
const isImageFile = (mime: string): boolean => {
  return mime.startsWith("image/");
};

export const UploadedDocumentCard = ({
  document,
  onDelete,
  isDeleting,
}: UploadedDocumentCardProps) => {
  const [isViewOpen, setIsViewOpen] = useState(false);
  const isImage = isImageFile(document.file.mime);
  const fileName = document.file.key.split("/").pop() || "Document";

  return (
    <>
      <div
        className={cn(
          "group relative flex flex-col bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-[1.5rem] overflow-hidden transition-all duration-500",
          "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] hover:border-white/10 hover:-translate-y-1",
          isDeleting && "opacity-60 pointer-events-none scale-[0.98]",
        )}
      >
        {/* Subtle Inner Glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        {/* Thumbnail / Preview */}
        <div className="relative aspect-[16/9] bg-black/40 flex items-center justify-center overflow-hidden border-b border-white/5">
          {/* Dark gradient overlay for image readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent z-10" />

          {isImage ? (
            <img
              src={document.file.url}
              alt={getDocumentTypeName(document.type)}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-zinc-500 z-20">
              <FileText className="w-12 h-12 opacity-50" />
              <span className="text-[10px] font-black uppercase tracking-widest">
                PDF Document
              </span>
            </div>
          )}

          {/* Status Badge */}
          <span
            className={cn(
              "absolute top-3 left-3 text-[10px] font-black tracking-widest uppercase px-3 py-1.5 rounded-full z-20 backdrop-blur-md border",
              document.status === "APPROVED"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : document.status === "REJECTED"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20",
            )}
          >
            {document.status}
          </span>
        </div>

        {/* Info & Actions */}
        <div className="p-4 relative z-20 flex-1 flex flex-col justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-white truncate drop-shadow-sm">
              {getDocumentTypeName(document.type)}
            </p>
            <p className="text-[10px] font-medium text-zinc-500 truncate flex items-center gap-1.5 mt-1">
              {isImage ? (
                <ImageIcon className="w-3 h-3 flex-shrink-0" />
              ) : (
                <FileText className="w-3 h-3 flex-shrink-0" />
              )}
              {fileName}
            </p>
          </div>

          {/* Action Icons */}
          <div className="flex items-center gap-2 flex-shrink-0 pt-3 border-t border-white/5">
            {/* View Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsViewOpen(true)}
              className="flex-1 h-9 rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white transition-all duration-300 font-medium text-xs tracking-wide"
            >
              <Eye className="w-4 h-4 mr-2" />
              View
            </Button>

            <div className="w-px h-4 bg-white/10" />

            {/* Delete Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(document.publicId)}
              disabled={isDeleting}
              className="flex-1 h-9 rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-300 font-medium text-xs tracking-wide"
            >
              {isDeleting ? (
                <>
                  <Spinner className="w-4 h-4 mr-2" />
                  Deleting
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* View Image Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-4xl w-[95vw] p-0 overflow-hidden bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl">
          <DialogHeader className="p-4 pb-3 border-b border-white/5 bg-zinc-900/50 backdrop-blur-xl">
            <DialogTitle className="text-lg font-serif font-bold text-white">
              {getDocumentTypeName(document.type)}
            </DialogTitle>
            <DialogClose className="absolute right-4 top-4 rounded-full p-1 opacity-70 transition-opacity hover:bg-white/10 hover:opacity-100 focus:outline-none">
              <X className="h-5 w-5 text-white" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>
          <div className="relative w-full max-h-[75vh] min-h-[50vh] overflow-auto bg-black/50 flex items-center justify-center p-4">
            {isImage ? (
              <img
                src={document.file.url}
                alt={getDocumentTypeName(document.type)}
                className="w-auto h-auto max-w-full max-h-[70vh] object-contain rounded-lg shadow-xl"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-6 text-zinc-500">
                <FileText className="w-20 h-20 opacity-50" />
                <p className="text-sm font-medium">PDF Preview not available</p>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-full bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white transition-all"
                >
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
          <div className="p-4 bg-zinc-900/50 backdrop-blur-xl border-t border-white/5 flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-500 truncate flex-1">
              {fileName}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsViewOpen(false)}
              className="rounded-full bg-white text-zinc-950 hover:bg-zinc-200 hover:text-zinc-950 transition-all font-bold px-6 h-9"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
