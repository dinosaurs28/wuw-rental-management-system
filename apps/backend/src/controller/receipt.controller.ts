import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { generatePresignedUrl } from "../services/r2-upload.js";

/**
 * GET /api/receipts/:bookingId
 * Returns the return receipt (and PDF URL if generated) for a booking.
 * Accessible by the customer who owns the booking or any staff member.
 */
export async function getReceipt(req: Request, res: Response) {
  try {
    const { bookingId } = req.params;
    const userPublicId = req.public_Id;

    if (!userPublicId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const receipt = await prisma.returnReceipt.findFirst({
      where: {
        booking: { publicId: bookingId },
      },
      include: {
        receiptPdfFile: true,
        booking: {
          select: {
            publicId: true,
            customerId: true,
            customer: { select: { user: { select: { publicId: true } } } },
          },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not yet generated for this booking",
      });
    }

    // Allow owner or any authenticated staff (role check happens at route level)
    const ownerPublicId = receipt.booking.customer.user?.publicId;
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { role: true },
    });
    const isStaff = user && user.role !== "CUSTOMER";
    const isOwner = ownerPublicId === userPublicId;

    if (!isStaff && !isOwner) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const pdfKey = receipt.receiptPdfFile?.key ?? null;
    const pdfUrl = pdfKey ? await generatePresignedUrl(pdfKey) : null;

    return res.status(200).json({
      success: true,
      data: {
        receiptNumber: receipt.receiptNumber,
        totalCharges: receipt.totalCharges,
        depositPaid: receipt.depositPaid,
        amountDue: receipt.amountDue,
        refundAmount: receipt.refundAmount,
        lineItems: receipt.lineItems,
        generatedAt: receipt.generatedAt,
        pdfUrl,
        pdfReady: !!pdfKey,
      },
    });
  } catch (error) {
    console.error("[Receipt Controller] Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
