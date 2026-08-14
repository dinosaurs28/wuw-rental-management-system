import { Request, Response } from "express";
import { StatusCode } from "../../../types/statusCode.js";
import { prisma, KycType, KycSide, KycStatus } from "@repo/database/client";
import { createID } from "../../../utils/nanoID.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../../services/staffActivity/staffActivity.service.js";
import { uploadKycToR2, generatePresignedUrl } from "../../../services/r2-upload.js";
import fs from "fs/promises";
import path from "path";
import { processImage } from "../../../utils/image-processor.js";

export const UploadWalkinKyc = async (req: Request, res: Response) => {
  const { kyc_type, side } = req.body;
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

  if (!side || !Object.values(KycSide).includes(side as KycSide)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: `Invalid or missing side. Allowed: ${Object.values(KycSide).join(", ")}`,
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

    const rawContent = await fs.readFile(file.path);
    await fs.unlink(file.path);

    const ext = path.extname(file.originalname);
    const date = new Date().toISOString().split("T")[0];
    const key = `kyc/${date}/${createID()}${ext}`;

    const processed = await processImage(rawContent);

    const { fileId: uploadedFileId } = await uploadKycToR2(
      processed.buffer,
      key,
      processed.mimeType,
      processed.size,
    );

    // Fetch the FileObject we just created so we have its id
    const fileRecord = await prisma.fileObject.findUnique({ where: { id: uploadedFileId } })!;

    const existingKyc = await prisma.customerKyc.findUnique({
      where: {
        customerId_type_side: {
          customerId: customerId,
          type: kyc_type as KycType,
          side: side as KycSide,
        },
      },
    });

    let kycRecord;
    if (existingKyc) {
      kycRecord = await prisma.customerKyc.update({
        where: { id: existingKyc.id },
        data: { fileId: uploadedFileId, status: KycStatus.PENDING },
      });
    } else {
      kycRecord = await prisma.customerKyc.create({
        data: {
          publicId: createID(),
          customerId: customerId,
          type: kyc_type as KycType,
          side: side as KycSide,
          fileId: uploadedFileId,
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

    const presignedUrl = await generatePresignedUrl(key);

    return res.status(StatusCode.CREATED).json({
      message: "Walk-in KYC Uploaded Successfully",
      fileId: kycRecord.publicId,
      url: presignedUrl,
      realFileId: fileRecord?.publicId,
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
