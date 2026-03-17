import { useState } from "react";
import { cn } from "@/lib/utils";
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

export interface UploadedImage {
  fileId: string;
  url: string;
}

interface PickupImageCardProps {
  image: UploadedImage;
  onDelete: (fileId: string) => void;
  isDeleting: boolean;
}

// Helper to check if file is an image
const isImageFile = (url: string): boolean => {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
};

export const PickupImageCard = ({
  image,
  onDelete,
  isDeleting,
}: PickupImageCardProps) => {
  const [isViewOpen, setIsViewOpen] = useState(false);
  const isImage = isImageFile(image.url);
  const fileName = image.url.split("/").pop()?.split("?")[0] || "Image";

  return (
    <>
      <div
        className={cn(
          "group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden transition-all duration-200",
          "hover:shadow-md hover:border-primary/30",
          isDeleting && "opacity-60 pointer-events-none",
        )}
      >
        {/* Thumbnail / Preview */}
        <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img
              src={image.url}
              alt="Pickup vehicle"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FileText className="w-12 h-12" />
              <span className="text-xs font-medium">Document</span>
            </div>
          )}
        </div>

        {/* Info & Actions */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
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
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsViewOpen(true)}
                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                title="View image"
              >
                <Eye className="w-4 h-4" />
              </Button>

              {/* Delete Button */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onDelete(image.fileId)}
                disabled={isDeleting}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Delete image"
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
              Pickup Image
            </DialogTitle>
            <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>
          <div className="relative w-full max-h-[70vh] overflow-auto bg-muted">
            {isImage ? (
              <img
                src={image.url}
                alt="Pickup vehicle"
                className="w-full h-auto object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <FileText className="w-16 h-16 text-muted-foreground" />
                <p className="text-muted-foreground">Preview not available</p>
                <Button asChild variant="outline">
                  <a href={image.url} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                  </a>
                </Button>
              </div>
            )}
          </div>
          <div className="p-4 pt-2 border-t bg-card">
            <p className="text-sm text-muted-foreground truncate">{fileName}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
