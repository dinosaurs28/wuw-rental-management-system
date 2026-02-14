import { Job } from 'bullmq';
import { getInvoiceQueue } from '../lib/queue.client.js';

interface InvoiceJobData {
    bookingId: number;
    invoiceId: number;
}

/**
 * Queues a new invoice generation job
 * @param bookingId - Booking ID
 * @param invoiceId - Invoice ID
 * @returns The queued job
 */
export async function queueInvoiceGeneration(bookingId: number, invoiceId: number) {
    const jobId = `invoice-${invoiceId}`;
    const queue = getInvoiceQueue();

    // Check if job already exists
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
        const state = await existingJob.getState();
        if (['waiting', 'active'].includes(state)) {
            console.log(`[Queue] Job already exists and is active/waiting for invoice ${invoiceId}`);
            return existingJob;
        }

        // If job exists but is failed or completed, remove it so we can retry
        try {
            await existingJob.remove();
            console.log(`[Queue] Removed existing ${state} job for invoice ${invoiceId}`);
        } catch (error) {
            console.error(`[Queue] Failed to remove existing job:`, error);
        }
    }

    // Queue new job with unique jobId to prevent duplicates
    const job = await queue.add(
        'generate-invoice',
        { bookingId, invoiceId } as InvoiceJobData,
        { jobId } // Prevents duplicate jobs
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
