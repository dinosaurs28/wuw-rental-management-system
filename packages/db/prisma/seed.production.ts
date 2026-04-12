/// <reference types="node" />

import {
  Role,
  AuthProvider,
  PricingRuleType,
  VehicleStatus,
  prisma,
} from "@repo/database/client";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);

async function main() {
  console.log("Starting VRMS production seed...");

  // ── Cleanup (order matters for foreign keys) ──────────────────────────────
  console.log("Cleaning up existing data...");

  await prisma.ledgerEntry.deleteMany();
  await prisma.paymentSession.deleteMany();
  await prisma.chargeOverride.deleteMany();
  await prisma.chargeEntry.deleteMany();
  await prisma.cashShift.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.paymentWebhookLog.deleteMany();
  await prisma.refundRequest.deleteMany();
  await prisma.couponUsageLog.deleteMany();
  await prisma.manualDiscount.deleteMany();
  await prisma.discountApplication.deleteMany();
  await prisma.discountRule.deleteMany();
  await prisma.durationDiscountSlab.deleteMany();
  await prisma.safetyDepositRequest.deleteMany();
  await prisma.fuelRecord.deleteMany();
  await prisma.branchFeatureFlag.deleteMany();
  await prisma.vehicleFeatureFlag.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.staffActivityLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userProvider.deleteMany();
  await prisma.emailVerificationOtp.deleteMany();
  await prisma.customerKyc.deleteMany();
  await prisma.vehicleSwap.deleteMany();
  await prisma.bookingExtension.deleteMany();
  await prisma.cancellationInvoice.deleteMany();
  await prisma.bookingItem.deleteMany();
  await prisma.bookingPhoto.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.damageReport.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.vehicleMaintenanceRecord.deleteMany();
  await prisma.vehicleInsurance.deleteMany();
  await prisma.vehiclePricingOverride.deleteMany();
  await prisma.vehicleCustomPricing.deleteMany();
  await prisma.vehicleImage.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.branchPricingDefaults.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.pricingDiscountSlab.deleteMany();
  await prisma.user.deleteMany();
  await prisma.categoryDepositSetting.deleteMany();
  await prisma.branchPricingSetting.deleteMany();
  await prisma.branchChargeConfig.deleteMany();
  await prisma.branchDiscountConfig.deleteMany();
  await prisma.branchPaymentConfig.deleteMany();
  await prisma.gSTRule.deleteMany();
  await prisma.vehiclePhotoCaptureConfig.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.vehicleCategory.deleteMany();
  await prisma.fileObject.deleteMany();

  console.log("Cleanup complete. Creating production data...");

  // ── 1. Vehicle Categories ─────────────────────────────────────────────────
  const twoWheeler = await prisma.vehicleCategory.create({
    data: {
      publicId: nanoid(),
      name: "Two Wheeler",
      description: "Bikes & Scooters",
    },
  });

  const fourWheeler = await prisma.vehicleCategory.create({
    data: {
      publicId: nanoid(),
      name: "Four Wheeler",
      description: "Cars, SUVs",
    },
  });

  // ── 2. Branch ─────────────────────────────────────────────────────────────
  const mainBranch = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Manipal",
      address: "Main Branch Address", // ← update this
      phone: "9999999999",            // ← update this
      pricingSetting: {
        create: {
          weekendEnabled: true,
          peakEnabled: false,
          customEnabled: false,
          weekendMultiplier: 1.2,
          peakMultiplier: 1.5,
          customMultiplier: 1.0,
        },
      },
    },
  });

  // ── 3. Branch Charge Config ───────────────────────────────────────────────
  await prisma.branchChargeConfig.create({
    data: {
      publicId: nanoid(),
      branchId: mainBranch.id,
      extraKmEnabled: true,
      extraTimeEnabled: true,
      fuelModuleEnabled: true,
      fastagModuleEnabled: true,
      gracePolicyEnabled: true,
      damageModuleEnabled: true,
      graceType: "MANUAL",
      graceMinutes: 15,
      employeeOverrideEnabled: false,
      safetyDepositEnabled: true,
      safetyDepositRequiresApproval: true,
      usePaymentSessions: false,
    },
  });

  // ── 4. Branch Discount Config ─────────────────────────────────────────────
  await prisma.branchDiscountConfig.create({
    data: {
      branchId: mainBranch.id,
      durationDiscountEnabled: true,
      stackWithCoupon: false,
      maxCombinedDiscountPercent: 30,
      managerApprovalThreshold: 500,
      maxManualDiscountsPerEmployeePerDay: 5,
      managerCouponCreationEnabled: true,
      maxManagerCouponDiscountPercent: 15,
      maxManagerCouponFlatAmount: 500,
      maxManagerCouponValidityDays: 7,
      maxManagerCouponUsageLimit: 5,
      maxManagerCouponsPerDay: 3,
    },
  });

  // ── 5. Branch Payment Config ──────────────────────────────────────────────
  await prisma.branchPaymentConfig.create({
    data: {
      branchId: mainBranch.id,
      cashConfirmationEnabled: false,
      blockProgressionUntilConfirmed: true,
      requireShiftSettlement: false,
      splitPaymentEnabled: false,
      crossBranchSettlementEnabled: false,
      refundApprovalRequired: true,
      onlineRefundEnabled: true,
      delayedCashAlertHours: 2,
    },
  });

  // ── 6. GST Rule ───────────────────────────────────────────────────────────
  await prisma.gSTRule.create({
    data: {
      publicId: nanoid(),
      branchId: mainBranch.id,
      gstNumber: "IST2121", // ← update this
      cgstRate: 9.0,
      sgstRate: 9.0,
      igstRate: 0.0,
    },
  });

  // ── 7. Branch Pricing Defaults ────────────────────────────────────────────
  await prisma.branchPricingDefaults.createMany({
    data: [
      {
        publicId: nanoid(),
        branchId: mainBranch.id,
        categoryId: twoWheeler.id,
        hourlyRate: 80,
        price12Hour: 450,
        price24Hour: 800,
        priceMonthly: 15000,
      },
      {
        publicId: nanoid(),
        branchId: mainBranch.id,
        categoryId: fourWheeler.id,
        hourlyRate: 150,
        price12Hour: 900,
        price24Hour: 1500,
        priceMonthly: 35000,
      },
    ],
  });

  // ── 8. Duration Discount Slabs ────────────────────────────────────────────
  await prisma.durationDiscountSlab.createMany({
    data: [
      { branchId: mainBranch.id, minDays: 3,  maxDays: 6,    discountType: "PERCENTAGE", value: 5,  label: "Short stay" },
      { branchId: mainBranch.id, minDays: 7,  maxDays: 13,   discountType: "PERCENTAGE", value: 10, label: "Weekly" },
      { branchId: mainBranch.id, minDays: 14, maxDays: 29,   discountType: "PERCENTAGE", value: 15, label: "Bi-weekly" },
      { branchId: mainBranch.id, minDays: 30, maxDays: null, discountType: "PERCENTAGE", value: 20, label: "Monthly" },
    ],
  });

  // ── 9. Category Deposit Settings ──────────────────────────────────────────
  await prisma.categoryDepositSetting.createMany({
    data: [
      { branchId: mainBranch.id, categoryId: twoWheeler.id,  amount: 1000 },
      { branchId: mainBranch.id, categoryId: fourWheeler.id, amount: 5000 },
    ],
  });

  // ── 10. Vehicle Photo Capture Config ──────────────────────────────────────
  await prisma.vehiclePhotoCaptureConfig.createMany({
    data: [
      {
        publicId: nanoid(),
        branchId: mainBranch.id,
        categoryId: twoWheeler.id,
        fields: [
          { name: "front",      required: true  },
          { name: "left_side",  required: true  },
          { name: "right_side", required: true  },
          { name: "odometer",   required: true  },
          { name: "fuel_gauge", required: false },
        ],
      },
      {
        publicId: nanoid(),
        branchId: mainBranch.id,
        categoryId: fourWheeler.id,
        fields: [
          { name: "front",      required: true  },
          { name: "rear",       required: true  },
          { name: "left_side",  required: true  },
          { name: "right_side", required: true  },
          { name: "odometer",   required: true  },
          { name: "fuel_gauge", required: false },
          { name: "dashboard",  required: false },
        ],
      },
    ],
  });

  // ── 11. Global Pricing Rules ──────────────────────────────────────────────
  await prisma.pricingRule.createMany({
    data: [
      { publicId: nanoid(), ruleType: PricingRuleType.WEEKDAY, multiplier: 1.0 },
      { publicId: nanoid(), ruleType: PricingRuleType.WEEKEND, multiplier: 1.25 },
      { publicId: nanoid(), ruleType: PricingRuleType.PEAK,    multiplier: 1.5, categoryId: fourWheeler.id },
    ],
  });

  // ── 12. Admin User ────────────────────────────────────────────────────────
  // Replace the hash below with your own bcrypt hash before running.
  // Generate one via: node -e "const b=require('bcrypt');b.hash('YourPassword',10).then(console.log)"
  const adminPasswordHash = "$2a$10$C4fvLnge/TjgAjXiez26YeKCstsvpjdby.shoMyIZePHgGo5UixDG";

  await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Admin",
      email: "admin@wuw.com",
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "admin@wuw.com",
        },
      },
    },
  });

  // ── 13. Feature Flags ─────────────────────────────────────────────────────
  await prisma.featureFlag.create({
    data: {
      publicId: nanoid(),
      key: "system_maintenance",
      name: "System Maintenance Mode",
      scope: "SYSTEM",
      enabled: false,
    },
  });

  const branchDiscountFlag = await prisma.featureFlag.create({
    data: {
      publicId: nanoid(),
      key: "branch_discount",
      name: "Branch Discount",
      scope: "BRANCH",
      enabled: true,
    },
  });

  await prisma.branchFeatureFlag.create({
    data: {
      branchId: mainBranch.id,
      flagId: branchDiscountFlag.id,
      enabled: true,
    },
  });

  // ── 14. Timezone & System Settings ────────────────────────────────────────
  await prisma.timezoneSetting.upsert({
    where: { id: 1 },
    create: { publicId: nanoid(), timezone: "Asia/Kolkata", enabled: true },
    update: { timezone: "Asia/Kolkata", enabled: true },
  });

  console.log("\nVRMS production seed completed successfully!");
  console.log("-------------------------------------------");
  console.log("Admin email   : admin@wuw.com");
  console.log("Admin password: (the password you hashed above)");
  console.log("Branch        : WUW Rentals - Main Branch");
  console.log("-------------------------------------------");
  console.log("Next steps:");
  console.log("  1. Log in as admin@wuw.com");
  console.log("  2. Update branch name, address, phone, and GST number");
  console.log("  3. Add vehicles via the admin panel");
  console.log("  4. Create manager / staff accounts as needed");
}

import * as fs from "fs";

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    fs.writeFileSync(
      "seed_failure.txt",
      JSON.stringify(err, null, 2) + "\n" + err.toString(),
    );
    await prisma.$disconnect();
    process.exit(1);
  });
