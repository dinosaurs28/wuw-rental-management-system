import { Request, Response } from "express";
import { StatusCode } from "../../../types/statusCode.js";
import { prisma, KycType, KycStatus } from "@repo/database/client";
import { createID } from "../../../utils/nanoID.js";

// Helper to determine URL (mocked for local, or standard path)
const getFileUrl = (filename: string) => `/uploads/${filename}`;

export const UploadWalkinKyc = async (req: Request, res: Response) => {
    const { kyc_type } = req.body;
    const customer_public_id = req.customer_public_id;
    const file = req.file;

    if (!file) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "File is required"
        });
    }

    if (!kyc_type || !Object.values(KycType).includes(kyc_type as KycType)) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: `Invalid or missing kyc_type. Allowed: ${Object.values(KycType).join(", ")}`
        });
    }

    try {

        // 1. Create FileObject
        const filePublicId = createID();
        const fileRecord = await prisma.fileObject.create({
            data: {
                publicId: filePublicId,
                key: file.filename,
                url: getFileUrl(file.filename),
                mime: file.mimetype,
                size: file.size,
            }
        });

        // 2. Create or Update CustomerKyc
        const kycPublicId = createID();

        // Check if KYC of this type already exists for customer
        const existingKyc = await prisma.customerKyc.findUnique({
            where: {
                customerId_type: {
                    customerId: customer_public_id as string,
                    type: kyc_type as KycType
                }
            }
        });

        let kycRecord;
        if (existingKyc) {
            kycRecord = await prisma.customerKyc.update({
                where: { id: existingKyc.id },
                data: {
                    fileId: fileRecord.id, // Update to new file
                    status: KycStatus.PENDING, // Reset status on new upload
                }
            });
        } else {
            kycRecord = await prisma.customerKyc.create({
                data: {
                    publicId: kycPublicId,
                    customerId: customer.id,
                    type: kyc_type as KycType,
                    fileId: fileRecord.id,
                    status: KycStatus.PENDING
                }
            });
        }

        await prisma.staffActivityLog.create({
            data: {
                publicId: createID(),
                staffId: actingUser.id,
                action: existingKyc ? "WALKIN_KYC_UPDATE" : "WALKIN_KYC_UPLOAD",
                entity: "CustomerKyc",
                entityId: kycRecord.publicId
            }
        });

        return res.status(StatusCode.CREATED).json({
            message: "Walk-in KYC Uploaded Successfully",
            fileId: kycRecord.publicId,
            url: fileRecord.url,
            realFileId: fileRecord.publicId
        });

    } catch (error) {
        console.error("Error uploading Walk-in KYC:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during upload"
        });
    }
}

export const UpdateWalkinKycStatus = async (req: Request, res: Response) => {
    const { fileId, status } = req.body;

    if (!fileId) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "fileId is required"
        });
    }

    if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid status. Allowed values: APPROVED, REJECTED"
        });
    }

    try {
        const actingUserPublicId = req.public_Id;
        const actingUser = await prisma.user.findUnique({
            where: { publicId: actingUserPublicId },
            select: { id: true }
        });

        if (!actingUser) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: User not found"
            });
        }

        const kyc = await prisma.customerKyc.findUnique({
            where: { publicId: fileId }
        });

        if (!kyc) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "KYC Document not found"
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.customerKyc.update({
                where: { id: kyc.id },
                data: { status: status as KycStatus }
            });

            // AUDIT LOGGING
            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: actingUser.id,
                    action: `WALKIN_KYC_${status}`,
                    entity: "CustomerKyc",
                    entityId: kyc.publicId,
                }
            });

            return updated;
        });

        return res.status(StatusCode.OK).json({
            message: "Walk-in KYC Status Updated Successfully",
            data: {
                id: result.publicId,
                status: result.status
            }
        });

    } catch (error) {
        console.error("Error updating Walk-in KYC status:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}
