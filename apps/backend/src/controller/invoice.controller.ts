import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import {
  queueInvoiceGeneration,
  getInvoiceJobStatus,
} from "../utils/invoice-generation.queue.js";
import { finalizeInvoice } from "../services/invoice-finalization.service.js";
import { generatePresignedUrl } from "../services/r2-upload.js";

/**
 * MAIN ENDPOINT: Download Invoice
 * POST /api/invoices/download
 * @body bookingId - The booking ID to download invoice for
 */
export async function downloadInvoice(req: Request, res: Response) {
  try {
    const { bookingId } = req.body;
    const userPublicId = req.public_Id; // Set by authCheckJwt middleware

    // Validate authentication
    if (!userPublicId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Please login",
      });
    }

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "bookingId is required",
      });
    }

    // Fetch user to get customer ID
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: {
        customerProfile: {
          select: { id: true },
        },
      },
    });

    if (!user?.customerProfile) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found",
      });
    }

    const customerId = user.customerProfile.id;

    // Fetch booking with invoice
    const booking = await prisma.booking.findUnique({
      where: { id: parseInt(bookingId) },
      include: {
        invoice: {
          include: {
            invoicePdfFile: true, // Check if PDF exists
          },
        },
      },
    });

    // Validations
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Security check: User must own this booking
    if (booking.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (!booking.invoice) {
      return res.status(400).json({
        success: false,
        message: "Invoice not created for this booking",
      });
    }

    // ✅ CASE 1: PDF already exists (FAST PATH - Cached)
    if (booking.invoice.invoicePdfFile?.key) {
      console.log(
        `[Invoice Controller] Cache HIT - Invoice ${booking.invoice.id}`,
      );

      const pdfUrl = await generatePresignedUrl(booking.invoice.invoicePdfFile.key);

      return res.status(200).json({
        success: true,
        cached: true,
        pdfUrl,
        invoiceNumber: booking.invoice.invoiceNumber,
        generatedAt: booking.invoice.generatedAt,
      });
    }

    // ✅ CASE 2: Check if generation is already in progress
    const jobStatus = await getInvoiceJobStatus(booking.invoice.id);

    if (jobStatus && ["waiting", "active"].includes(jobStatus.state)) {
      console.log(
        `[Invoice Controller] Generation in progress - Invoice ${booking.invoice.id}`,
      );

      return res.status(202).json({
        success: true,
        generating: true,
        inProgress: true,
        jobId: jobStatus.jobId,
        state: jobStatus.state,
        progress: jobStatus.progress || 0,
        invoiceId: booking.invoice.id,
        statusUrl: `/invoices/status/${booking.invoice.id}`,
        message: "Invoice generation in progress. Please wait 1-2 minutes...",
      });
    }

    // ✅ CASE 3: PDF doesn't exist and no job in progress - Queue generation
    console.log(
      `[Invoice Controller] Queuing generation - Invoice ${booking.invoice.id}`,
    );

    const job = await queueInvoiceGeneration(booking.id, booking.invoice.id);

    return res.status(202).json({
      success: true,
      generating: true,
      jobId: job.id,
      invoiceId: booking.invoice.id,
      statusUrl: `/invoices/status/${booking.invoice.id}`,
      message: "Generating invoice PDF. Please wait 1-2 minutes...",
      estimatedTime: "1-2 minutes",
    });
  } catch (error) {
    console.error("[Invoice Controller] Error in downloadInvoice:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process invoice download",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Check Invoice Generation Status
 * GET /api/invoices/status/:invoiceId
 */
export async function getInvoiceStatus(req: Request, res: Response) {
  try {
    const { invoiceId } = req.params;
    const userPublicId = req.public_Id; // Set by authCheckJwt middleware

    // Validate authentication
    if (!userPublicId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Please login",
      });
    }

    if (!invoiceId || isNaN(parseInt(invoiceId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoiceId parameter",
      });
    }

    // Fetch user to get customer ID
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: {
        customerProfile: {
          select: { id: true },
        },
      },
    });

    if (!user?.customerProfile) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found",
      });
    }

    const customerId = user.customerProfile.id;

    // Fetch invoice with PDF file
    const invoice = await prisma.invoice.findUnique({
      where: { id: parseInt(invoiceId) },
      include: {
        invoicePdfFile: true,
        booking: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // Security check
    if (invoice.booking.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    // Check if PDF is ready
    if (invoice.invoicePdfFile?.key) {
      const pdfUrl = await generatePresignedUrl(invoice.invoicePdfFile.key);
      return res.status(200).json({
        success: true,
        state: "completed",
        progress: 100,
        pdfUrl,
        invoiceNumber: invoice.invoiceNumber,
        generatedAt: invoice.generatedAt,
      });
    }

    // Check job status in queue
    const jobStatus = await getInvoiceJobStatus(parseInt(invoiceId));

    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: "Generation job not found",
      });
    }

    return res.status(200).json({
      success: true,
      state: jobStatus.state, // 'waiting', 'active', 'completed', 'failed'
      progress: jobStatus.progress || 0,
      message: getStatusMessage(jobStatus.state, jobStatus.progress as number),
    });
  } catch (error) {
    console.error("[Invoice Controller] Error in getInvoiceStatus:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get invoice status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Force-regenerate Invoice PDF
 * POST /api/invoices/regenerate
 * Nulls the cached PDF and queues a fresh generation job.
 */
export async function regenerateInvoice(req: Request, res: Response) {
  try {
    const { bookingId } = req.body;
    const userPublicId = req.public_Id;

    if (!userPublicId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!bookingId) {
      return res.status(400).json({ success: false, message: "bookingId is required" });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { customerProfile: { select: { id: true } } },
    });
    if (!user?.customerProfile) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: parseInt(bookingId) },
      include: { invoice: true },
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    if (booking.customerId !== user.customerProfile.id) {
      return res.status(403).json({ success: false, message: "Unauthorized access" });
    }
    if (!booking.invoice) {
      return res.status(400).json({ success: false, message: "No invoice exists for this booking" });
    }

    // Rebuild InvoiceItem rows from LedgerEntry/ChargeEntry, update invoice
    // totals, null the cached PDF, and queue fresh PDF generation — all in one call.
    await finalizeInvoice(booking.id);

    console.log(
      `[Invoice Controller] Regeneration queued - Invoice ${booking.invoice.id} for booking ${booking.id}`,
    );

    return res.status(202).json({
      success: true,
      generating: true,
      invoiceId: booking.invoice.id,
      statusUrl: `/invoices/status/${booking.invoice.id}`,
      message: "Regenerating invoice PDF...",
    });
  } catch (error) {
    console.error("[Invoice Controller] Error in regenerateInvoice:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to regenerate invoice",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function getStatusMessage(state: string, progress?: number): string {
  switch (state) {
    case "waiting":
      return "Invoice generation queued...";
    case "active":
      return `Generating invoice... ${progress || 0}%`;
    case "completed":
      return "Invoice ready!";
    case "failed":
      return "Invoice generation failed. Please try again.";
    default:
      return "Processing...";
  }
}
