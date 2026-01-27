import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { X, ImagePlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

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

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;

        if (images.length + acceptedFiles.length > maxFiles) {
            toast.error(`You can only upload up to ${maxFiles} images.`);
            return;
        }

        const newImages = [...images, ...acceptedFiles];
        setImages(newImages);
        onImagesChange(newImages);
    }, [images, maxFiles, onImagesChange]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
        },
        maxSize: 5 * 1024 * 1024, // 5MB
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
        toast.info('Thumbnail updated');
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {images.map((item, index) => {
                        const url = getPreviewUrl(item);
                        return (
                            <div key={index} className="group relative aspect-video bg-neutral-100 rounded-lg overflow-hidden border">
                                <img
                                    src={url}
                                    alt={`Vehicle ${index + 1}`}
                                    className="w-full h-full object-cover"
                                />

                                {/* Actions Overlay */}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="icon"
                                        className="h-8 w-8 rounded-full bg-white/90 hover:bg-white text-red-600"
                                        onClick={() => removeImage(index)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                    {index !== 0 && (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="h-8 text-xs bg-white/90 hover:bg-white"
                                            onClick={() => setThumbnail(item)}
                                        >
                                            Set Main
                                        </Button>
                                    )}
                                </div>

                                {/* Thumbnail Badge */}
                                {index === 0 && (
                                    <div className="absolute top-2 left-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        MAIN
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
                        ${isDragActive ? 'border-orange-500 bg-orange-50' : 'border-neutral-200 hover:border-orange-500 hover:bg-neutral-50'}
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
                        <p className="text-xs">
                            SVG, PNG, JPG or GIF (max. 5MB)
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
