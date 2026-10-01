import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, KycType, KycSide, KycStatus, Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { uploadKycToR2, generatePresignedUrl } from "../../services/r2-upload.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { PRIVATE_BUCKET } from "../../lib/r2.client.js";
import fs from "fs/promises";
import path from "path";

const getCustomerId = async (publicId: string) => {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { id: true },
  });
  if (!user) return null;
  const customer = await prisma.customer.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  return customer?.id;
};

export const GetKycDocuments = async (req: Request, res: Response) => {
  try {
    const publicId = req.public_Id;
    const customerId = await getCustomerId(publicId);

    if (!customerId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Customer profile not found",
      });
    }

    const documents = await prisma.customerKyc.findMany({
      where: { customerId },
      include: { file: { select: { id: true, publicId: true, key: true, mime: true, size: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Generate a short-lived presigned URL for each KYC document
    const data = await Promise.all(
      documents.map(async (doc) => ({
        ...doc,
        file: doc.file
          ? {
              ...doc.file,
              url: await generatePresignedUrl(doc.file.key),
            }
          : null,
      })),
    );

    return res.status(StatusCode.OK).json({
      message: "KYC documents fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Get KYC Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching KYC documents",
    });
  }
};

export const UploadKycDocument = async (req: Request, res: Response) => {
  try {
    const publicId = req.public_Id;
    const customerId = await getCustomerId(publicId);

    if (!customerId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Customer profile not found",
      });
    }

    const { type, side } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "No file uploaded" });
    }

    if (!type || !Object.values(KycType).includes(type as KycType)) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid or missing KYC document type",
      });
    }

    if (!side || !Object.values(KycSide).includes(side as KycSide)) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Invalid or missing side. Allowed: ${Object.values(KycSide).join(", ")}`,
      });
    }

    const existingKyc = await prisma.customerKyc.findUnique({
      where: { customerId_type_side: { customerId, type: type as KycType, side: side as KycSide } },
    });

    if (existingKyc) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(StatusCode.CONFLICT).json({
        message: `Document of type ${type} (${side}) already exists. Please delete it first if you want to replace it.`,
      });
    }

    const fileContent = await fs.readFile(file.path);
    await fs.unlink(file.path);

    const ext = path.extname(file.originalname);
    const key = `kyc/${customerId}/${type.toLowerCase()}_${createID()}${ext}`;

    const { fileId } = await uploadKycToR2(fileContent, key, file.mimetype, file.size);

    const kycRecord = await prisma.customerKyc.create({
      data: {
        publicId: createID(),
        customerId,
        type: type as KycType,
        side: side as KycSide,
        fileId,
        status: KycStatus.PENDING,
      },
      include: { file: { select: { id: true, publicId: true, key: true, mime: true, size: true } } },
    });

    const presignedUrl = await generatePresignedUrl(key);

    return res.status(StatusCode.CREATED).json({
      message: "KYC document uploaded successfully",
      data: { ...kycRecord, file: { ...kycRecord.file, url: presignedUrl } },
    });
  } catch (error) {
    console.error("Upload KYC Error:", error);
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error uploading KYC document",
    });
  }
};

export const DeleteKycDocument = async (req: Request, res: Response) => {
  try {
    const { id, customer_public_id } = req.body;
    const actingUserPublicId = req.public_Id;

    if (!actingUserPublicId) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: Missing user context",
      });
    }

    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: {
        id: true,
        role: true,
        customerProfile: { select: { id: true } },
      },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized: User not found" });
    }

    const kycRecord = await prisma.customerKyc.findUnique({
      where: { publicId: id },
      include: {
        file: true,
        customer: { include: { user: true } },
      },
    });

    if (!kycRecord) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "KYC document not found" });
    }

    const isStaff = ([Role.STAFF, Role.ADMIN, Role.MANAGER] as Role[]).includes(actingUser.role);

    if (!isStaff) {
      const customerId = actingUser.customerProfile?.id;
      if (!customerId || kycRecord.customerId !== customerId) {
        return res.status(StatusCode.FORBIDDEN).json({
          message: "You are not authorized to delete this document",
        });
      }
    } else {
      // Staff must name the customer they are serving, and the document must be theirs.
      // Old staff builds never sent customer_public_id: tolerate that only for
      // documents that were never approved (an approved DL may back live rentals).
      if (customer_public_id === undefined || customer_public_id === null || customer_public_id === "") {
        if (kycRecord.status === KycStatus.APPROVED) {
          return res.status(StatusCode.BAD_REQUEST).json({
            success: false,
            code: "CUSTOMER_REQUIRED",
            message: "Update the app to remove an approved KYC document.",
          });
        }
        // With no customer to check against, ownership is proven by the upload:
        // only a document this staff member uploaded (the walk-in they are
        // serving) can be removed — never another customer's document.
        const uploadedByActor = await prisma.staffActivityLog.findFirst({
          where: {
            actorPublicId: actingUserPublicId,
            actionType: StaffActionType.UPLOADED,
            entityType: StaffEntityType.KYC,
            entityRef: kycRecord.publicId,
          },
          select: { id: true },
        });
        if (!uploadedByActor) {
          return res.status(StatusCode.BAD_REQUEST).json({
            success: false,
            code: "CUSTOMER_REQUIRED",
            message: "Update the app to remove a KYC document you didn't upload.",
          });
        }
      } else if (typeof customer_public_id !== "string" || kycRecord.customer?.user?.publicId !== customer_public_id) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "KYC_CUSTOMER_MISMATCH",
          message: "KYC document does not belong to the specified customer",
        });
      }
    }

    // A booking that snapshotted this file (Booking.kycFileId) keeps it as KYC evidence:
    // deleting the FileObject would SET NULL every such booking. Only detach the
    // document from the customer then, and keep the stored file.
    const keepFile = await prisma.$transaction(async (tx) => {
      await tx.customerKyc.delete({ where: { id: kycRecord.id } });
      if (!kycRecord.fileId) return false;
      const usedByBookings = await tx.booking.count({ where: { kycFileId: kycRecord.fileId } });
      if (usedByBookings > 0) return true;
      await tx.fileObject.delete({ where: { id: kycRecord.fileId } });
      return false;
    });

    if (isStaff) {
      staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.DELETED,
        entityType: StaffEntityType.KYC,
        entityRef: kycRecord.publicId,
        description: `KYC document ${kycRecord.publicId} deleted for customer`,
      });
    }

    if (kycRecord.file?.key && !keepFile) {
      // Pass the private bucket name so the cleanup worker targets the right bucket
      await fileCleanupQueue.add("delete-kyc-file", {
        key: kycRecord.file.key,
        bucket: PRIVATE_BUCKET,
      });
    }

    return res.status(StatusCode.OK).json({ message: "KYC document deleted successfully" });
  } catch (error) {
    console.error("Delete KYC Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error deleting KYC document",
    });
  }
};
