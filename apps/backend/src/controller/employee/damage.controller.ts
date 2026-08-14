import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  BookingPhotoType,
  VehicleReturnDisposition,
  DamageReportStatus,
  VehicleStatus,
  DamageChargeType,
} from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { createDamageReportSchema } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { r2 } from "../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { processImage } from "../../utils/image-processor.js";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export const UploadDamageImage = async (req: Request, res: Response) => {
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
    const key = `damage/${date}/${createID()}${ext}`;

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

    // Create FileObject record
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
      message: "Damage Image Uploaded Successfully",
      fileId: fileRecord.publicId,
      url: fileRecord.url,
    });
  } catch (error) {
    console.error("Error uploading damage image:", error);
    // Try to cleanup temp file if it exists and error happened before unlink
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during upload",
    });
  }
};

export const CreateDamageReport = async (req: Request, res: Response) => {
  try {
    const validation = createDamageReportSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid inputs",
        errors: validation.error.errors,
      });
    }

    const {
      bookingId,
      odo,
      fuelLevel,
      severity,
      chargeType,
      damageImageIds,
      notes,
      returnImageIds,
    } = validation.data;
    const staffId = req.public_Id;
    const branchId = req.branch_Id;

    // 2. Fetch Booking & Validate Constraints
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      include: {
        branch: true,
        items: {
          include: { vehicle: true },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found",
      });
    }

    // Check Branch
    if (booking.branchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: Booking does not belong to your branch",
      });
    }

    // Check Status
    const ALLOWED_STATUSES: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.PICKED_UP,
      BookingStatus.RETURNED,
    ];
    if (!ALLOWED_STATUSES.includes(booking.status)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Invalid Booking Status. Expected CONFIRMED, PICKED_UP, or RETURNED, got ${booking.status}`,
      });
    }

    // Get Vehicle from items
    const vehicleItem = booking.items[0];
    if (!vehicleItem || !vehicleItem.vehicle) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Booking has no vehicle assigned",
      });
    }
    const vehicleId = vehicleItem.vehicle.id;

    // 3. Get Staff DB ID
    const staffUser = await prisma.user.findUnique({
      where: { publicId: staffId },
      select: { id: true },
    });
    if (!staffUser) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "Staff user not found" });
    }

    // 4. Create Damage Report & Link Photos Transaction
    const damageReportPublicId = createID();

    const result = await prisma.$transaction(async (tx) => {

      // Create Damage Report
      const report = await tx.damageReport.create({
        data: {
          publicId: damageReportPublicId,
          bookingId: booking.id,
          vehicleId: vehicleId,
          status: DamageReportStatus.PENDING,
          severity: severity,
          chargeType: chargeType as DamageChargeType,
          estimatedCost: 0,
          notes: notes ?? {},
        },
      });

      // Link Damage Images
      if (damageImageIds.length > 0) {
        // First find the FileObject IDs
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: damageImageIds } },
        });

        if (files.length !== damageImageIds.length) {
          throw new Error("Some image IDs were invalid");
        }

        await tx.bookingPhoto.createMany({
          data: files.map((f) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.DAMAGE,
            damageReportId: report.id,
          })),
        });
      }

      // Link Return Images
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

      // Capture ODO & Fuel Level - Update Vehicle Status & Booking Status
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          odo: odo,
          fuelLevel: fuelLevel,
          status: VehicleStatus.MANAGER_REPORTED,
        },
      });

      // Only transition to RETURNED if not already (session flow sets it earlier via runPostCompletionHooks)
      if (booking.status !== BookingStatus.RETURNED) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.RETURNED,
          },
        });
      }

      // Abandon any open RETURN payment session — manager will handle full settlement
      const openReturnSession = await tx.paymentSession.findFirst({
        where: {
          bookingId: booking.id,
          sessionType: "RETURN",
          status: { in: ["AWAITING_PAYMENT", "PAYMENT_INITIATED"] },
        },
        select: { id: true },
      });
      if (openReturnSession) {
        await (tx as any).paymentSession.update({
          where: { id: openReturnSession.id },
          data: { status: "ABANDONED" },
        });
      }

      return report;
    }, { timeout: 30000 });

    // Activity log is non-critical — run outside transaction to avoid timeout
    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.DAMAGE_REPORT,
      entityRef: result.publicId,
      description: `Damage report ${result.publicId} created for booking ${booking.publicId}`,
      metadata: { bookingRef: booking.publicId },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Damage Report Created Successfully",
      reportId: result.id,
    });
  } catch (error) {
    console.error("Error creating damage report:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
