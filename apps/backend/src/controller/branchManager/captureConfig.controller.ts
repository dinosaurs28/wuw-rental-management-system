import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { z } from "zod";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";

const captureFieldSchema = z.object({
  name: z.string().min(1),
  required: z.boolean(),
});

const createCaptureConfigSchema = z.object({
  categoryId: z.string().min(1),
  fields: z.array(captureFieldSchema).min(1),
});

const updateCaptureConfigSchema = z.object({
  fields: z.array(captureFieldSchema).min(1),
});

/**
 * GET /branchManager/capture-configs
 * Returns all capture configs for the manager's branch.
 */
export const GetCaptureConfigs = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  try {
    const configs = await prisma.vehiclePhotoCaptureConfig.findMany({
      where: { branchId },
      include: { category: { select: { publicId: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return res.status(StatusCode.OK).json({ configs });
  } catch (error) {
    console.error("GetCaptureConfigs error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

/**
 * POST /branchManager/capture-configs
 * body: { categoryId: string (publicId), fields: [{ name, required }] }
 */
export const CreateCaptureConfig = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const parsed = createCaptureConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: parsed.error.errors });
  }

  const { categoryId, fields } = parsed.data;

  try {
    const category = await prisma.vehicleCategory.findUnique({ where: { publicId: categoryId } });
    if (!category) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle category not found" });
    }

    const existing = await prisma.vehiclePhotoCaptureConfig.findUnique({
      where: { branchId_categoryId: { branchId, categoryId: category.id } },
    });
    if (existing) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "A capture config already exists for this category. Use PUT to update it." });
    }

    const config = await prisma.vehiclePhotoCaptureConfig.create({
      data: {
        publicId: createID(),
        branchId,
        categoryId: category.id,
        fields,
      },
      include: { category: { select: { publicId: true, name: true } } },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.CAPTURE_CONFIG,
      entityRef: config.publicId,
      description: `Photo capture config created for category ${config.category.name}`,
      metadata: { categoryId, fieldCount: fields.length },
    });

    return res.status(StatusCode.CREATED).json({ message: "Capture config created", config });
  } catch (error) {
    console.error("CreateCaptureConfig error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

/**
 * PUT /branchManager/capture-configs/:publicId
 * body: { fields: [{ name, required }] }
 */
export const UpdateCaptureConfig = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { publicId } = req.params;
  const parsed = updateCaptureConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: parsed.error.errors });
  }

  try {
    const existing = await prisma.vehiclePhotoCaptureConfig.findFirst({
      where: { publicId, branchId },
    });
    if (!existing) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Capture config not found" });
    }

    const config = await prisma.vehiclePhotoCaptureConfig.update({
      where: { id: existing.id },
      data: { fields: parsed.data.fields },
      include: { category: { select: { publicId: true, name: true } } },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.CAPTURE_CONFIG,
      entityRef: config.publicId,
      description: `Photo capture config updated for category ${config.category.name}`,
      metadata: { fieldCount: parsed.data.fields.length },
    });

    return res.status(StatusCode.OK).json({ message: "Capture config updated", config });
  } catch (error) {
    console.error("UpdateCaptureConfig error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

/**
 * DELETE /branchManager/capture-configs/:publicId
 */
export const DeleteCaptureConfig = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { publicId } = req.params;

  try {
    const existing = await prisma.vehiclePhotoCaptureConfig.findFirst({
      where: { publicId, branchId },
    });
    if (!existing) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Capture config not found" });
    }

    await prisma.vehiclePhotoCaptureConfig.delete({ where: { id: existing.id } });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.CAPTURE_CONFIG,
      entityRef: publicId as string,
      description: `Photo capture config ${publicId} deleted`,
    });

    return res.status(StatusCode.OK).json({ message: "Capture config deleted" });
  } catch (error) {
    console.error("DeleteCaptureConfig error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
