import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { r2 } from "../lib/r2.client.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@repo/database/client";

// Lazy initialization to ensure environment variables are loaded first
let connection: Redis | null = null;

function getConnection(): Redis {
    if (!connection) {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            throw new Error("REDIS_URL environment variable is required");
        }

        connection = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            connectTimeout: 30000,
            tls: redisUrl.startsWith('rediss://') ? {
                rejectUnauthorized: true,
            } : undefined,
        });
    }
    return connection;
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

export const cleanupWorker = new Worker("{bull}:cleanup-processing", async (job: Job) => {
    const { branchId } = job.data;
    console.log(`Starting cascade cleanup for branch ${branchId}`);

    try {
        // 1. Fetch all Vehicles in the branch
        const vehicles = await prisma.vehicle.findMany({
            where: {
                branchId: branchId,
                deletedAt: null
            },
            include: {
                images: {
                    include: {
                        file: true
                    }
                }
            }
        });

        // 2. Process Vehicles (Images + Soft Delete)
        for (const vehicle of vehicles) {
            // Delete Images from R2
            for (const image of vehicle.images) {
                if (image.file && image.file.key) {
                    try {
                        console.log(`Deleting R2 object: ${image.file.key}`);
                        await r2.send(new DeleteObjectCommand({
                            Bucket: BUCKET_NAME,
                            Key: image.file.key
                        }));
                    } catch (err) {
                        console.error(`Failed to delete key ${image.file.key} from R2`, err);
                    }
                }
            }

            // Soft Delete Vehicle
            await prisma.vehicle.update({
                where: { id: vehicle.id },
                data: { deletedAt: new Date() }
            });
        }

        // 3. Soft Delete all Staff/Users in the branch
        // Note: Managers might have been deleted already by the controller, but this catches any others
        await prisma.user.updateMany({
            where: {
                branchId: branchId,
                deletedAt: null
            },
            data: { deletedAt: new Date() }
        });

        console.log(`Cascade cleanup completed for branch ${branchId}`);

    } catch (error) {
        console.error(`Failed cleanup for branch ${branchId}:`, error);
        throw error;
    }
}, {
    connection: getConnection()
});

cleanupWorker.on('completed', job => {
    console.log(`Cleanup job ${job.id} has completed!`);
});

cleanupWorker.on('failed', (job, err) => {
    console.log(`Cleanup job ${job?.id} has failed with ${err.message}`);
});
