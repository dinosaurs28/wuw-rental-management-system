import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import sharp from "sharp";
import fs from "fs/promises";
import { r2 } from "../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@repo/database/client";
import { createID } from "../utils/nanoID.js";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
}

const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 30000,
    tls: redisUrl.startsWith('rediss://') ? {
        rejectUnauthorized: true,
    } : undefined,
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

export const imageWorker = new Worker("{bull}:image-processing", async (job: Job) => {
    const { filePath, vehicleId, mimeType, originalName } = job.data;
    console.log(`Processing image for vehicle ${vehicleId}: ${originalName}`);

    try {
        const fileBuffer = await fs.readFile(filePath);

        // 1. Process Main Image (Optimized)
        // Resize to max 1920 width/height, maintain aspect ratio, convert to webp for better compression
        const optimizedBuffer = await sharp(fileBuffer)
            .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        const mainKey = `vehicles/${vehicleId}/${createID()}.webp`;

        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: mainKey,
            Body: optimizedBuffer,
            ContentType: "image/webp",
        }));

        const mainFile = await prisma.fileObject.create({
            data: {
                publicId: createID(),
                key: mainKey,
                url: `${process.env.R2_PUBLIC_URL}/${mainKey}`,
                mime: "image/webp",
                size: optimizedBuffer.length
            }
        });

        await prisma.vehicleImage.create({
            data: {
                publicId: createID(),
                vehicleId: vehicleId,
                fileId: mainFile.id,
                isThumbnail: false
            }
        });

        // 2. Process Thumbnail
        const thumbBuffer = await sharp(fileBuffer)
            .resize({ width: 300, height: 300, fit: 'cover' })
            .webp({ quality: 80 })
            .toBuffer();

        const thumbKey = `vehicles/${vehicleId}/thumb_${createID()}.webp`;

        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: "image/webp",
        }));

        const thumbFile = await prisma.fileObject.create({
            data: {
                publicId: createID(),
                key: thumbKey,
                url: `${process.env.R2_PUBLIC_URL}/${thumbKey}`,
                mime: "image/webp",
                size: thumbBuffer.length
            }
        });

        await prisma.vehicleImage.create({
            data: {
                publicId: createID(),
                vehicleId: vehicleId,
                fileId: thumbFile.id,
                isThumbnail: true
            }
        });

        await fs.unlink(filePath);
        console.log(`Successfully processed and uploaded images for vehicle ${vehicleId}`);

    } catch (error) {
        console.error(`Failed to process image for vehicle ${vehicleId}:`, error);
        throw error;
    }
}, {
    connection
});

imageWorker.on('completed', job => {
    console.log(`${job.id} has completed!`);
});

imageWorker.on('failed', (job, err) => {
    console.log(`${job?.id} has failed with ${err.message}`);
});
