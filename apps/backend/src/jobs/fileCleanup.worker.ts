import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { r2, PUBLIC_BUCKET, PRIVATE_BUCKET } from "../lib/r2.client.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

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
      tls: redisUrl.startsWith("rediss://")
        ? { rejectUnauthorized: true }
        : undefined,
    });
  }
  return connection;
}

let fileCleanupWorker: Worker | null = null;

export function initFileCleanupWorker(): void {
  if (fileCleanupWorker) return;

  fileCleanupWorker = new Worker(
    "{bull}file-cleanup",
    async (job: Job) => {
      // `bucket` is passed by callers that know the target bucket.
      // Defaults to the public bucket for backward compatibility with
      // existing pickup/return/damage photo cleanup jobs.
      const { key, bucket } = job.data;
      const targetBucket = bucket ?? PUBLIC_BUCKET;

      console.log(`[FileCleanup] Deleting ${key} from bucket ${targetBucket}`);

      try {
        await r2.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: key }));
        console.log(`[FileCleanup] Deleted: ${key}`);
      } catch (error) {
        console.error(`[FileCleanup] Failed to delete ${key}:`, error);
        throw error;
      }
    },
    {
      connection: getConnection() as any,
    },
  );

  fileCleanupWorker.on("completed", (job) => {
    console.log(`File cleanup job ${job.id} has completed!`);
  });

  fileCleanupWorker.on("failed", (job, err) => {
    console.log(`File cleanup job ${job?.id} has failed with ${err.message}`);
  });
}
