import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, VehicleStatus, BookingPhotoType } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { r2 } from "../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export const UploadPickupImage = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "File is required"
            });
        }

        // Upload to R2
        const fileContent = await fs.readFile(file.path);
        const ext = path.extname(file.originalname);
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const key = `pickup/${date}/${createID()}${ext}`;

        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: fileContent,
            ContentType: file.mimetype,
        }));

        // Clean up local file
        await fs.unlink(file.path);

        const filePublicId = createID();
        const fileRecord = await prisma.fileObject.create({
            data: {
                publicId: filePublicId,
                key: key,
                url: `${R2_PUBLIC_URL}/${key}`,
                mime: file.mimetype,
                size: file.size,
            }
        });

        return res.status(StatusCode.CREATED).json({
            message: "Pickup Image Uploaded Successfully",
            fileId: fileRecord.publicId,
            url: fileRecord.url
        });

    } catch (error) {
        console.error("Error uploading pickup image:", error);
        // Try to cleanup temp file if it exists and error happened before unlink
        if (req.file) {
            await fs.unlink(req.file.path).catch(() => { });
        }
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during upload"
        });
    }
}

export const DeletePickupImage = async (req: Request, res: Response) => {
    const { publicId } = req.params;

    try {
        const file = await prisma.fileObject.findUnique({
            where: { publicId }
        });

        if (!file) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "File not found"
            });
        }

        // Add to cleanup queue
        await fileCleanupQueue.add("cleanup", {
            key: file.key
        });

        // Hard delete from DB
        await prisma.fileObject.delete({
            where: { id: file.id }
        });

        return res.status(StatusCode.OK).json({
            message: "File deleted successfully"
        });

    } catch (error) {
        console.error("Error deleting pickup image:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during deletion"
        });
    }
}
