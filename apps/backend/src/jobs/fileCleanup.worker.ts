import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { r2 } from "../lib/r2.client.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

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

export const fileCleanupWorker = new Worker("{bull}:file-cleanup", async (job: Job) => {
    const { key } = job.data;
    console.log(`Processing file cleanup for key: ${key}`);

    try {
        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
        }));
        console.log(`Successfully deleted file from R2: ${key}`);
    } catch (error) {
        console.error(`Failed to delete file ${key} from R2:`, error);
        throw error;
    }
}, {
    connection
});

fileCleanupWorker.on('completed', job => {
    console.log(`File cleanup job ${job.id} has completed!`);
});

fileCleanupWorker.on('failed', (job, err) => {
    console.log(`File cleanup job ${job?.id} has failed with ${err.message}`);
});
