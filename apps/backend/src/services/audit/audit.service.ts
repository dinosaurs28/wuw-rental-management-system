import { prisma, AuditSeverity } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import type { CreateAuditLogInput } from "./audit.types.js";
export { AuditCategory, AuditSeverity } from "@repo/database/client";

type PrismaTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

class AuditService {
  async log(input: CreateAuditLogInput, tx?: PrismaTx): Promise<void> {
    const db = tx ?? prisma;

    const changedFields =
      input.changedFields ??
      (input.before && input.after
        ? this.computeChangedFields(input.before, input.after)
        : []);

    await db.auditLog.create({
      data: {
        publicId: createID(),
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        actorRole: input.actorRole,
        actorBranchId: input.actorBranchId ?? null,
        approverId: input.approverId ?? null,
        approverName: input.approverName ?? null,
        approverRole: input.approverRole ?? null,
        action: input.action,
        category: input.category,
        severity: input.severity ?? AuditSeverity.INFO,
        description: input.description,
        entity: input.entity,
        entityId: input.entityId,
        entityLabel: input.entityLabel ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        changedFields,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async logBatch(inputs: CreateAuditLogInput[], tx?: PrismaTx): Promise<void> {
    const db = tx ?? prisma;
    await db.auditLog.createMany({
      data: inputs.map((input) => ({
        publicId: createID(),
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        actorRole: input.actorRole,
        actorBranchId: input.actorBranchId ?? null,
        approverId: input.approverId ?? null,
        approverName: input.approverName ?? null,
        approverRole: input.approverRole ?? null,
        action: input.action,
        category: input.category,
        severity: input.severity ?? AuditSeverity.INFO,
        description: input.description,
        entity: input.entity,
        entityId: input.entityId,
        entityLabel: input.entityLabel ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        changedFields:
          input.changedFields ??
          (input.before && input.after
            ? this.computeChangedFields(input.before, input.after)
            : []),
        metadata: input.metadata ?? undefined,
      })),
    });
  }

  private computeChangedFields(
    before: Record<string, any>,
    after: Record<string, any>,
  ): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];
    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed.push(key);
      }
    }
    return changed;
  }
}

export const auditService = new AuditService();
