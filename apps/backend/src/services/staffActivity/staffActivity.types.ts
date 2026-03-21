import type { StaffActionType, StaffEntityType, Role } from "@repo/database/client";

export type { StaffActionType, StaffEntityType };

export interface CreateStaffActivityInput {
  actorPublicId: string;
  actorName: string;
  actorRole: Role;
  branchId: number;
  branchName: string;
  actionType: StaffActionType;
  entityType: StaffEntityType;
  entityRef: string ;
  description: string;
  metadata?: Record<string, any>;
}
