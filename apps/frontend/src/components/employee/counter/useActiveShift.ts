import { useEffect } from "react";
import { employeePaymentService } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";

let inflight: Promise<void> | null = null;

/**
 * Re-reads the signed-in staff member's OPEN cash shift into the payment
 * store. Concurrent callers share one request.
 */
export function refreshActiveShift(): Promise<void> {
  if (!inflight) {
    const { setActiveShift, setActiveShiftLoaded } = usePaymentStore.getState();
    inflight = employeePaymentService
      .getActiveShift()
      .then((shift) => setActiveShift(shift))
      .catch(() => {
        // non-fatal — keep whatever the store already has
      })
      .finally(() => {
        setActiveShiftLoaded(true);
        inflight = null;
      });
  }
  return inflight;
}

/**
 * The staff member's active cash shift, loaded once per session.
 * `needsShift` is only true once loading confirmed there is no open shift,
 * so callers never block on a request that is still in flight.
 */
export function useActiveShift() {
  const activeShift = usePaymentStore((s) => s.activeShift);
  const activeShiftLoaded = usePaymentStore((s) => s.activeShiftLoaded);

  useEffect(() => {
    if (!activeShiftLoaded) void refreshActiveShift();
  }, [activeShiftLoaded]);

  return {
    activeShift,
    activeShiftLoaded,
    needsShift: activeShiftLoaded && !activeShift,
  };
}
