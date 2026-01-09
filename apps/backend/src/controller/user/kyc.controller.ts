import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, KycType, KycStatus, Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { r2 } from "../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import fs from "fs/promises";
import path from "path";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;


// Helper to get Customer ID from Request
const getCustomerId = async (publicId: string) => {
    const user = await prisma.user.findUnique({
        where: { publicId },
        select: { id: true }
    });

    if (!user) return null;

    const customer = await prisma.customer.findUnique({
        where: { userId: user.id },
        select: { id: true }
    });
    return customer?.id;
};

export const GetKycDocuments = async (req: Request, res: Response) => {
    try {
        const publicId = req.public_Id;
        const customerId = await getCustomerId(publicId);

        if (!customerId) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Customer profile not found"
            });
        }

        const documents = await prisma.customerKyc.findMany({
            where: { customerId },
            include: {
                file: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return res.status(StatusCode.OK).json({
            message: "KYC documents fetched successfully",
            data: documents
        });

    } catch (error) {
        console.error("Get KYC Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching KYC documents"
        });
    }
};


export const UploadKycDocument = async (req: Request, res: Response) => {
    try {
        const publicId = req.public_Id;
        const customerId = await getCustomerId(publicId);

        if (!customerId) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Customer profile not found"
            });
        }

        const { type } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "No file uploaded"
            });
        }

        if (!type || !Object.values(KycType).includes(type as KycType)) {
            // Cleanup temp file if validation fails
            await fs.unlink(file.path).catch(() => { });
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid or missing KYC document type"
            });
        }

        // Check if document of this type already exists (optional: business rule?)
        // The schema has @@unique([customerId, type]), so we must check or handle conflict.
        const existingKyc = await prisma.customerKyc.findUnique({
            where: {
                customerId_type: {
                    customerId,
                    type: type as KycType
                }
            }
        });

        if (existingKyc) {
            await fs.unlink(file.path).catch(() => { });
            return res.status(StatusCode.CONFLICT).json({
                message: `Document of type ${type} already exists. Please delete it first if you want to replace it.`
            });
        }

        // Upload to R2
        const fileContent = await fs.readFile(file.path);
        const ext = path.extname(file.originalname);
        const key = `kyc/${customerId}/${type.toLowerCase()}_${createID()}${ext}`;

        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: fileContent,
            ContentType: file.mimetype,
        }));

        // Clean up local file
        await fs.unlink(file.path);

        // Save to DB Transaction
        const kycRecord = await prisma.$transaction(async (tx) => {
            const fileObj = await tx.fileObject.create({
                data: {
                    publicId: createID(),
                    key: key,
                    url: `${R2_PUBLIC_URL}/${key}`,
                    mime: file.mimetype,
                    size: file.size
                }
            });

            return await tx.customerKyc.create({
                data: {
                    publicId: createID(),
                    customerId,
                    type: type as KycType,
                    fileId: fileObj.id,
                    status: KycStatus.PENDING
                },
                include: { file: true }
            });
        });

        return res.status(StatusCode.CREATED).json({
            message: "KYC document uploaded successfully",
            data: kycRecord
        });

    } catch (error) {
        console.error("Upload KYC Error:", error);
        // Try to cleanup temp file if it exists and error happened before unlink
        if (req.file) {
            await fs.unlink(req.file.path).catch(() => { });
        }
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error uploading KYC document"
        });
    }
};


export const DeleteKycDocument = async (req: Request, res: Response) => {
    try {
        const publicId = req.public_Id;
        const { id } = req.params; // Expecting publicId of the KYC record

        const customerId = await getCustomerId(publicId);
        if (!customerId) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Customer profile not found"
            });
        }

        const kycRecord = await prisma.customerKyc.findUnique({
            where: { publicId: id },
            include: { file: true }
        });

        if (!kycRecord) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "KYC document not found"
            });
        }

        // Ownership check
        if (kycRecord.customerId !== customerId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "You are not authorized to delete this document"
            });
        }
        await prisma.$transaction([
            prisma.customerKyc.delete({ where: { id: kycRecord.id } }),
            prisma.fileObject.delete({ where: { id: kycRecord.fileId } })
        ]);

        if (kycRecord.file && kycRecord.file.key) {
            await fileCleanupQueue.add('delete-kyc-file', {
                key: kycRecord.file.key
            });
        }

        return res.status(StatusCode.OK).json({
            message: "KYC document deleted successfully"
        });

    } catch (error) {
        console.error("Delete KYC Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error deleting KYC document"
        });
    }
};
