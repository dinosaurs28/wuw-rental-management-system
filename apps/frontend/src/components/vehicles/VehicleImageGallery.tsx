import { useState, useCallback, useEffect } from "react";
import { Car, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VehicleImageGalleryProps {
  images: string[] | { file: { url: string } }[];
  vehicleName: string;
}

export const VehicleImageGallery = ({
  images,
  vehicleName,
}: VehicleImageGalleryProps) => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Normalize images to string array
  const normalizedImages: string[] = Array.isArray(images)
    ? images.map((img) => (typeof img === "string" ? img : img.file.url))
    : [];

  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setCurrent(api.selectedScrollSnap());
      setCanScrollPrev(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    };

    onSelect();
    api.on("select", onSelect);
    api.on("reInit", onSelect);

    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  const scrollTo = useCallback(
    (index: number) => {
      api?.scrollTo(index);
    },
    [api],
  );

  const scrollPrev = useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = useCallback(() => {
    api?.scrollNext();
  }, [api]);

  if (!normalizedImages || normalizedImages.length === 0) {
    return (
      <div className="w-full aspect-[4/3] bg-zinc-100 border border-zinc-200 rounded-[2rem] flex items-center justify-center">
        <Car className="size-20 text-zinc-700" />
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
            {normalizedImages.map((image, index) => (
              <CarouselItem key={index}>
                <div className="aspect-[4/3] w-full overflow-hidden rounded-[2rem] bg-zinc-100 border border-zinc-200">
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
        {normalizedImages.length > 1 && (
          <>
            <Button
              variant="secondary"
              size="icon"
              className={cn(
                "absolute left-4 top-1/2 -translate-y-1/2 z-10",
                "size-12 rounded-full bg-white/90 backdrop-blur-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100 shadow-2xl",
                "opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110",
                !canScrollPrev && "opacity-50 cursor-not-allowed hidden",
              )}
              onClick={scrollPrev}
              disabled={!canScrollPrev}
            >
              <ChevronLeft className="size-6 text-zinc-700" />
              <span className="sr-only">Previous image</span>
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className={cn(
                "absolute right-4 top-1/2 -translate-y-1/2 z-10",
                "size-12 rounded-full bg-white/90 backdrop-blur-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100 shadow-2xl",
                "opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110",
                !canScrollNext && "opacity-50 cursor-not-allowed hidden",
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
      {normalizedImages.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent mt-4 px-1">
          {normalizedImages.map((image, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={cn(
                "flex-shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 transition-all duration-300",
                current === index
                  ? "border-orange-500 ring-4 ring-orange-500/10 scale-105"
                  : "border-transparent opacity-50 hover:opacity-100 hover:border-zinc-300 hover:scale-105",
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
