import { useState, useEffect } from "react";
import { QrReader } from "react-qr-reader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, AlertCircle, Loader2 } from "lucide-react";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string | null) => void;
}

export function QrScannerModal({
  isOpen,
  onClose,
  onScan,
}: QrScannerModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );

  const handleScan = (result: any) => {
    if (result) {
      onScan(result?.text);
      onClose(); // Auto close on successful scan
    }
  };

  const handleClose = () => {
    setError(null);
    setIsLoading(true);
    setFacingMode("environment");
    onClose();
  };

  // Auto-hide loading after 2 seconds (camera should be ready by then)
  useEffect(() => {
    if (isOpen && isLoading) {
      const timer = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isLoading]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Booking QR Code
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center space-y-4 py-4">
          <div className="relative w-full aspect-square overflow-hidden rounded-lg bg-black">
            {isOpen && (
              <>
                <QrReader
                  key={`${isOpen}-${facingMode}`}
                  onResult={handleScan}
                  constraints={{
                    facingMode: facingMode,
                  }}
                  videoId="qr-video"
                  scanDelay={300}
                  ViewFinder={() => (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                      <div className="h-48 w-48 border-2 border-white/50 rounded-lg">
                        <div className="absolute top-0 left-0 h-4 w-4 border-t-4 border-l-4 border-green-500 rounded-tl"></div>
                        <div className="absolute top-0 right-0 h-4 w-4 border-t-4 border-r-4 border-green-500 rounded-tr"></div>
                        <div className="absolute bottom-0 left-0 h-4 w-4 border-b-4 border-l-4 border-green-500 rounded-bl"></div>
                        <div className="absolute bottom-0 right-0 h-4 w-4 border-b-4 border-r-4 border-green-500 rounded-br"></div>
                      </div>
                    </div>
                  )}
                />

                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                    <div className="flex flex-col items-center gap-2 text-white">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm">Loading camera...</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                <div className="flex flex-col items-center gap-3 text-white p-4 text-center">
                  <AlertCircle className="h-10 w-10 text-red-400" />
                  <div>
                    <p className="font-medium mb-1">Camera Error</p>
                    <p className="text-sm text-gray-300">{error}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setIsLoading(true);
                      setFacingMode(
                        facingMode === "environment" ? "user" : "environment",
                      );
                    }}
                  >
                    Try {facingMode === "environment" ? "Front" : "Back"} Camera
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                setFacingMode(
                  facingMode === "environment" ? "user" : "environment",
                );
              }}
              className="flex-1"
            >
              Switch Camera
            </Button>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Align the QR code within the frame to scan.
          </p>
          <Button variant="outline" onClick={handleClose} className="w-full">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
