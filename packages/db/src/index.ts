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
  SwapReason,
  PaymentPurpose,
  PaymentMethod,
  ExtensionStatus,
  ExtensionTrigger,
  ExtensionResolutionType,
  // Discount enums
  DiscountType,
  DiscountScope,
  AdjustmentType,
  ManualDiscountStatus,
  // Charge Engine enums
  GraceType,
  ChargeType,
  OverrideStatus,
  SafetyDepositStatus,
  RentalPeriodType,
  DamageChargeType,
  CreditStatus,
  PaymentTransactionStatus,
  RefundStatus,
  CashShiftStatus,
  FeatureFlagScope,
  // Payment session / ledger enums
  PaymentSessionStatus,
  PaymentSessionType,
  LedgerEntryType,
  LedgerEntryClassification,
  Prisma,
  KycSide,
  VehicleTypeClass
} from "./generated/client/index.js";

// Export types
export type * from "./generated/client/index.js";
