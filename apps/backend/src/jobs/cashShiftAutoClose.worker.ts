import { cashShiftService } from "../services/payment/cash-shift.service.js";
import { autoCloseCutoff, parseAutoCloseTime } from "../services/payment/cash-shift-rules.js";

/*
 * Cash shift auto-close (Nov 2026 — client: "automatic shift closing is not
 * happening"; until now nothing closed a shift but a person). Every few
 * minutes, every OPEN shift opened before the most recent end-of-day instant
 * (CASH_SHIFT_AUTO_CLOSE_TIME, "HH:mm" in IST, default 00:00 = midnight IST,
 * whatever the server's own timezone) is closed by cashShiftService.autoClose:
 * a cash-free shift closes for good; a shift with cash stops collecting and
 * waits for the branch manager's Verify & close (rules: autoClosePlan in
 * cash-shift-rules.ts). Polling rather than one timer at midnight, so a
 * restart or downtime over the cutoff still closes them on the next tick.
 *
 * CASH_SHIFT_AUTO_CLOSE=false turns it off. Several processes may run it: the
 * close re-checks each shift under its row lock, so a shift closes once.
 */

const DEFAULT_INTERVAL_MIN = 5;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runCashShiftAutoClose(now = new Date()): Promise<{ closed: number; awaitingVerification: number; failed: number }> {
  const result = { closed: 0, awaitingVerification: 0, failed: 0 };
  if (running) return result;
  running = true;
  try {
    const cutoff = autoCloseCutoff(now, process.env.CASH_SHIFT_AUTO_CLOSE_TIME);
    const due = await cashShiftService.findDueForAutoClose(cutoff);
    for (const s of due) {
      try {
        const out = await cashShiftService.autoClose(s.id, cutoff);
        if (!out) continue;
        result.closed++;
        if (out.kind === "AWAITING_VERIFICATION") result.awaitingVerification++;
      } catch (err) {
        result.failed++;
        console.error(`[CashShiftAutoClose] Failed to close shift ${s.publicId}:`, err);
      }
    }
    if (result.closed > 0 || result.failed > 0) {
      console.log(
        `[CashShiftAutoClose] Closed ${result.closed} shift(s) opened before ${cutoff.toISOString()} ` +
          `(${result.awaitingVerification} awaiting the manager's verify & close); ${result.failed} failed.`,
      );
    }
  } catch (err) {
    console.error("[CashShiftAutoClose] Run failed:", err);
  } finally {
    running = false;
  }
  return result;
}

export function initCashShiftAutoCloseWorker(): void {
  if (intervalHandle) return;
  if ((process.env.CASH_SHIFT_AUTO_CLOSE ?? "").trim().toLowerCase() === "false") {
    console.log("[CashShiftAutoClose] Disabled (CASH_SHIFT_AUTO_CLOSE=false)");
    return;
  }
  const minutes = Number(process.env.CASH_SHIFT_AUTO_CLOSE_INTERVAL_MIN);
  const intervalMs = (Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_INTERVAL_MIN) * 60_000;
  const { label } = parseAutoCloseTime(process.env.CASH_SHIFT_AUTO_CLOSE_TIME);
  console.log(`[CashShiftAutoClose] Worker initialized — shifts close at ${label} IST, checked every ${intervalMs / 60_000} min`);
  void runCashShiftAutoClose();
  intervalHandle = setInterval(() => void runCashShiftAutoClose(), intervalMs);
}
