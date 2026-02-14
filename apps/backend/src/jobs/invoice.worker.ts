import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { prisma } from "@repo/database/client";
import { generateInvoiceNumber } from "../services/invoice-number-generator.js";
import { transformBookingToInvoiceData } from "../services/invoice-data-transformer.js";
import { generateInvoicePDF } from "../services/invoice-pdf-generator.js";
import { uploadInvoicePDFToR2 } from "../services/r2-upload.js";

// Lazy initialization to ensure environment variables are loaded first
let connection: Redis | null = null;

function getConnection(): Redis {
    if (!connection) {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            throw new Error("REDIS_URL environment variable is required");
        }

        connection = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            connectTimeout: 30000,
            enableOfflineQueue: false,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            tls: redisUrl.startsWith('rediss://') ? {
                rejectUnauthorized: true,
            } : undefined,
        });
    }
    return connection;
}

let invoiceWorker: Worker | null = null;

interface InvoiceJobData {
    bookingId: number;
    invoiceId: number;
}

export function initInvoiceWorker(): void {
    if (invoiceWorker) return; // Already initialized

    invoiceWorker = new Worker("{bull}invoice-generation", async (job: Job<InvoiceJobData>) => {
        const { bookingId, invoiceId } = job.data;

        try {
            console.log(`[Invoice Worker] Processing invoice ${invoiceId} for booking ${bookingId}`);
            await job.updateProgress(10);

            // Step 1: Generate or fetch invoice number
            let invoice = await prisma.invoice.findUnique({
                where: { id: invoiceId },
            });

            if (!invoice) {
                throw new Error(`Invoice ${invoiceId} not found`);
            }

            let invoiceNumber = invoice.invoiceNumber;
            if (!invoiceNumber) {
                invoiceNumber = await generateInvoiceNumber(bookingId);
                await prisma.invoice.update({
                    where: { id: invoiceId },
                    data: { invoiceNumber },
                });
                console.log(`[Invoice Worker] Generated invoice number: ${invoiceNumber}`);
            }

            await job.updateProgress(20);

            // Step 2: Transform booking data
            console.log(`[Invoice Worker] Transforming booking data for invoice ${invoiceNumber}`);
            const invoiceData = await transformBookingToInvoiceData(bookingId);
            await job.updateProgress(40);

            // Step 3: Generate PDF
            console.log(`[Invoice Worker] Generating PDF for invoice ${invoiceNumber}`);
            const pdfBuffer = await generateInvoicePDF(invoiceData);
            await job.updateProgress(60);

            // Step 4: Upload to R2
            console.log(`[Invoice Worker] Uploading PDF to R2 for invoice ${invoiceNumber}`);
            const uploadResult = await uploadInvoicePDFToR2(
                pdfBuffer,
                invoiceNumber,
                bookingId
            );
            await job.updateProgress(80);

            // Step 5: Update database with PDF file reference
            await prisma.invoice.update({
                where: { id: invoiceId },
                data: {
                    invoicePdfFileId: uploadResult.fileId,
                    generatedAt: new Date(),
                },
            });

            await job.updateProgress(100);
            console.log(`[Invoice Worker] ✅ Invoice ${invoiceNumber} (ID: ${invoiceId}) completed successfully`);

            return {
                success: true,
                invoiceId,
                invoiceNumber,
                fileId: uploadResult.fileId,
                pdfUrl: uploadResult.url,
            };

        } catch (error) {
            console.error('================================================================');
            console.error(`[Invoice Worker] ❌ CRITICAL FAILURE for Invoice ${invoiceId}`);
            console.error('[Invoice Worker] Error Message:', error instanceof Error ? error.message : error);
            if (error instanceof Error && error.stack) {
                console.error('[Invoice Worker] Stack Trace:', error.stack);
            }
            console.error('================================================================');
            throw error;
        }
    }, {
        connection: getConnection(),
        concurrency: 5, // Process up to 5 invoices concurrently
    });

    invoiceWorker.on('completed', (job) => {
        console.log(`[Invoice Worker] ✅ Job ${job.id} completed successfully`);
    });

    invoiceWorker.on('failed', (job, err) => {
        console.error(`[Invoice Worker] ❌ Job ${job?.id} failed:`, err.message);
    });

    console.log('[Invoice Worker] Invoice worker initialized');
}
