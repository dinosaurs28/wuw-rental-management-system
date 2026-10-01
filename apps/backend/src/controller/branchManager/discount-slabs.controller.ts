import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createDurationSlabSchema, updateDurationSlabSchema, durationSlabIssues } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { redis } from "../../lib/redisconfig.js";

export const GetDurationSlabs = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabs = await prisma.durationDiscountSlab.findMany({
      where: { branchId },
      orderBy: { minDays: "asc" },
    });
    return res.status(StatusCode.OK).json({ data: slabs });
  } catch (error) {
    console.error("GetDurationSlabs Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const CreateDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const validation = createDurationSlabSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const { minDays, maxDays, discountType, value, label } = validation.data;

    // Check overlap with existing slabs
    const overlap = await findOverlappingSlab(branchId!, minDays, maxDays ?? null);
    if (overlap) {
      return res.status(StatusCode.CONFLICT).json(overlapError(overlap));
    }

    const slab = await prisma.durationDiscountSlab.create({
      data: { branchId, minDays, maxDays: maxDays ?? null, discountType, value, label: label ?? null },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slab.id),
      description: `Duration discount slab created: ${minDays}–${maxDays ?? "∞"} days, ${value}${discountType === "PERCENTAGE" ? "%" : "₹"} off`,
      metadata: { minDays, maxDays, discountType, value },
    });

    // TASK-012f: Invalidate all cached slab lookups for this branch
    await invalidateDurationSlabCache(branchId).catch((err) =>
      console.warn("[pricing-cache] Failed to invalidate slab cache (non-fatal):", err),
    );

    return res.status(StatusCode.CREATED).json({ message: "Duration slab created", data: slab });
  } catch (error) {
    console.error("CreateDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const UpdateDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabId = parseInt(req.params.id!);
    if (isNaN(slabId)) return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid slab ID" });

    const existing = await prisma.durationDiscountSlab.findUnique({ where: { id: slabId } });
    if (!existing || existing.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Slab not found" });
    }

    const validation = updateDurationSlabSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    // Validate the slab as it will be after the patch (a partial update can't
    // dodge the ≤100% / maxDays ≥ minDays rules or the overlap check)
    const merged = {
      minDays: validation.data.minDays ?? existing.minDays,
      maxDays: validation.data.maxDays !== undefined ? validation.data.maxDays : existing.maxDays,
      discountType: validation.data.discountType ?? existing.discountType,
      value: validation.data.value ?? Number(existing.value),
    };
    const issues = durationSlabIssues(merged);
    if (issues.length > 0) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "INVALID_SLAB",
        message: issues.map((i) => i.message).join("; "),
        errors: issues,
      });
    }
    const overlap = await findOverlappingSlab(branchId!, merged.minDays, merged.maxDays ?? null, slabId);
    if (overlap) {
      return res.status(StatusCode.CONFLICT).json(overlapError(overlap));
    }

    const updated = await prisma.durationDiscountSlab.update({
      where: { id: slabId },
      data: {
        ...(validation.data.minDays != null && { minDays: validation.data.minDays }),
        ...(validation.data.maxDays !== undefined && { maxDays: validation.data.maxDays ?? null }),
        ...(validation.data.discountType && { discountType: validation.data.discountType }),
        ...(validation.data.value != null && { value: validation.data.value }),
        ...(validation.data.label !== undefined && { label: validation.data.label ?? null }),
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Duration discount slab ${slabId} updated`,
    });

    // TASK-012f: Invalidate all cached slab lookups for this branch
    await invalidateDurationSlabCache(branchId).catch((err) =>
      console.warn("[pricing-cache] Failed to invalidate slab cache (non-fatal):", err),
    );

    return res.status(StatusCode.OK).json({ message: "Duration slab updated", data: updated });
  } catch (error) {
    console.error("UpdateDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const DeleteDurationSlab = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const slabId = parseInt(req.params.id!);
    if (isNaN(slabId)) return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid slab ID" });

    const existing = await prisma.durationDiscountSlab.findUnique({ where: { id: slabId } });
    if (!existing || existing.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Slab not found" });
    }

    await prisma.durationDiscountSlab.delete({ where: { id: slabId } });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(slabId),
      description: `Duration discount slab ${slabId} deleted`,
    });

    // TASK-012f: Invalidate all cached slab lookups for this branch
    await invalidateDurationSlabCache(branchId).catch((err) =>
      console.warn("[pricing-cache] Failed to invalidate slab cache (non-fatal):", err),
    );

    return res.status(StatusCode.OK).json({ message: "Duration slab deleted" });
  } catch (error) {
    console.error("DeleteDurationSlab Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

// ── Overlap check ─────────────────────────────────────────────────────────────

/**
 * An existing slab of the branch whose [minDays, maxDays ?? ∞] range intersects
 * [minDays, maxDays ?? ∞] — covers a new range inside, around or open-ended over
 * an existing one. excludeId skips the slab being edited.
 */
async function findOverlappingSlab(
  branchId: number,
  minDays: number,
  maxDays: number | null,
  excludeId?: number,
) {
  return prisma.durationDiscountSlab.findFirst({
    where: {
      branchId,
      ...(excludeId != null && { id: { not: excludeId } }),
      ...(maxDays != null && { minDays: { lte: maxDays } }),
      OR: [{ maxDays: null }, { maxDays: { gte: minDays } }],
    },
    orderBy: { minDays: "asc" },
  });
}

function overlapError(slab: { minDays: number; maxDays: number | null; label: string | null }) {
  const range = `${slab.minDays}–${slab.maxDays ?? "∞"} days`;
  return {
    code: "SLAB_OVERLAP",
    message: `Day range overlaps the existing slab ${slab.label ? `"${slab.label}" ` : ""}(${range}).`,
  };
}

// ── Cache invalidation helper (TASK-012f) ─────────────────────────────────────

/** Delete all cached duration-slab lookups for a branch (pattern: discount-slab:branch:{branchId}:days:*). */
async function invalidateDurationSlabCache(branchId: number): Promise<void> {
  const pattern = `discount-slab:branch:${branchId}:days:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
