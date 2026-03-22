import { prisma } from "@repo/database/client";
import { fraudDetectionService } from "../services/payment/index.js";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runDelayedCashCheck(): Promise<void> {
  try {
    const branches = await prisma.branch.findMany({ select: { id: true } });
    for (const branch of branches) {
      await fraudDetectionService.checkDelayedCash(branch.id);
    }
  } catch (error) {
    console.error("[DelayedCashAlert] Error during check:", error);
  }
}

export function initDelayedCashAlertWorker(): void {
  if (intervalHandle) return;

  console.log("[DelayedCashAlert] Worker initialized — running every hour");
  // Run immediately on startup, then on schedule
  void runDelayedCashCheck();
  intervalHandle = setInterval(() => void runDelayedCashCheck(), INTERVAL_MS);
}
