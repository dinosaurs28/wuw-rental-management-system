import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { Image as ImageIcon, Maximize2 } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface DamageEvidenceProps {
  images: { url: string; label?: string | null; mime?: string | null }[];
  damageDetails: Record<string, any>;
  vehicleType?: string;
  /** Shown as the photo caption, e.g. the vehicle reg no. */
  caption?: string;
}

export const DamageEvidence: React.FC<DamageEvidenceProps> = ({ images, caption }) => {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          Damage Evidence
          {images.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({images.length})</span>
          )}
        </CardTitle>
        {images.length > 0 && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setViewerIndex(0)}>
            <Maximize2 className="w-4 h-4" />
            View All Images
          </Button>
        )}
        <PhotoLightbox
          open={viewerIndex !== null}
          onOpenChange={(o) => !o && setViewerIndex(null)}
          items={images.map((img, idx) => ({
            url: img.url,
            mime: img.mime,
            label: [caption, img.label ?? `Damage photo ${idx + 1}`].filter(Boolean).join(" · "),
          }))}
          startIndex={viewerIndex ?? 0}
          title="Damage Evidence"
        />
      </CardHeader>
      <CardContent className="flex-1">
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {images.map((img, idx) => (
              <button
                type="button"
                key={idx}
                className="relative group cursor-zoom-in overflow-hidden rounded-md border bg-muted text-left"
                onClick={() => setViewerIndex(idx)}
                aria-label={`Zoom damage photo ${idx + 1}`}
              >
                <AspectRatio ratio={4 / 3}>
                  <img
                    src={img.url}
                    alt={`Preview ${idx + 1}`}
                    className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <ZoomBadge />
                </AspectRatio>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 bg-muted/30 rounded-lg border-2 border-dashed border-muted text-muted-foreground gap-2">
            <ImageIcon className="w-8 h-8 opacity-50" />
            <span className="text-sm">No evidence photos provided</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
