import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface DamageSummaryProps {
  damageDetails: Record<string, any>;
}

export const DamageSummary: React.FC<DamageSummaryProps> = ({
  damageDetails,
}) => {
  const damages = (damageDetails?.damages as any[]) || [];
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  return (
    <Card className="h-full border-none shadow-none bg-transparent">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">Damage Summary</h2>
        <p className="text-sm text-gray-500">
          Review reported damages and manager notes.
        </p>
      </div>

      <div className="space-y-4">
        {damages.map((damage, index) => (
          <Card
            key={index}
            className="overflow-hidden border-l-4 border-l-orange-500"
          >
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                    <div className="bg-gray-800 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
                      {index + 1}
                    </div>
                    {damage.area || "Unknown Area"}
                  </h4>
                </div>
                <Badge
                  variant={
                    damage.severity === "Major" ? "destructive" : "secondary"
                  }
                  className="uppercase text-[10px]"
                >
                  {damage.severity || "Reported"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                <div className="md:col-span-2">
                  <p className="text-sm text-gray-600 leading-relaxed">
                    <span className="font-medium text-gray-700">
                      Description:{" "}
                    </span>
                    {damage.description || "No description provided."}
                  </p>
                </div>

                {damage.photos && damage.photos.length > 0 && (
                  <div className="md:col-span-1 flex gap-1 overflow-x-auto pb-1">
                    {damage.photos.map((photo: any, pIdx: number) => (
                      <div
                        key={pIdx}
                        className="w-16 h-16 flex-shrink-0 rounded overflow-hidden border bg-gray-50 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setSelectedImage(photo.url)}
                      >
                        <img
                          src={photo.url}
                          alt="Damage"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {damages.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg border border-dashed text-gray-500">
            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
            <p>No specific damages listed in the report.</p>
          </div>
        )}
      </div>

      <Dialog
        open={!!selectedImage}
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-4xl p-0 bg-transparent border-none shadow-none flex justify-center items-center">
          {selectedImage && (
            <img
              src={selectedImage}
              alt="Full view"
              className="max-h-[90vh] w-auto max-w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
