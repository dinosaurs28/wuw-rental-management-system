import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  VehicleStatus,
  BookingPhotoType,
} from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { r2 } from "../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import { redis } from "../../lib/redisconfig.js";
import path from "path";
import { processImage } from "../../utils/image-processor.js";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export const UploadReturnImage = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "File is required",
      });
    }

    // Upload to R2
    const fileContent = await fs.readFile(file.path);
    const ext = path.extname(file.originalname);
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const key = `returns/${date}/${createID()}${ext}`;

    // Process image with Sharp
    const processed = await processImage(fileContent);

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: processed.buffer,
        ContentType: processed.mimeType,
      }),
    );

    // Clean up local file
    await fs.unlink(file.path);

    const filePublicId = createID();
    const fileRecord = await prisma.fileObject.create({
      data: {
        publicId: filePublicId,
        key: key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: processed.mimeType,
        size: processed.size,
      },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Return Image Uploaded Successfully",
      fileId: fileRecord.publicId,
      url: fileRecord.url,
    });
  } catch (error) {
    console.error("Error uploading return image:", error);
    // Try to cleanup temp file if it exists and error happened before unlink
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during upload",
    });
  }
};

export const CompleteReturn = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { returnImageIds, requireManagerConfirmation } = req.body;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        isAdvancePayment: true,
        remainingBalance: true,
        remainingPaidAt: true,
        items: {
          select: { vehicleId: true },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found or access denied",
      });
    }

    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot complete return. Current status: ${booking.status}`,
      });
    }

    // Advance payment gate: remaining balance MUST be collected before return
    if (booking.isAdvancePayment && !booking.remainingPaidAt) {
      return res.status(StatusCode.PAYMENT_REQUIRED).json({
        message: `Remaining balance of ₹${booking.remainingBalance} must be collected before completing the return.`,
        remainingBalance: booking.remainingBalance,
      });
    }

    const actingUserPublicId = req.public_Id;
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    const vehicleIds = booking.items.map((item) => item.vehicleId);

    await prisma.$transaction(async (tx) => {
      if (requireManagerConfirmation) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            requiresManagerConfirmation: true,
          },
        });
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.RETURNED,
          },
        });

        await tx.vehicle.updateMany({
          where: {
            id: { in: vehicleIds },
          },
          data: {
            status: VehicleStatus.AVAILABLE,
          },
        });
      }

      if (
        returnImageIds &&
        Array.isArray(returnImageIds) &&
        returnImageIds.length > 0
      ) {
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: returnImageIds } },
        });

        if (files.length !== returnImageIds.length) {
          throw new Error("Invalid return image IDs provided");
        }

        await tx.bookingPhoto.createMany({
          data: files.map((f) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.POST_RETURN,
          })),
        });
      }

      await staffActivityService.logFromRequest(req, {
        actionType: requireManagerConfirmation ? StaffActionType.INITIATED : StaffActionType.COMPLETED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: requireManagerConfirmation
          ? `Return approval requested for booking ${booking.publicId}`
          : `Vehicle return completed for booking ${booking.publicId}`,
      }, tx);
    });

    // Invalidate public vehicle cache only if actual return occurred
    if (!requireManagerConfirmation) {
      let cursor = "0";
      do {
        const reply = await redis.scan(
          cursor,
          "MATCH",
          "public:vehicles:*",
          "COUNT",
          100,
        );
        cursor = reply[0];
        const keys = reply[1];
        if (keys.length > 0) {
          await redis.del(keys);
        }
      } while (cursor !== "0");
    }

    return res.status(StatusCode.OK).json({
      message: requireManagerConfirmation 
        ? "Return sent to manager for confirmation." 
        : "Return Processed Successfully. Vehicle is now AVAILABLE.",
    });
  } catch (error) {
    console.error("Return Action Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during Return",
    });
  }
};

export const DeleteReturnImage = async (req: Request, res: Response) => {
  const { publicId } = req.params;

  try {
    const file = await prisma.fileObject.findUnique({
      where: { publicId },
    });

    if (!file) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "File not found",
      });
    }

    // Add to cleanup queue
    await fileCleanupQueue.add("cleanup", {
      key: file.key,
    });

    // Hard delete from DB
    await prisma.fileObject.delete({
      where: { id: file.id },
    });

    return res.status(StatusCode.OK).json({
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting return image:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during deletion",
    });
  }
};
