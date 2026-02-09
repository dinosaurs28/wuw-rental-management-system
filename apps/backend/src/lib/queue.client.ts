import { Queue } from "bullmq";
import Redis from "ioredis";

// Redis URL is required - no localhost fallback
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
}

const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: true,
    connectTimeout: 30000,
    // TLS configuration for Azure Redis (rediss://)
    tls: redisUrl.startsWith('rediss://') ? {
        rejectUnauthorized: true,
    } : undefined,
});

// Use hash tags {bull} to ensure all keys for this queue hash to the same slot in cluster mode
export const imageQueue = new Queue("{bull}:image-processing", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false
    }
});

export const cleanupQueue = new Queue("{bull}:cleanup-processing", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false
    }
});

export const fileCleanupQueue = new Queue("{bull}:file-cleanup", {
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false
    }
});

