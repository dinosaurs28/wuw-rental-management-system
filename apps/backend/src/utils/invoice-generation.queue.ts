import { Job } from "bullmq";
import { getInvoiceQueue } from "../lib/queue.client.js";

export interface InvoiceJobData {
  bookingId: number;
  invoiceId: number;
  previousFileObjectId?: number;
}

/**
 * Queues a new invoice generation job.
 *
 * @param forceNew - When true (regeneration path), a timestamp-unique jobId is
 *   used so BullMQ always creates a fresh job regardless of any prior completed
 *   job with the same base ID. Without this, BullMQ returns the old completed
 *   job when the same jobId is re-added, silently skipping regeneration.
 */
export async function queueInvoiceGeneration(
  bookingId: number,
  invoiceId: number,
  forceNew = false,
  previousFileObjectId?: number,
) {
  const queue = getInvoiceQueue();

  // ── Forced regeneration: always create a brand-new job ───────────────────
  if (forceNew) {
    const jobId = `invoice-${invoiceId}-regen-${Date.now()}`;
    const job = await queue.add(
      "generate-invoice",
      { bookingId, invoiceId, previousFileObjectId } as InvoiceJobData,
      { jobId },
    );
    console.log(`[Queue] Force-queued regeneration job ${jobId} for booking ${bookingId}`);
    return job;
  }

  // ── Initial generation: deduplicate by fixed jobId ────────────────────────
  const jobId = `invoice-${invoiceId}`;

  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (["waiting", "active"].includes(state)) {
      console.log(`[Queue] Job already active/waiting for invoice ${invoiceId}`);
      return existingJob;
    }

    // Remove completed/failed job before re-queuing
    try {
      await existingJob.remove();
      console.log(`[Queue] Removed existing ${state} job for invoice ${invoiceId}`);
    } catch (error) {
      console.error(`[Queue] Failed to remove existing job:`, error);
    }
  }

  const job = await queue.add(
    "generate-invoice",
    { bookingId, invoiceId } as InvoiceJobData,
    { jobId },
  );

  console.log(`[Queue] Queued invoice generation job ${jobId} for booking ${bookingId}`);
  return job;
}

/**
 * Gets the status of an invoice generation job
 * @param invoiceId - Invoice ID
 * @returns Job status or null if not found
 */
export async function getInvoiceJobStatus(invoiceId: number) {
  const jobId = `invoice-${invoiceId}`;
  const queue = getInvoiceQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    jobId: job.id,
    state,
    progress: job.progress || 0,
    attemptsMade: job.attemptsMade,
    data: job.data,
  };
}
