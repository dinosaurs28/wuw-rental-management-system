import { useState, useCallback, useEffect } from 'react';
import { Car, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    type CarouselApi,
} from '@/components/ui/carousel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VehicleImageGalleryProps {
    images: string[];
    vehicleName: string;
}

export const VehicleImageGallery = ({ images, vehicleName }: VehicleImageGalleryProps) => {
    const [api, setApi] = useState<CarouselApi>();
    const [current, setCurrent] = useState(0);
    const [canScrollPrev, setCanScrollPrev] = useState(false);
    const [canScrollNext, setCanScrollNext] = useState(false);

    useEffect(() => {
        if (!api) return;

        const onSelect = () => {
            setCurrent(api.selectedScrollSnap());
            setCanScrollPrev(api.canScrollPrev());
            setCanScrollNext(api.canScrollNext());
        };

        onSelect();
        api.on('select', onSelect);
        api.on('reInit', onSelect);

        return () => {
            api.off('select', onSelect);
        };
    }, [api]);

    const scrollTo = useCallback(
        (index: number) => {
            api?.scrollTo(index);
        },
        [api]
    );

    const scrollPrev = useCallback(() => {
        api?.scrollPrev();
    }, [api]);

    const scrollNext = useCallback(() => {
        api?.scrollNext();
    }, [api]);

    if (!images || images.length === 0) {
        return (
            <div className="w-full aspect-[4/3] bg-zinc-100 rounded-xl flex items-center justify-center">
                <Car className="size-20 text-zinc-300" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Main Image Carousel */}
            <div className="relative group">
                <Carousel
                    setApi={setApi}
                    className="w-full"
                    opts={{
                        loop: true,
                    }}
                >
                    <CarouselContent>
                        {images.map((image, index) => (
                            <CarouselItem key={index}>
                                <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-zinc-100">
                                    <img
                                        src={image}
                                        alt={`${vehicleName} - Image ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                </Carousel>

                {/* Navigation Arrows */}
                {images.length > 1 && (
                    <>
                        <Button
                            variant="secondary"
                            size="icon"
                            className={cn(
                                "absolute left-3 top-1/2 -translate-y-1/2 z-10",
                                "size-10 rounded-full bg-white/90 hover:bg-white shadow-lg",
                                "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                                !canScrollPrev && "opacity-50 cursor-not-allowed"
                            )}
                            onClick={scrollPrev}
                            disabled={!canScrollPrev}
                        >
                            <ChevronLeft className="size-5 text-zinc-700" />
                            <span className="sr-only">Previous image</span>
                        </Button>
                        <Button
                            variant="secondary"
                            size="icon"
                            className={cn(
                                "absolute right-3 top-1/2 -translate-y-1/2 z-10",
                                "size-10 rounded-full bg-white/90 hover:bg-white shadow-lg",
                                "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                                !canScrollNext && "opacity-50 cursor-not-allowed"
                            )}
                            onClick={scrollNext}
                            disabled={!canScrollNext}
                        >
                            <ChevronRight className="size-5 text-zinc-700" />
                            <span className="sr-only">Next image</span>
                        </Button>
                    </>
                )}
            </div>

            {/* Thumbnail Strip */}
            {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-300">
                    {images.map((image, index) => (
                        <button
                            key={index}
                            onClick={() => scrollTo(index)}
                            className={cn(
                                "flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-lg overflow-hidden border-2 transition-all duration-200",
                                current === index
                                    ? "border-orange-500 ring-2 ring-orange-500/30"
                                    : "border-zinc-200 hover:border-zinc-400"
                            )}
                        >
                            <img
                                src={image}
                                alt={`Thumbnail ${index + 1}`}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
