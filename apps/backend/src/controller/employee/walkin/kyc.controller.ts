import { Request, Response } from "express";
import { StatusCode } from "../../../types/statusCode.js";
import { prisma, KycType, KycStatus } from "@repo/database/client";
import { createID } from "../../../utils/nanoID.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../../services/staffActivity/staffActivity.service.js";
import { r2 } from "../../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { processImage } from "../../../utils/image-processor.js";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export const UploadWalkinKyc = async (req: Request, res: Response) => {
  const { kyc_type } = req.body;
  // req.customer_id is populated by CheckCustomerPublicId middleware
  const customerId = req.customer_id;
  // req.public_Id is populated by EmployeeCheck middleware
  const actingUserPublicId = req.public_Id;
  const file = req.file;

  if (!file) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "File is required",
    });
  }

  if (!actingUserPublicId) {
    return res.status(StatusCode.UNAUTHORIZED).json({
      message: "Unauthorized: Missing user context",
    });
  }

  if (!customerId) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Error: Customer context missing after validation",
    });
  }

  if (!kyc_type || !Object.values(KycType).includes(kyc_type as KycType)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: `Invalid or missing kyc_type. Allowed: ${Object.values(KycType).join(", ")}`,
    });
  }

  try {
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    // Upload to R2
    const fileContent = await fs.readFile(file.path);
    const ext = path.extname(file.originalname);
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const key = `kyc/${date}/${createID()}${ext}`;

    // Process image with Sharp
    const processed = await processImage(fileContent);

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: processed.buffer,
        ContentType: processed.mimeType,
      }),
    );

    // Clean up local file
    await fs.unlink(file.path);

    // 1. Create FileObject
    const filePublicId = createID();
    const fileRecord = await prisma.fileObject.create({
      data: {
        publicId: filePublicId,
        key: key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: processed.mimeType,
        size: processed.size,
      },
    });

    // 2. Create or Update CustomerKyc
    const kycPublicId = createID();

    // Check if KYC of this type already exists for customer
    const existingKyc = await prisma.customerKyc.findUnique({
      where: {
        customerId_type: {
          customerId: customerId,
          type: kyc_type as KycType,
        },
      },
    });

    let kycRecord;
    if (existingKyc) {
      kycRecord = await prisma.customerKyc.update({
        where: { id: existingKyc.id },
        data: {
          fileId: fileRecord.id, // Update to new file
          status: KycStatus.PENDING, // Reset status on new upload
        },
      });
    } else {
      kycRecord = await prisma.customerKyc.create({
        data: {
          publicId: kycPublicId,
          customerId: customerId,
          type: kyc_type as KycType,
          fileId: fileRecord.id,
          status: KycStatus.PENDING,
        },
      });
    }

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPLOADED,
      entityType: StaffEntityType.KYC,
      entityRef: kycRecord.publicId,
      description: `Walk-in KYC ${existingKyc ? "updated" : "uploaded"} for customer ${customerId}`,
    });

    return res.status(StatusCode.CREATED).json({
      message: "Walk-in KYC Uploaded Successfully",
      fileId: kycRecord.publicId,
      url: fileRecord.url,
      realFileId: fileRecord.publicId,
    });
  } catch (error) {
    console.error("Error uploading Walk-in KYC:", error);
    // Try to cleanup temp file if it exists and error happened before unlink
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during upload",
    });
  }
};

export const UpdateWalkinKycStatus = async (req: Request, res: Response) => {
  const { fileId, status } = req.body;

  if (!fileId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "fileId is required",
    });
  }

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid status. Allowed values: APPROVED, REJECTED",
    });
  }

  try {
    const actingUserPublicId = req.public_Id;
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    const kyc = await prisma.customerKyc.findUnique({
      where: { publicId: fileId },
    });

    if (!kyc) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "KYC Document not found",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customerKyc.update({
        where: { id: kyc.id },
        data: { status: status as KycStatus },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: status === "APPROVED" ? StaffActionType.APPROVED : StaffActionType.REJECTED,
        entityType: StaffEntityType.KYC,
        entityRef: kyc.publicId,
        description: `Walk-in KYC ${kyc.publicId} ${status.toLowerCase()} for customer`,
      }, tx);

      return updated;
    });

    return res.status(StatusCode.OK).json({
      message: "Walk-in KYC Status Updated Successfully",
      data: {
        id: result.publicId,
        status: result.status,
      },
    });
  } catch (error) {
    console.error("Error updating Walk-in KYC status:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
