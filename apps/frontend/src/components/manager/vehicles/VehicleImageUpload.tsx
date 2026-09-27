import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { X, ImagePlus, Check, Star } from "lucide-react";
import { toast } from "sonner";

interface VehicleImageUploadProps {
  existingImages?: (string | File)[]; // URLs or File objects
  onImagesChange: (images: (string | File)[]) => void;
  maxFiles?: number;
}

export const VehicleImageUpload = ({
  existingImages = [],
  onImagesChange,
  maxFiles = 5,
}: VehicleImageUploadProps) => {
  const [images, setImages] = useState<(string | File)[]>(existingImages);

  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      if (images.length + acceptedFiles.length > maxFiles) {
        toast.error(`You can only upload up to ${maxFiles} images.`);
        return;
      }

      const newImages = [...images, ...acceptedFiles];
      setImages(newImages);
      onImagesChange(newImages);
    },
    [images, maxFiles, onImagesChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".jpeg", ".jpg", ".png", ".webp"],
    },
    maxSize: 15 * 1024 * 1024, // 15MB
    disabled: images.length >= maxFiles,
  });

  const removeImage = (indexToRemove: number) => {
    const newImages = images.filter((_, index) => index !== indexToRemove);
    setImages(newImages);
    onImagesChange(newImages);
  };

  const setThumbnail = (item: string | File) => {
    const newImages = [item, ...images.filter((img) => img !== item)];
    setImages(newImages);
    onImagesChange(newImages);
    toast.info("Thumbnail updated");
  };

  const getPreviewUrl = (item: string | File) => {
    if (item instanceof File) {
      return URL.createObjectURL(item);
    }
    return item;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-neutral-900">Vehicle Images</h3>
        <span className="text-sm text-neutral-500">
          {images.length} / {maxFiles} images
        </span>
      </div>

      {/* Grid of uploaded images */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
          {images.map((item, index) => {
            const url = getPreviewUrl(item);
            const isMain = index === 0;
            return (
              <div
                key={index}
                className={`group relative aspect-[4/3] bg-neutral-100 rounded-lg overflow-hidden border-2 transition-all ${
                  isMain
                    ? "border-orange-400 shadow-md"
                    : "border-neutral-200 hover:border-neutral-300 shadow-sm"
                }`}
              >
                {/* Image */}
                <img
                  src={url}
                  alt={`Vehicle ${index + 1}`}
                  className="w-full h-full object-cover"
                />

                {/* ── TOP-LEFT: MAIN badge (always visible when main) */}
                {isMain && (
                  <div className="absolute top-1.5 left-1.5 z-20 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow-md pointer-events-none">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                    MAIN
                  </div>
                )}

                {/* ── TOP-RIGHT: Delete button (always visible) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(index);
                  }}
                  title="Remove image"
                  className="absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-full bg-black/55 hover:bg-red-600 text-white flex items-center justify-center shadow transition-colors duration-150 backdrop-blur-[2px]"
                >
                  <X className="w-3 h-3" />
                </button>

                {/* ── CENTER OVERLAY: "Set Main" — only for non-main, only on hover */}
                {!isMain && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-black/30">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setThumbnail(item);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-white/95 hover:bg-orange-500 hover:text-white text-neutral-800 rounded-full shadow-lg transition-all duration-150 active:scale-95"
                    >
                      <Star className="w-3 h-3 text-orange-500 fill-orange-400" />
                      Set Main
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dropzone */}
      {images.length < maxFiles && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer text-center
                        ${isDragActive ? "border-orange-500 bg-orange-50" : "border-neutral-200 hover:border-orange-500 hover:bg-neutral-50"}
                    `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2 text-neutral-500">
            <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mb-2">
              <ImagePlus className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-neutral-900">
              Click to upload or drag and drop
            </p>
            <p className="text-xs">SVG, PNG, JPG or GIF (max. 15MB)</p>
          </div>
        </div>
      )}
    </div>
  );
};
