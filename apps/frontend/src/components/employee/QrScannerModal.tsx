
import { QrReader } from "react-qr-reader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

interface QrScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScan: (data: string | null) => void;
}

export function QrScannerModal({ isOpen, onClose, onScan }: QrScannerModalProps) {

    const handleScan = (result: any) => {
        if (result) {
            onScan(result?.text);
            onClose(); // Auto close on successful scan
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Camera className="h-5 w-5" />
                        Scan Booking QR Code
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center space-y-4 py-4">
                    <div className="relative h-64 w-full overflow-hidden rounded-lg bg-black">
                        {isOpen && (
                            <QrReader
                                key={isOpen ? "open" : "closed"}
                                onResult={handleScan}
                                className="w-full h-full"
                                videoContainerStyle={{ height: '100%', width: '100%', paddingTop: 0 }}
                                videoStyle={{ height: '100%', width: '100%', objectFit: 'cover' }}
                                constraints={{ facingMode: 'environment' }}
                                ViewFinder={() => (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="h-48 w-48 border-2 border-white/50 rounded-lg">
                                            <div className="absolute top-0 left-0 h-4 w-4 border-t-4 border-l-4 border-green-500 rounded-tl"></div>
                                            <div className="absolute top-0 right-0 h-4 w-4 border-t-4 border-r-4 border-green-500 rounded-tr"></div>
                                            <div className="absolute bottom-0 left-0 h-4 w-4 border-b-4 border-l-4 border-green-500 rounded-bl"></div>
                                            <div className="absolute bottom-0 right-0 h-4 w-4 border-b-4 border-r-4 border-green-500 rounded-br"></div>
                                        </div>
                                    </div>
                                )}
                            />
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                        Align the QR code within the frame to scan.
                    </p>
                    <Button variant="outline" onClick={onClose} className="w-full">
                        Cancel
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
