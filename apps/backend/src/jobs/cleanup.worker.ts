import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { r2 } from "../lib/r2.client.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@repo/database/client";

// Lazy initialization to ensure environment variables are loaded first
console.log("[CleanupWorker] Module loaded");
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
        ? {
            rejectUnauthorized: true,
          }
        : undefined,
    });
  }
  return connection;
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

let cleanupWorker: Worker | null = null;

export function initCleanupWorker(): void {
  if (cleanupWorker) return; // Already initialized

  console.log("Initializing cleanup worker...");
  cleanupWorker = new Worker(
    "{bull}cleanup-processing",
    async (job: Job) => {
      const { branchId } = job.data;
      console.log(
        `[Worker] Received job ${job.name} with ID ${job.id} for branch ${branchId}`,
      );
      console.log(`[Worker] Job data:`, job.data);
      console.log(`Starting cascade cleanup for branch ${branchId}`);

      try {
        // 0. Fetch Vehicles to delete images first
        const vehicles = await prisma.vehicle.findMany({
          where: { branchId: branchId },
          include: { images: { include: { file: true } } },
        });
        // 1. Delete Images from R2
        for (const vehicle of vehicles) {
          for (const image of vehicle.images) {
            if (image.file && image.file.key) {
              try {
                console.log(`Deleting R2 object: ${image.file.key}`);
                await r2.send(
                  new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: image.file.key,
                  }),
                );
              } catch (err) {
                console.error(
                  `Failed to delete key ${image.file.key} from R2`,
                  err,
                );
              }
            }
          }
        }

        // 2. Database Hard Deletes (Order matters for Foreign Keys)
        await prisma.$transaction(
          async (tx) => {
            // A. Delete Branch Settings & Rules
            await tx.gSTRule.deleteMany({ where: { branchId } });
            await tx.branchPricingSetting.deleteMany({ where: { branchId } });
            await tx.categoryDepositSetting.deleteMany({ where: { branchId } });
            await tx.pricingDiscountSlab.deleteMany({ where: { branchId } });

            // B. Delete Bookings & Related Data
            const bookings = await tx.booking.findMany({
              where: { branchId },
              select: { id: true },
            });
            const bookingIds = bookings.map((b) => b.id);

            if (bookingIds.length > 0) {
              await tx.bookingItem.deleteMany({
                where: { bookingId: { in: bookingIds } },
              });
              await tx.bookingPhoto.deleteMany({
                where: { bookingId: { in: bookingIds } },
              });
              await tx.damageReport.deleteMany({
                where: { bookingId: { in: bookingIds } },
              });
              await tx.payment.deleteMany({
                where: { invoice: { bookingId: { in: bookingIds } } },
              }); // via Invoice
              await tx.invoice.deleteMany({
                where: { bookingId: { in: bookingIds } },
              });
              await tx.deposit.deleteMany({
                where: { bookingId: { in: bookingIds } },
              });
              await tx.booking.deleteMany({ where: { branchId } });
            }

            // C. Delete Vehicles & Related Data
            const vehicleIds = vehicles.map((v) => v.id);
            if (vehicleIds.length > 0) {
              await tx.vehicleImage.deleteMany({
                where: { vehicleId: { in: vehicleIds } },
              });
              await tx.vehicleInsurance.deleteMany({
                where: { vehicleId: { in: vehicleIds } },
              });
              await tx.vehicleMaintenanceRecord.deleteMany({
                where: { vehicleId: { in: vehicleIds } },
              });
              await tx.vehiclePricingOverride.deleteMany({
                where: { vehicleId: { in: vehicleIds } },
              });
              await tx.vehicle.deleteMany({ where: { branchId } });
            }

            // D. Delete Users (Managers/Staff) & Customer Profiles
            const users = await tx.user.findMany({
              where: { branchId },
              select: { id: true, role: true },
            });
            const userIds = users.map((u) => u.id);

            if (userIds.length > 0) {
              // Delete Customer profiles linked to these users
              await tx.customerKyc.deleteMany({
                where: { customer: { userId: { in: userIds } } },
              });
              await tx.customer.deleteMany({
                where: { userId: { in: userIds } },
              });

              await tx.emailVerificationOtp.deleteMany({
                where: { userId: { in: userIds } },
              });
              await tx.userProvider.deleteMany({
                where: { userId: { in: userIds } },
              });
              await tx.auditLog.deleteMany({
                where: { actorId: { in: userIds } },
              });
              await tx.staffActivityLog.deleteMany({
                where: { branchId },
              });
              await tx.user.deleteMany({ where: { branchId } });
            }

            // E. Finally, Delete the Branch
            await tx.branch.delete({ where: { id: branchId } });
          },
          {
            maxWait: 10000, // 10s max wait
            timeout: 20000, // 20s timeout for large deletions
          },
        );

        console.log(`Cascade HARD DELETE completed for branch ${branchId}`);
      } catch (error) {
        console.error(`Failed cleanup for branch ${branchId}:`, error);
        throw error;
      }
    },
    {
      connection: getConnection() as any,
    },
  );

  cleanupWorker.on("completed", (job) => {
    console.log(`Cleanup job ${job.id} has completed!`);
  });

  cleanupWorker.on("failed", (job, err) => {
    console.log(`Cleanup job ${job?.id} has failed with ${err.message}`);
  });
}
