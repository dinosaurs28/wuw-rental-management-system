import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { History } from "lucide-react";
import { employeePaymentService, type CashShift } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";
import { refreshActiveShift, useActiveShift } from "@/components/employee/counter/useActiveShift";
import { apiErrorMessage } from "@/lib/counterErrors";
import { ShiftMoneyBreakdown, type ShiftFigures } from "@/components/manager/payment/ShiftDetailSheet";
import {
  VARIANCE_TONE_CLASSES,
  describeVariance,
  formatMoney,
  sanitizeRupeeInput,
  toPaise,
} from "@/components/manager/payment/cashShiftFormat";
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

export function OpenShiftModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the shift is open (including one found already open). */
  onOpened?: () => void;
}) {
  const { setActiveShift, setActiveShiftLoaded } = usePaymentStore();
  const [loading, setLoading] = useState(false);
  // Float counted into the drawer at the start; required, 0 allowed.
  const [openingCash, setOpeningCash] = useState("0");

  useEffect(() => {
    if (open) setOpeningCash("0");
  }, [open]);

  const openingNum = Number(openingCash);
  const openingError =
    openingCash.trim() === "" || !Number.isFinite(openingNum)
      ? "Enter the cash in the drawer (₹0 if it is empty)."
      : openingNum < 0
        ? "Opening cash cannot be negative."
        : openingNum > 1_000_000
          ? "Opening cash cannot exceed ₹10,00,000."
          : null;

  const handleOpen = async () => {
    if (openingError) {
      toast.error(openingError);
      return;
    }
    setLoading(true);
    try {
      const res = await employeePaymentService.openShift(toPaise(openingNum) / 100);
      setActiveShift(res.data);
      setActiveShiftLoaded(true);
      // The open response is minimal — fetch the live figures for the banner.
      void refreshActiveShift();
      toast.success(`Cash shift started with ${formatMoney(res.data.openingCash ?? openingNum)} opening cash.`);
      onClose();
      onOpened?.();
    } catch (err) {
      // 409 = a shift is already open (another tab or the mobile app) — adopt it.
      const existing =
        (err as { response?: { status?: number } })?.response?.status === 409
          ? await employeePaymentService.getActiveShift().catch(() => null)
          : null;
      if (existing) {
        setActiveShift(existing);
        setActiveShiftLoaded(true);
        toast.success("Your cash shift is already open.");
        onClose();
        onOpened?.();
      } else {
        toast.error(apiErrorMessage(err, "Failed to open shift. Please try again."));
      }
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
        <form
          id="open-shift-form"
          className="space-y-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleOpen();
          }}
        >
          <Label htmlFor="openingCash">
            Opening cash in drawer <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
            <Input
              id="openingCash"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0.00"
              className="pl-8 h-12"
              value={openingCash}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const next = sanitizeRupeeInput(e.target.value);
                if (next !== null) setOpeningCash(next);
              }}
            />
          </div>
          {openingError ? (
            <p className="text-xs text-red-500">{openingError}</p>
          ) : (
            <p className="text-xs text-neutral-500">
              Count the cash already in the drawer before you start. Enter 0 if it is empty.
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="open-shift-form"
            className="bg-orange-500 hover:bg-orange-600 text-white"
            disabled={loading || !!openingError}
          >
            {loading ? "Opening…" : "Start Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Close Shift Modal ─────────────────────────────────────────────────────────

type ApiErrorBody = { response?: { data?: Record<string, unknown> } };

const moneyField = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function CloseShiftModal({
  open,
  shift,
  onClose,
}: {
  open: boolean;
  shift: CashShift;
  onClose: () => void;
}) {
  const { setActiveShift, setActiveShiftLoaded } = usePaymentStore();
  const [actualTotal, setActualTotal] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  // Set when the server refused the close because money moved after this opened.
  const [serverFigures, setServerFigures] = useState<ShiftFigures | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActualTotal("");
      setExplanation("");
      setServerFigures(null);
      setServerMessage(null);
    }
  }, [open]);

  // Opening + collected − refunded = expected in drawer. Older servers only send expectedTotal.
  const figures: ShiftFigures = {
    ...shift,
    expectedClosing: shift.expectedClosing ?? shift.expectedTotal,
    ...(serverFigures ?? {}),
  };
  const expected = figures.expectedClosing;
  const actualNum = Number(actualTotal);
  const counted = actualTotal.trim() !== "" && Number.isFinite(actualNum);
  const diffPaise = counted && expected !== undefined ? toPaise(actualNum) - toPaise(expected) : 0;
  const hasDiscrepancy = diffPaise !== 0;
  const preview = counted && expected !== undefined ? describeVariance(diffPaise / 100) : null;

  const handleClose = async () => {
    if (!counted || actualNum < 0) {
      toast.error("Enter the cash you counted in the drawer.");
      return;
    }
    if (hasDiscrepancy && explanation.trim().length < 10) {
      toast.error("Explain the difference in at least 10 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await employeePaymentService.closeShift(shift.publicId, {
        actualTotal: toPaise(actualNum) / 100,
        discrepancyExplanation: hasDiscrepancy ? explanation.trim() : undefined,
      });
      if (res.data.status === "DISCREPANCY_FLAGGED") {
        toast.warning("Shift closed with discrepancy — awaiting manager reconciliation.");
      } else {
        toast.success("Shift closed successfully.");
      }
      setActiveShift(null);
      setActiveShiftLoaded(false); // trigger re-fetch to get fresh server state
      onClose();
    } catch (err) {
      const data = (err as ApiErrorBody)?.response?.data;
      if (data?.code === "DISCREPANCY_EXPLANATION_REQUIRED") {
        // The server measured the drawer at close: show its numbers and ask for the note.
        const fromServer: ShiftFigures = {};
        for (const key of ["openingCash", "cashCollected", "cashRefunded"] as const) {
          const value = moneyField(data[key]);
          if (value !== undefined) fromServer[key] = value;
        }
        const serverExpected = moneyField(data.expectedClosing) ?? moneyField(data.expectedTotal);
        if (serverExpected !== undefined) fromServer.expectedClosing = serverExpected;
        setServerFigures(fromServer);
        setServerMessage(typeof data.message === "string" ? data.message : null);
        // Refresh the confirmed / pending split shown under cash collected.
        void refreshActiveShift();
      } else if (data?.code === "SHIFT_NOT_OPEN" || data?.code === "SHIFT_NOT_FOUND") {
        toast.error(apiErrorMessage(err, "This shift is no longer open."));
        setActiveShift(null);
        setActiveShiftLoaded(false);
        onClose();
      } else {
        toast.error(apiErrorMessage(err, "Failed to close shift. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close Cash Shift</DialogTitle>
          <DialogDescription>
            Count the physical cash in the drawer and enter it below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {serverMessage && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {serverMessage}
            </p>
          )}
          <ShiftMoneyBreakdown shift={figures} hideClosing />
          <div className="space-y-2">
            <Label htmlFor="actualTotal">
              Cash counted in drawer <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input
                id="actualTotal"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="pl-8 h-12"
                value={actualTotal}
                onChange={(e) => {
                  const next = sanitizeRupeeInput(e.target.value);
                  if (next !== null) setActualTotal(next);
                }}
              />
            </div>
            {preview && (
              <p className={`text-xs font-medium ${VARIANCE_TONE_CLASSES[preview.tone]}`}>
                {preview.tone === "even"
                  ? "Matches the expected cash in the drawer."
                  : `${preview.tone === "short" ? "Short" : "Over"} by ${formatMoney(Math.abs(diffPaise) / 100)} against ${formatMoney(expected)} expected.`}
              </p>
            )}
          </div>
          {hasDiscrepancy && (
            <div className="space-y-2">
              <Label htmlFor="explanation">
                Discrepancy explanation <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="explanation"
                placeholder="Explain the difference (at least 10 characters)…"
                rows={3}
                maxLength={1000}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="resize-none"
              />
              {explanation.length > 0 && explanation.trim().length < 10 && (
                <p className="text-xs text-red-500">
                  Explain the difference in at least 10 characters.
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

/** The Fleet Executive's own shift history (/employee/shifts). */
function MyShiftsLink({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/employee/shifts"
      aria-label="My shifts"
      title="My shifts"
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${className}`}
    >
      <History className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">My shifts</span>
    </Link>
  );
}

export function ShiftBanner() {
  const { activeShift, activeShiftLoaded } = useActiveShift();
  const { setActiveShift } = usePaymentStore();
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [closeShiftModal, setCloseShiftModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
              <div className="flex items-center gap-2">
                <MyShiftsLink className="text-amber-800 hover:bg-amber-100" />
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs font-semibold"
                  onClick={() => setOpenShiftModal(true)}
                >
                  Open Shift
                </Button>
              </div>
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
                    {(activeShift.expectedClosing ?? activeShift.expectedTotal) !== undefined && (
                      <span className="text-green-700 bg-green-100 rounded px-2 py-0.5 text-xs font-medium">
                        Expected in drawer: {formatMoney(activeShift.expectedClosing ?? activeShift.expectedTotal)}
                      </span>
                    )}
                    {toPaise(activeShift.pendingCash ?? activeShift.pendingTotal) > 0 && (
                      <span className="text-amber-700 bg-amber-100 rounded px-2 py-0.5 text-xs font-medium">
                        Pending confirmation: {formatMoney(activeShift.pendingCash ?? activeShift.pendingTotal)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <MyShiftsLink className="text-green-800 hover:bg-green-100" />
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
          shift={activeShift}
          onClose={() => setCloseShiftModal(false)}
        />
      )}
    </>
  );
}
