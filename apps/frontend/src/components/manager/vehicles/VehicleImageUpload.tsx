import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { X, ImagePlus, Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-4">
          {images.map((item, index) => {
            const url = getPreviewUrl(item);
            const isMain = index === 0;
            return (
              <div
                key={index}
                className={`group relative aspect-[4/3] bg-neutral-100 rounded-lg overflow-hidden border transition-all ${
                  isMain
                    ? "border-orange-500 ring-2 ring-orange-500/20 shadow-sm"
                    : "border-neutral-200 hover:border-neutral-300 shadow-sm"
                }`}
              >
                <img
                  src={url}
                  alt={`Vehicle ${index + 1}`}
                  className="w-full h-full object-cover"
                />

                {/* Main Thumbnail Badge */}
                {isMain && (
                  <div className="absolute top-2 left-2 z-10 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" />
                    MAIN
                  </div>
                )}

                {/* Top-right Delete Button (clearly visible and styled) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(index);
                  }}
                  title="Remove image"
                  className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center shadow transition-all duration-150 backdrop-blur-sm group-hover:scale-105"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                {/* Bottom Bar: Mark as Thumbnail action for non-main images */}
                {!isMain && (
                  <div className="absolute bottom-0 inset-x-0 p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setThumbnail(item);
                      }}
                      className="w-full py-1 px-2 text-[11px] font-medium bg-white/95 hover:bg-orange-500 hover:text-white text-neutral-900 rounded shadow-sm transition-all duration-150 flex items-center justify-center gap-1 active:scale-95"
                    >
                      <Star className="w-3 h-3 text-orange-500 fill-orange-500 group-hover:text-white group-hover:fill-white transition-colors" />
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
