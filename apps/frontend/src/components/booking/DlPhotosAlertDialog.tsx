import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KycSide } from "@/services/kyc.service";

export const DL_PHOTOS_ALERT_MESSAGE =
  "Original DL and Safety Deposit will be collected during the vehicle pickup";

type DocLike = { type: string; side: KycSide | string };

/**
 * True only on the transition: uploading `side` of a DL completes the
 * FRONT + BACK pair that was not complete before (`before` = the documents
 * prior to the upload).
 */
export function dlPairCompletedByUpload(before: DocLike[], type: string, side: KycSide): boolean {
  if (type !== "DL") return false;
  const sides = new Set(before.filter((d) => d.type === "DL").map((d) => d.side));
  if (sides.has("FRONT") && sides.has("BACK")) return false;
  sides.add(side);
  return sides.has("FRONT") && sides.has("BACK");
}

interface DlPhotosAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Shown once a customer's DL photos (both sides) are uploaded. */
export function DlPhotosAlertDialog({ open, onOpenChange }: DlPhotosAlertDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-white text-center">
        <DialogHeader className="items-center sm:text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
            <ShieldCheck className="h-7 w-7 text-[#FF5F00]" />
          </div>
          <DialogTitle>Licence photos received</DialogTitle>
          <DialogDescription className="text-sm text-gray-700">
            {DL_PHOTOS_ALERT_MESSAGE}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button
            className="w-full bg-[#FF5F00] hover:bg-[#e65600]"
            onClick={() => onOpenChange(false)}
          >
            Ok, Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
