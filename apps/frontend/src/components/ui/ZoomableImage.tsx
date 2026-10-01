import { useRef, useState, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Extra classes for the image canvas (e.g. a taller viewport in a lightbox). */
  canvasClassName?: string;
  /** Max height of the image area (CSS value). Defaults to 65vh. */
  maxHeight?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;

export function ZoomableImage({ src, alt, className, canvasClassName, maxHeight = "65vh" }: ZoomableImageProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTouchDistRef = useRef<number | null>(null);

  scaleRef.current = scale;
  translateRef.current = translate;

  // Keep the image from being dragged out of view: limit pan to the overflow at this scale.
  const clamp = useCallback((x: number, y: number, s: number) => {
    const c = containerRef.current;
    const i = imgRef.current;
    if (!c || !i || s <= 1) return { x: 0, y: 0 };
    const maxX = Math.max(0, (i.offsetWidth * s - c.clientWidth) / 2);
    const maxY = Math.max(0, (i.offsetHeight * s - c.clientHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  // Non-passive wheel listener so preventDefault works in all browsers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      // At 1x only intercept zoom-in / pinch gestures so page scroll is not trapped.
      if (scaleRef.current <= 1 && e.deltaY >= 0 && !e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setScale((prev) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, +(prev + delta).toFixed(2)));
        setTranslate((t) => clamp(t.x, t.y, next));
        return next;
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [clamp]);

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
    setTranslate(
      clamp(
        dragStartRef.current.tx + e.clientX - dragStartRef.current.x,
        dragStartRef.current.ty + e.clientY - dragStartRef.current.y,
        scaleRef.current,
      ),
    );
  }, [clamp]);

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
        setTranslate((t) => clamp(t.x, t.y, next));
        return next;
      });
    } else if (e.touches.length === 1 && dragStartRef.current) {
      setTranslate(
        clamp(
          dragStartRef.current.tx + e.touches[0].clientX - dragStartRef.current.x,
          dragStartRef.current.ty + e.touches[0].clientY - dragStartRef.current.y,
          scaleRef.current,
        ),
      );
    }
  }, [clamp]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) lastTouchDistRef.current = null;
    if (e.touches.length === 0) {
      dragStartRef.current = null;
      setIsDragging(false);
    }
    if (scaleRef.current <= MIN_SCALE) setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomIn = () =>
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, +(prev + ZOOM_STEP).toFixed(2));
      setTranslate((t) => clamp(t.x, t.y, next));
      return next;
    });

  // Double click / double tap toggles between fit and 2.5x
  const toggleZoom = () => {
    if (scaleRef.current > 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  const zoomOut = () =>
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, +(prev - ZOOM_STEP).toFixed(2));
      setTranslate((t) => clamp(t.x, t.y, next));
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
        className={cn(
          "relative overflow-hidden rounded-lg bg-zinc-100 flex items-center justify-center select-none",
          canvasClassName,
        )}
        style={{
          maxHeight,
          minHeight: "200px",
          cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
          touchAction: "none",
        }}
        onDoubleClick={toggleZoom}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className="max-w-full object-contain pointer-events-none"
          style={{
            maxHeight,
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
          Scroll or pinch to zoom · Double-click to zoom · Use buttons to zoom
        </p>
      )}
    </div>
  );
}
