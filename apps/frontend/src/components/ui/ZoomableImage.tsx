import { useRef, useState, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;

export function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTouchDistRef = useRef<number | null>(null);

  scaleRef.current = scale;
  translateRef.current = translate;

  // Non-passive wheel listener so preventDefault works in all browsers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setScale((prev) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, +(prev + delta).toFixed(2)));
        if (next <= MIN_SCALE) setTranslate({ x: 0, y: 0 });
        return next;
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scaleRef.current <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: translateRef.current.x,
      ty: translateRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStartRef.current) return;
    setTranslate({
      x: dragStartRef.current.tx + e.clientX - dragStartRef.current.x,
      y: dragStartRef.current.ty + e.clientY - dragStartRef.current.y,
    });
  }, []);

  const stopDrag = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      lastTouchDistRef.current = Math.hypot(dx, dy);
      dragStartRef.current = null;
    } else if (e.touches.length === 1 && scaleRef.current > 1) {
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: translateRef.current.x,
        ty: translateRef.current.y,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / lastTouchDistRef.current;
      lastTouchDistRef.current = dist;
      setScale((prev) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * ratio));
        if (next <= MIN_SCALE) setTranslate({ x: 0, y: 0 });
        return next;
      });
    } else if (e.touches.length === 1 && dragStartRef.current) {
      setTranslate({
        x: dragStartRef.current.tx + e.touches[0].clientX - dragStartRef.current.x,
        y: dragStartRef.current.ty + e.touches[0].clientY - dragStartRef.current.y,
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) lastTouchDistRef.current = null;
    if (e.touches.length === 0) {
      dragStartRef.current = null;
      setIsDragging(false);
    }
    if (scaleRef.current <= MIN_SCALE) setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomIn = () =>
    setScale((prev) => Math.min(MAX_SCALE, +(prev + ZOOM_STEP).toFixed(2)));

  const zoomOut = () =>
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, +(prev - ZOOM_STEP).toFixed(2));
      if (next <= MIN_SCALE) setTranslate({ x: 0, y: 0 });
      return next;
    });

  const reset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={zoomOut}
          disabled={scale <= MIN_SCALE}
          className="h-8 w-8 p-0 rounded-full"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs font-semibold text-zinc-500 w-14 text-center tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={zoomIn}
          disabled={scale >= MAX_SCALE}
          className="h-8 w-8 p-0 rounded-full"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        {scale !== 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={reset}
            className="h-8 px-3 rounded-full text-xs gap-1"
            aria-label="Reset zoom"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Image canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg bg-zinc-100 flex items-center justify-center select-none"
        style={{
          maxHeight: "65vh",
          minHeight: "200px",
          cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
          touchAction: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-[65vh] object-contain pointer-events-none"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.15s ease-out",
            willChange: "transform",
          }}
        />
        {scale > 1 && !isDragging && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-medium text-white bg-black/50 px-3 py-1 rounded-full pointer-events-none backdrop-blur-sm whitespace-nowrap">
            Drag to pan
          </div>
        )}
      </div>

      {scale === 1 && (
        <p className="text-center text-[11px] text-zinc-400 font-medium">
          Scroll or pinch to zoom · Use buttons to zoom
        </p>
      )}
    </div>
  );
}
