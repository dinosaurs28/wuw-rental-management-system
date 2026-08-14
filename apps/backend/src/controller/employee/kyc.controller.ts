import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";
import { generatePresignedUrl } from "../../services/r2-upload.js";

export const GetBookingKyc = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      select: {
        id: true,
        customer: {
          select: {
            id: true,
            publicId: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found",
      });
    }
    const allKycRecords = await prisma.customerKyc.findMany({
      where: { customerId: booking.customer.id },
      select: {
        publicId: true,
        type: true,
        status: true,
        file: { select: { key: true, mime: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const kycDocs = await Promise.all(
      allKycRecords
        .filter((k) => k.file)
        .map(async (k) => ({
          publicId: k.publicId,
          type: k.type || "UNKNOWN",
          status: k.status || "UNKNOWN",
          // Employees get a 15-minute window to view the document
          file: { url: await generatePresignedUrl(k.file!.key, 900), mime: k.file!.mime },
        })),
    );

    if (kycDocs.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "No KYC documents found for this customer",
        customerName: booking.customer.user.name,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "KYC Documents fetched successfully",
      customerName: booking.customer.user.name,
      kyc: kycDocs,
    });
  } catch (error) {
    console.error("Error fetching KYC:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching KYC",
    });
  }
};

export const VerifyKyc = async (req: Request, res: Response) => {
  const { kycId } = req.params;
  const { status } = req.body;

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid status. Allowed values: APPROVED, REJECTED",
    });
  }

  try {
    const actingUserPublicId = req.public_Id;
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true, name: true, role: true, branchId: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    const kyc = await prisma.customerKyc.findUnique({
      where: { publicId: kycId },
    });

    if (!kyc) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "KYC Document not found",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customerKyc.update({
        where: { publicId: kycId },
        data: { status: status },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: status === "APPROVED" ? StaffActionType.APPROVED : StaffActionType.REJECTED,
        entityType: StaffEntityType.KYC,
        entityRef: kyc.publicId,
        description: `KYC document ${kyc.publicId} ${status.toLowerCase()} for booking`,
      }, tx);

      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "CUSTOMER_DOCUMENT_VERIFIED",
        category: AuditCategory.CUSTOMER,
        severity: status === "REJECTED" ? AuditSeverity.WARNING : AuditSeverity.INFO,
        description: `KYC document ${kyc.publicId} ${status.toLowerCase()} by ${actingUser.name}`,
        entity: "CustomerKyc",
        entityId: kyc.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { documentType: kyc.type, status },
      }, tx);

      return updated;
    });

    return res.status(StatusCode.OK).json({
      message: "KYC Status Updated Successfully",
      data: {
        id: result.publicId,
        status: result.status,
      },
    });
  } catch (error) {
    console.error("Error updating KYC status:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
