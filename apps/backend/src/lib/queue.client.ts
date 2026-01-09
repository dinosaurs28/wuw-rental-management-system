import { Queue } from "bullmq";
import Redis from "ioredis";

// Reuse existing Redis connection string from environment if available, or default
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required by BullMQ
});

export const imageQueue = new Queue("image-processing", {
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

export const cleanupQueue = new Queue("cleanup-processing", {
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

export const fileCleanupQueue = new Queue("file-cleanup", {
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

