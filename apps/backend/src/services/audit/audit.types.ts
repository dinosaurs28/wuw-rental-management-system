import { AuditCategory, AuditSeverity, Role } from "@repo/database/client";

export type { AuditCategory, AuditSeverity };

export interface CreateAuditLogInput {
  // Identity & Actor
  actorId?: number;
  actorName: string;
  actorRole: Role;
  actorBranchId?: number;

  // Approver
  approverId?: number;
  approverName?: string;
  approverRole?: Role;

  // Action
  action: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  description: string;

  // Entity
  entity: string;
  entityId: string;
  entityLabel?: string;

  // Context (HTTP)
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;

  // Data Changes
  before?: Record<string, any>;
  after?: Record<string, any>;
  changedFields?: string[];

  // Domain metadata
  metadata?: Record<string, any>;
}
