import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpenShiftModal } from "@/components/manager/payment/ShiftBanner";
import { SHIFT_REQUIRED_MESSAGE } from "@/lib/counterErrors";
import { cn } from "@/lib/utils";
import { refreshActiveShift } from "./useActiveShift";

interface ShiftRequiredNoticeProps {
  /** Called after the shift is opened (or found already open). */
  onShiftOpened?: () => void;
  className?: string;
}

/**
 * Shown wherever staff are blocked for not having an open cash shift —
 * before a walk-in booking or when a collect call returns SHIFT_REQUIRED.
 */
export function ShiftRequiredNotice({ onShiftOpened, className }: ShiftRequiredNoticeProps) {
  const [open, setOpen] = useState(false);

  // The store can be stale (e.g. a shift opened on the mobile app), so
  // re-check once — if a shift is open the parent stops rendering this.
  useEffect(() => {
    void refreshActiveShift();
  }, []);

  return (
    <>
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5",
          className,
        )}
      >
        <div className="flex items-start gap-2 text-sm text-amber-800 flex-1">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <span>{SHIFT_REQUIRED_MESSAGE}</span>
        </div>
        <Button
          type="button"
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs font-semibold shrink-0"
          onClick={() => setOpen(true)}
        >
          Open shift
        </Button>
      </div>
      <OpenShiftModal
        open={open}
        onClose={() => setOpen(false)}
        onOpened={onShiftOpened}
      />
    </>
  );
}
