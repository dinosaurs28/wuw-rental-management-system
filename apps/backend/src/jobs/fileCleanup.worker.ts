import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { r2 } from "../lib/r2.client.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

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
            enableOfflineQueue: false,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            tls: redisUrl.startsWith('rediss://') ? {
                rejectUnauthorized: true,
            } : undefined,
        });
    }
    return connection;
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

let fileCleanupWorker: Worker | null = null;

export function initFileCleanupWorker(): void {
    if (fileCleanupWorker) return; // Already initialized

    fileCleanupWorker = new Worker("{bull}file-cleanup", async (job: Job) => {
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
        connection: getConnection() as any
    });

    fileCleanupWorker.on('completed', job => {
        console.log(`File cleanup job ${job.id} has completed!`);
    });

    fileCleanupWorker.on('failed', (job, err) => {
        console.log(`File cleanup job ${job?.id} has failed with ${err.message}`);
    });
}
