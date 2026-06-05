import { useState, useCallback } from "react";
import { Car, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface VehicleImageGalleryProps {
  images: string[] | { file: { url: string } }[];
  vehicleName: string;
}

const STUDIO_GRADIENT = [
  "radial-gradient(110% 46% at 50% 73%, rgba(232,235,237,.9) 0%, rgba(150,156,160,.3) 42%, rgba(11,12,15,0) 72%)",
  "radial-gradient(95% 72% at 52% 49%, #c6cbce 0%, #8b9095 30%, #44484d 55%, rgba(11,12,15,0) 82%)",
  "radial-gradient(140% 120% at 50% 40%, rgba(0,0,0,0) 50%, rgba(7,8,10,.92) 100%)",
  "linear-gradient(180deg,#0b0c0f 0%,#101217 52%,#090a0d 100%)",
].join(",");

export const VehicleImageGallery = ({
  images,
  vehicleName,
}: VehicleImageGalleryProps) => {
  const [current, setCurrent] = useState(0);

  const normalized: string[] = Array.isArray(images)
    ? images.map((img) => (typeof img === "string" ? img : img.file.url))
    : [];

  const prev = useCallback(
    () => setCurrent((i) => (i - 1 + normalized.length) % normalized.length),
    [normalized.length],
  );

  const next = useCallback(
    () => setCurrent((i) => (i + 1) % normalized.length),
    [normalized.length],
  );

  return (
    <div
      className="relative overflow-hidden rounded-[2rem] w-full h-full min-h-[420px] lg:min-h-[580px]"
      style={{ background: STUDIO_GRADIENT }}
    >
      {/* Vehicle image — centered, fills the section */}
      {normalized.length > 0 ? (
        <img
          key={current}
          src={normalized[current]}
          alt={`${vehicleName} - Image ${current + 1}`}
          className="absolute left-1/2 top-1/2 w-[90%] pointer-events-none select-none"
          style={{
            transform: "translate(-50%, -50%)",
            filter: "drop-shadow(0 30px 26px rgba(0,0,0,.55))",
            objectFit: "contain",
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Car className="size-24 text-zinc-600" />
        </div>
      )}

      {/* Top scrim */}
      <div
        className="absolute inset-x-0 top-0 h-48 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg,rgba(8,9,12,.85) 0%,rgba(8,9,12,.35) 50%,rgba(8,9,12,0) 100%)",
        }}
      />

      {/* Bottom scrim */}
      <div
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
        style={{
          background:
            "linear-gradient(0deg,rgba(8,9,12,.88) 0%,rgba(8,9,12,.4) 55%,rgba(8,9,12,0) 100%)",
        }}
      />

      {/* Prev / Next arrows */}
      {normalized.length > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 size-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center hover:bg-white/25 transition-all duration-200 hover:scale-110 active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            onClick={next}
            aria-label="Next image"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 size-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center hover:bg-white/25 transition-all duration-200 hover:scale-110 active:scale-95"
          >
            <ChevronRight className="size-5" />
          </button>

          {/* Dot indicators */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {normalized.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                aria-label={`Go to image ${i + 1}`}
                className={cn(
                  "rounded-full transition-all duration-200",
                  i === current
                    ? "w-4 h-1.5 bg-white"
                    : "w-1.5 h-1.5 bg-white/40 hover:bg-white/70",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
