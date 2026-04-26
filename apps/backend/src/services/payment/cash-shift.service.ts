import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import type { CashShift, Role } from "@repo/database/client";

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

export interface PaginatedShifts {
  shifts: CashShift[];
  total: number;
  page: number;
  pageSize: number;
}

const ZERO = new Decimal(0);

class CashShiftService {
  async open(actor: ActorContext): Promise<CashShift> {
    const existing = await prisma.cashShift.findFirst({
      where: { employeeId: actor.actorId, status: "OPEN" },
    });
    if (existing) throw new Error("You already have an open shift. Close it before starting a new one.");

    const shift = await prisma.cashShift.create({
      data: {
        publicId: createID(),
        employeeId: actor.actorId,
        branchId: actor.actorBranchId,
        status: "OPEN",
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "OPEN_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      description: `Cash shift opened by ${actor.actorName}`,
      entity: "CashShift",
      entityId: shift.publicId,
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId,
      branchName: actor.branchName,
      actionType: StaffActionType.INITIATED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Cash shift opened`,
    });

    return shift;
  }

  async close(publicId: string, actualTotal: number, discrepancyExplanation: string | undefined, actor: ActorContext): Promise<CashShift> {
    const shift = await prisma.cashShift.findUnique({ where: { publicId } });
    if (!shift) throw new Error("Cash shift not found.");
    if (shift.status !== "OPEN") throw new Error(`Shift is already ${shift.status}.`);

    // Only the employee themselves or a manager/admin can close
    if (shift.employeeId !== actor.actorId && actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("You can only close your own shift.");
    }

    const expected = new Decimal(shift.expectedTotal.toString());
    const actual = new Decimal(actualTotal);
    const discrepancy = actual.sub(expected);
    const hasDiscrepancy = !discrepancy.eq(ZERO);

    if (hasDiscrepancy && !discrepancyExplanation) {
      throw new Error(
        `Discrepancy of ₹${discrepancy.toFixed(2)} detected. Please provide a discrepancyExplanation.`,
      );
    }

    const newStatus = hasDiscrepancy ? "DISCREPANCY_FLAGGED" : "CLOSED";

    const updated = await prisma.cashShift.update({
      where: { publicId },
      data: {
        status: newStatus,
        closedAt: new Date(),
        actualTotal: actual,
        discrepancy,
        discrepancyExplanation: discrepancyExplanation ?? null,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: shift.branchId,
      action: "CLOSE_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      severity: hasDiscrepancy ? "WARNING" : "INFO",
      description: `Cash shift closed. Expected: ₹${expected.toFixed(2)}, Actual: ₹${actual.toFixed(2)}, Discrepancy: ₹${discrepancy.toFixed(2)}`,
      entity: "CashShift",
      entityId: shift.publicId,
      after: { status: newStatus, actualTotal, discrepancy: discrepancy.toFixed(2) },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: shift.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.COMPLETED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Cash shift closed${hasDiscrepancy ? ` with discrepancy ₹${discrepancy.toFixed(2)}` : ""}`,
      metadata: { expected: expected.toFixed(2), actual: actual.toFixed(2), discrepancy: discrepancy.toFixed(2) },
    });

    return updated;
  }

  async reconcile(publicId: string, discrepancyExplanation: string, actor: ActorContext): Promise<CashShift> {
    const shift = await prisma.cashShift.findUnique({ where: { publicId } });
    if (!shift) throw new Error("Cash shift not found.");
    if (shift.status !== "DISCREPANCY_FLAGGED") {
      throw new Error("Only DISCREPANCY_FLAGGED shifts can be reconciled.");
    }
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can reconcile shifts.");
    }

    const updated = await prisma.cashShift.update({
      where: { publicId },
      data: {
        status: "CLOSED",
        discrepancyExplanation,
        reconciledById: actor.actorId,
        reconciledAt: new Date(),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: shift.branchId,
      action: "RECONCILE_CASH_SHIFT",
      category: AuditCategory.PAYMENT,
      description: `Cash shift reconciled by manager. Explanation: ${discrepancyExplanation}`,
      entity: "CashShift",
      entityId: shift.publicId,
      before: { status: "DISCREPANCY_FLAGGED" },
      after: { status: "CLOSED", reconciledById: actor.actorId },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: shift.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.RECONCILED,
      entityType: StaffEntityType.CASH_SHIFT,
      entityRef: shift.publicId,
      description: `Cash shift discrepancy reconciled`,
    });

    return updated;
  }

  async getActiveShift(employeeId: number): Promise<any | null> {
    const shift = await prisma.cashShift.findFirst({
      where: { employeeId, status: "OPEN" },
      include: { employee: { select: { name: true } } },
    });
    if (!shift) return null;

    // Sum cash collected but not yet confirmed by manager
    const pending = await prisma.paymentTransaction.aggregate({
      where: { cashShiftId: shift.id, status: "COLLECTED" },
      _sum: { cashAmount: true },
    });

    const pendingTotal = new Decimal(pending._sum.cashAmount?.toString() ?? "0");

    return {
      ...shift,
      employeeName: (shift as any).employee.name,
      expectedTotal: shift.expectedTotal.toString(),
      actualTotal: shift.actualTotal.toString(),
      discrepancy: shift.discrepancy.toString(),
      pendingTotal: pendingTotal.toFixed(2),
    };
  }

  async getByPublicId(publicId: string): Promise<any | null> {
    const shift = await prisma.cashShift.findUnique({
      where: { publicId },
      include: {
        employee: { select: { publicId: true, name: true } },
        reconciledBy: { select: { publicId: true, name: true } },
        transactions: {
          select: {
            publicId: true,
            purpose: true,
            method: true,
            status: true,
            cashAmount: true,
            confirmedAt: true,
          },
        },
      },
    });
    if (!shift) return null;
    return {
      ...shift,
      employeeName: (shift as any).employee.name,
      expectedTotal: shift.expectedTotal.toString(),
      actualTotal: shift.actualTotal.toString(),
      discrepancy: shift.discrepancy.toString(),
    };
  }

  async listForBranch(
    branchId: number,
    filters: { status?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedShifts> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = { branchId };
    if (filters.status) where.status = filters.status;

    const [shifts, total] = await Promise.all([
      prisma.cashShift.findMany({
        where,
        include: { employee: { select: { publicId: true, name: true } } },
        orderBy: { openedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.cashShift.count({ where }),
    ]);

    const mapped = (shifts as any[]).map((s) => ({
      ...s,
      employeeName: s.employee.name,
      expectedTotal: s.expectedTotal.toString(),
      actualTotal: s.actualTotal.toString(),
      discrepancy: s.discrepancy.toString(),
    }));

    return { shifts: mapped as any, total, page, pageSize };
  }

  /**
   * Called internally by paymentTransactionService when cash is confirmed.
   * Increments the shift's expectedTotal.
   */
  async addToExpected(shiftId: number, amount: Decimal): Promise<void> {
    await prisma.cashShift.update({
      where: { id: shiftId },
      data: { expectedTotal: { increment: amount.toNumber() } },
    });
  }
}

export const cashShiftService = new CashShiftService();
