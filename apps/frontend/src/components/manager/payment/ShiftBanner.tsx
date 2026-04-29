import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { employeePaymentService } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Open Shift Modal ──────────────────────────────────────────────────────────

function OpenShiftModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { setActiveShift } = usePaymentStore();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const res = await employeePaymentService.openShift();
      setActiveShift(res.data);
      toast.success("Cash shift started.");
      onClose();
    } catch {
      toast.error("Failed to open shift. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Cash Shift</DialogTitle>
          <DialogDescription>
            This will open a new cash tracking session for your account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleOpen}
            disabled={loading}
          >
            {loading ? "Opening…" : "Start Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Close Shift Modal ─────────────────────────────────────────────────────────

function CloseShiftModal({
  open,
  shiftPublicId,
  expectedTotal,
  pendingTotal,
  onClose,
}: {
  open: boolean;
  shiftPublicId: string;
  expectedTotal?: string;
  pendingTotal?: string;
  onClose: () => void;
}) {
  const { setActiveShift, setActiveShiftLoaded } = usePaymentStore();
  const [actualTotal, setActualTotal] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);

  const actualNum = parseFloat(actualTotal) || 0;
  const expectedNum = parseFloat(expectedTotal ?? "0") || 0;
  const hasDiscrepancy = !!expectedTotal && Math.abs(actualNum - expectedNum) > 0.01;

  const handleClose = async () => {
    if (!actualTotal || isNaN(actualNum) || actualNum < 0) {
      toast.error("Please enter a valid actual total.");
      return;
    }
    if (hasDiscrepancy && (explanation || "").trim().length < 10) {
      toast.error("Explanation required when amounts don't match (min 10 chars).");
      return;
    }
    setLoading(true);
    try {
      const res = await employeePaymentService.closeShift(shiftPublicId, {
        actualTotal: actualNum,
        discrepancyExplanation: hasDiscrepancy ? explanation : undefined,
      });
      if (res.data.status === "DISCREPANCY_FLAGGED") {
        toast.warning("Shift closed with discrepancy — awaiting manager reconciliation.");
      } else {
        toast.success("Shift closed successfully.");
      }
      setActiveShift(null);
      setActiveShiftLoaded(false); // trigger re-fetch to get fresh server state
      onClose();
    } catch {
      toast.error("Failed to close shift. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close Cash Shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-neutral-50 rounded-lg px-4 py-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-neutral-500">Confirmed cash</span>
              <span className="font-semibold">₹ {expectedTotal ?? "0.00"}</span>
            </div>
            {pendingTotal && parseFloat(pendingTotal) > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Pending (awaiting manager)</span>
                <span className="font-semibold">₹ {parseFloat(pendingTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <p className="text-xs text-neutral-400 pt-0.5">
              Enter the total physical cash you are handing over.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="actualTotal">
              Actual cash counted <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input
                id="actualTotal"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="pl-8 h-12"
                value={actualTotal}
                onChange={(e) => setActualTotal(e.target.value)}
              />
            </div>
          </div>
          {hasDiscrepancy && (
            <div className="space-y-2">
              <Label htmlFor="explanation">
                Discrepancy explanation <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="explanation"
                placeholder="Explain the discrepancy (min 10 chars)…"
                rows={3}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="resize-none"
              />
              {(explanation || "").length > 0 && (explanation || "").length < 10 && (
                <p className="text-xs text-red-500">
                  Explanation required when amounts don't match (min 10 chars)
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleClose}
            disabled={loading}
          >
            {loading ? "Closing…" : "Close Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Shift Banner ──────────────────────────────────────────────────────────────

export function ShiftBanner() {
  const { activeShift, activeShiftLoaded, setActiveShift, setActiveShiftLoaded } =
    usePaymentStore();
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [closeShiftModal, setCloseShiftModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (activeShiftLoaded) return;
    employeePaymentService
      .getActiveShift()
      .then((shift) => {
        setActiveShift(shift);
        setActiveShiftLoaded(true);
      })
      .catch(() => setActiveShiftLoaded(true));
  }, [activeShiftLoaded, setActiveShift, setActiveShiftLoaded]);

  const handleOpenCloseModal = async () => {
    setRefreshing(true);
    try {
      const fresh = await employeePaymentService.getActiveShift();
      setActiveShift(fresh);
    } catch {
      // non-fatal — open modal with existing data
    } finally {
      setRefreshing(false);
      setCloseShiftModal(true);
    }
  };

  if (!activeShiftLoaded) return null;

  const isDiscrepancy = activeShift?.status === "DISCREPANCY_FLAGGED";

  return (
    <>
      <AnimatePresence mode="wait">
        {!activeShift ? (
          <motion.div
            key="no-shift"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-amber-50 border-b border-amber-200"
          >
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <span className="text-amber-500 text-base">⚠</span>
                <span>No active cash shift.</span>
              </div>
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs font-semibold"
                onClick={() => setOpenShiftModal(true)}
              >
                Open Shift
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="shift-open"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={
              isDiscrepancy
                ? "bg-red-50 border-b border-red-200"
                : "bg-green-50 border-b border-green-200"
            }
          >
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className={`text-base ${isDiscrepancy ? "text-red-500" : "text-green-500"}`}>
                  {isDiscrepancy ? "⚠" : "●"}
                </span>
                <span className={isDiscrepancy ? "text-red-800" : "text-green-800"}>
                  {isDiscrepancy
                    ? "Shift: Discrepancy Flagged"
                    : `Shift Open — Started at ${formatTime(activeShift.openedAt)}`}
                </span>
                {!isDiscrepancy && (
                  <>
                    {activeShift.pendingTotal && parseFloat(activeShift.pendingTotal) > 0 && (
                      <span className="text-amber-700 bg-amber-100 rounded px-2 py-0.5 text-xs font-medium">
                        Pending: ₹{parseFloat(activeShift.pendingTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                    {activeShift.expectedTotal && parseFloat(activeShift.expectedTotal) > 0 && (
                      <span className="text-green-700 bg-green-100 rounded px-2 py-0.5 text-xs font-medium">
                        Confirmed: ₹{parseFloat(activeShift.expectedTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </>
                )}
              </div>
              {!isDiscrepancy && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold border-green-300 text-green-700 hover:bg-green-100"
                  onClick={handleOpenCloseModal}
                  disabled={refreshing}
                >
                  {refreshing ? "Refreshing…" : "Close Shift"}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <OpenShiftModal
        open={openShiftModal}
        onClose={() => setOpenShiftModal(false)}
      />
      {activeShift && (
        <CloseShiftModal
          open={closeShiftModal}
          shiftPublicId={activeShift.publicId}
          expectedTotal={activeShift.expectedTotal}
          pendingTotal={activeShift.pendingTotal}
          onClose={() => setCloseShiftModal(false)}
        />
      )}
    </>
  );
}
