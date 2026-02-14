import { Queue } from "bullmq";
import Redis from "ioredis";

// Lazy initialization to ensure environment variables are loaded first
let connection: Redis | null = null;
let imageQueueInstance: Queue | null = null;
let cleanupQueueInstance: Queue | null = null;
let fileCleanupQueueInstance: Queue | null = null;
let invoiceQueueInstance: Queue | null = null;


function getConnection(): Redis {
    if (!connection) {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            throw new Error("REDIS_URL environment variable is required");
        }

        connection = new Redis(redisUrl, {
            maxRetriesPerRequest: null, // Required by BullMQ
            enableReadyCheck: true,
            connectTimeout: 30000,
            enableOfflineQueue: false,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            // TLS configuration for Azure Redis (rediss://)
            tls: redisUrl.startsWith('rediss://') ? {
                rejectUnauthorized: true,
            } : undefined,
        });
    }
    return connection;
}

// Lazy getters for queues
export function getImageQueue(): Queue {
    if (!imageQueueInstance) {
        imageQueueInstance = new Queue("{bull}image-processing", {
            connection: getConnection(),
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
    }
    return imageQueueInstance;
}

export function getCleanupQueue(): Queue {
    if (!cleanupQueueInstance) {
        cleanupQueueInstance = new Queue("{bull}cleanup-processing", {
            connection: getConnection(),
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
    }
    return cleanupQueueInstance;
}

export function getFileCleanupQueue(): Queue {
    if (!fileCleanupQueueInstance) {
        fileCleanupQueueInstance = new Queue("{bull}file-cleanup", {
            connection: getConnection(),
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
    }
    return fileCleanupQueueInstance;
}

export function getInvoiceQueue(): Queue {
    if (!invoiceQueueInstance) {
        invoiceQueueInstance = new Queue("{bull}invoice-generation", {
            connection: getConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 5000,
                },
                removeOnComplete: {
                    age: 86400, // 24 hours
                    count: 1000,
                },
                removeOnFail: {
                    age: 604800, // 7 days
                }
            }
        });
    }
    return invoiceQueueInstance;
}

// For backward compatibility, export as properties that call the getters
export const imageQueue = new Proxy({} as Queue, {
    get(_target, prop) {
        return getImageQueue()[prop as keyof Queue];
    }
});

export const cleanupQueue = new Proxy({} as Queue, {
    get(_target, prop) {
        return getCleanupQueue()[prop as keyof Queue];
    }
});

export const fileCleanupQueue = new Proxy({} as Queue, {
    get(_target, prop) {
        return getFileCleanupQueue()[prop as keyof Queue];
    }
});

export const invoiceQueue = new Proxy({} as Queue, {
    get(_target, prop) {
        return getInvoiceQueue()[prop as keyof Queue];
    }
});

