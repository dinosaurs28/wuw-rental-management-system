import { PrismaClient } from "./generated/client/index.js";

// Singleton pattern
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Export enums - DO NOT use export *
export {
  Role,
  AuthProvider,
  KycType,
  KycStatus,
  VehicleStatus,
  BookingStatus,
  BookingPhotoType,
  DepositMethod,
  PaymentStatus,
  InvoiceStatus,
  PricingRuleType,
  DamageReportStatus,
  VehicleReturnDisposition,
  AuditCategory,
  AuditSeverity,
  StaffActionType,
  StaffEntityType,
  Prisma,
} from "./generated/client/index.js";

// Export types
export type * from "./generated/client/index.js";
