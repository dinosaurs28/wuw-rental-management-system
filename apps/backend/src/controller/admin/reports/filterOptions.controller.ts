import type { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { handleReportError } from "../../../utils/reporting/index.js";

/**
 * GET /api/admin/dashboard/reports/filter-options
 * Branches, categories and vehicles (publicIds) for the shared ReportFilterBar.
 * Read-only. Inactive/deleted vehicles are included only if they still exist
 * (not soft-deleted) so historic reports can still filter on them.
 */
export const GetReportFilterOptions = async (_req: Request, res: Response) => {
  try {
    const [branches, categories, vehicles] = await Promise.all([
      prisma.branch.findMany({
        where: { deletedAt: null },
        select: { publicId: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.vehicleCategory.findMany({
        select: { publicId: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.vehicle.findMany({
        where: { deletedAt: null },
        select: {
          publicId: true,
          regNo: true,
          make: true,
          model: true,
          branch: { select: { publicId: true } },
          category: { select: { publicId: true } },
        },
        orderBy: { regNo: "asc" },
      }),
    ]);
    res.json({
      branches,
      categories,
      vehicles: vehicles.map((v) => ({
        publicId: v.publicId,
        regNo: v.regNo,
        name: `${v.make} ${v.model}`.trim(),
        branchPublicId: v.branch.publicId,
        categoryPublicId: v.category.publicId,
      })),
    });
  } catch (err) {
    handleReportError(res, err, "report filter options");
  }
};
