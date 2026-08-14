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
  console.log("Starting VRMS seed...");

  // ── Cleanup (order matters for foreign keys) ──────────────────────────────
  console.log("Cleaning up existing data...");

  // Ledger / payment session (deepest dependents first)
  await prisma.ledgerEntry.deleteMany();
  await prisma.paymentSession.deleteMany();

  // Charge engine
  await prisma.chargeOverride.deleteMany();
  await prisma.chargeEntry.deleteMany();

  // Cash & payment transactions
  await prisma.cashShift.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.paymentWebhookLog.deleteMany();
  await prisma.refundRequest.deleteMany();

  // Discount
  await prisma.couponUsageLog.deleteMany();
  await prisma.manualDiscount.deleteMany();
  await prisma.discountApplication.deleteMany();
  await prisma.discountRule.deleteMany();
  await prisma.durationDiscountSlab.deleteMany();

  // Safety deposit
  await prisma.safetyDepositRequest.deleteMany();

  // Fuel
  await prisma.fuelRecord.deleteMany();

  // Feature flags
  await prisma.branchFeatureFlag.deleteMany();
  await prisma.vehicleFeatureFlag.deleteMany();
  await prisma.featureFlag.deleteMany();

  // Activity / audit
  await prisma.staffActivityLog.deleteMany();
  await prisma.auditLog.deleteMany();

  // Auth
  await prisma.userProvider.deleteMany();
  await prisma.emailVerificationOtp.deleteMany();

  // KYC
  await prisma.customerKyc.deleteMany();

  // Booking dependents
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

  // Vehicle dependents
  await prisma.vehicleMaintenanceRecord.deleteMany();
  await prisma.vehicleInsurance.deleteMany();
  await prisma.vehiclePricingOverride.deleteMany();
  await prisma.vehicleCustomPricing.deleteMany();
  await prisma.vehicleImage.deleteMany();
  await prisma.vehicle.deleteMany();

  // Pricing
  await prisma.branchPricingDefaults.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.pricingDiscountSlab.deleteMany();

  // Users
  await prisma.user.deleteMany();

  // Branch config
  await prisma.categoryDepositSetting.deleteMany();
  await prisma.branchPricingSetting.deleteMany();
  await prisma.branchChargeConfig.deleteMany();
  await prisma.branchDiscountConfig.deleteMany();
  await prisma.branchPaymentConfig.deleteMany();
  await prisma.gSTRule.deleteMany();
  await prisma.vehiclePhotoCaptureConfig.deleteMany();
  await prisma.branchSchedule.deleteMany();

  // Branch / category
  await prisma.branch.deleteMany();
  await prisma.vehicleCategory.deleteMany();

  // Misc
  await prisma.fileObject.deleteMany();

  console.log("Cleanup complete. Creating new data...");

  // ── 1. Vehicle Categories ─────────────────────────────────────────────────
  const twoWheeler = await prisma.vehicleCategory.create({
    data: {
      publicId: nanoid(),
      name: "Two Wheeler",
      description: "Bikes & Scooters",
      typeClass: "TWO_WHEELER",
    },
  });

  const fourWheeler = await prisma.vehicleCategory.create({
    data: {
      publicId: nanoid(),
      name: "Four Wheeler",
      description: "Cars, SUVs",
      typeClass: "FOUR_WHEELER",
    },
  });

  // ── 2. Branch ─────────────────────────────────────────────────────────────
  const manipalBranch = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Manipal Central",
      address: "Near MIT Campus, Manipal, Udupi",
      phone: "9876543210",
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

  // ── 3. Branch Schedule ────────────────────────────────────────────────────
  // Mon–Sat open 9AM–10PM, Sunday closed, 30-min grace
  await prisma.branch.update({
    where: { id: manipalBranch.id },
    data: { graceMinutes: 30, is24Hours: false },
  });

  const scheduleRows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    branchId: manipalBranch.id,
    dayOfWeek: day,
    isOpen: day !== 0, // Sunday (0) closed
    openTime: "09:00",
    closeTime: "22:00",
  }));
  await prisma.branchSchedule.createMany({ data: scheduleRows });

  // ── 4. Branch Charge Config ───────────────────────────────────────────────
  await prisma.branchChargeConfig.create({
    data: {
      publicId: nanoid(),
      branchId: manipalBranch.id,
      extraKmEnabled: true,
      extraTimeEnabled: true,
      fuelModuleEnabled: true,
      fastagModuleEnabled: true,
      gracePolicyEnabled: true,
      damageModuleEnabled: false,
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
      branchId: manipalBranch.id,
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
      branchId: manipalBranch.id,
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
      branchId: manipalBranch.id,
      gstNumber: "29ABCDE1234F1Z5",
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
        branchId: manipalBranch.id,
        categoryId: twoWheeler.id,
        hourlyRate: 80,
        price12Hour: 450,
        price24Hour: 800,
        priceMonthly: 15000,
      },
      {
        publicId: nanoid(),
        branchId: manipalBranch.id,
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
      // 3–6 days: 5% off
      { branchId: manipalBranch.id, minDays: 3, maxDays: 6,  discountType: "PERCENTAGE", value: 5,  label: "Short stay" },
      // 7–13 days: 10% off
      { branchId: manipalBranch.id, minDays: 7, maxDays: 13, discountType: "PERCENTAGE", value: 10, label: "Weekly" },
      // 14–29 days: 15% off
      { branchId: manipalBranch.id, minDays: 14, maxDays: 29, discountType: "PERCENTAGE", value: 15, label: "Bi-weekly" },
      // 30+ days: 20% off
      { branchId: manipalBranch.id, minDays: 30, maxDays: null, discountType: "PERCENTAGE", value: 20, label: "Monthly" },
    ],
  });

  // ── 9. Category Deposit Settings ──────────────────────────────────────────
  await prisma.categoryDepositSetting.createMany({
    data: [
      { branchId: manipalBranch.id, categoryId: twoWheeler.id,  amount: 1000 },
      { branchId: manipalBranch.id, categoryId: fourWheeler.id, amount: 5000 },
    ],
  });

  // ── 10. Vehicle Photo Capture Config ──────────────────────────────────────
  await prisma.vehiclePhotoCaptureConfig.createMany({
    data: [
      {
        publicId: nanoid(),
        branchId: manipalBranch.id,
        categoryId: twoWheeler.id,
        fields: [
          { name: "front",       required: true  },
          { name: "left_side",   required: true  },
          { name: "right_side",  required: true  },
          { name: "odometer",    required: true  },
          { name: "fuel_gauge",  required: false },
        ],
      },
      {
        publicId: nanoid(),
        branchId: manipalBranch.id,
        categoryId: fourWheeler.id,
        fields: [
          { name: "front",       required: true  },
          { name: "rear",        required: true  },
          { name: "left_side",   required: true  },
          { name: "right_side",  required: true  },
          { name: "odometer",    required: true  },
          { name: "fuel_gauge",  required: false },
          { name: "dashboard",   required: false },
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

  // ── 12. Users ─────────────────────────────────────────────────────────────
  const passwordHash =
    "$2a$10$C4fvLnge/TjgAjXiez26YeKCstsvpjdby.shoMyIZePHgGo5UixDG"; // Markjeo076&

  const admin = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Admin User",
      email: "admin@vrms.com",
      passwordHash,
      role: Role.ADMIN,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "admin@vrms.com",
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Branch Manager",
      email: "manager@vrms.com",
      passwordHash,
      role: Role.MANAGER,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      branchId: manipalBranch.id,
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "manager@vrms.com",
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Staff Member",
      email: "staff@vrms.com",
      passwordHash,
      role: Role.STAFF,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      branchId: manipalBranch.id,
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "staff@vrms.com",
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "John Customer",
      email: "customer@vrms.com",
      passwordHash,
      role: Role.CUSTOMER,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "customer@vrms.com",
        },
      },
      customerProfile: {
        create: {
          publicId: nanoid(),
          addressLine1: "123 Main St",
          city: "Manipal",
          state: "Karnataka",
          zipCode: "576104",
          isProfileCompleted: true,
        },
      },
    },
  });

  // ── 13. Vehicles (2 per category) ─────────────────────────────────────────

  // Two Wheelers
  await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Honda",
      model: "Activa 6G",
      regNo: "KA20AB1001",
      odo: 12000,
      fuelLevel: 100,
      insuranceExpiry: new Date("2027-03-31T00:00:00+05:30"),
      branchId: manipalBranch.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL-2W-001",
          provider: "ICICI Lombard",
          validTill: new Date("2027-03-31T00:00:00+05:30"),
        },
      },
      maintenance: {
        create: {
          publicId: nanoid(),
          description: "Oil change + brake service",
          cost: 1500,
          servicedAt: new Date("2025-11-15T00:00:00+05:30"),
        },
      },
    },
  });

  await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "TVS",
      model: "Jupiter Classic",
      regNo: "KA20AB1002",
      odo: 8500,
      fuelLevel: 75,
      insuranceExpiry: new Date("2027-06-30T00:00:00+05:30"),
      branchId: manipalBranch.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      customPricing: {
        create: {
          publicId: nanoid(),
          hourlyRate: 90,
          price12Hour: 500,
          price24Hour: 900,
          priceMonthly: 16000,
          enabled: true,
        },
      },
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL-2W-002",
          provider: "Bajaj Allianz",
          validTill: new Date("2027-06-30T00:00:00+05:30"),
        },
      },
    },
  });

  // Four Wheelers
  await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Maruti Suzuki",
      model: "Swift VXI",
      regNo: "KA20CD2001",
      odo: 34000,
      fuelLevel: 80,
      insuranceExpiry: new Date("2027-03-31T00:00:00+05:30"),
      branchId: manipalBranch.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE,
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL-4W-001",
          provider: "HDFC Ergo",
          validTill: new Date("2027-03-31T00:00:00+05:30"),
        },
      },
      maintenance: {
        create: {
          publicId: nanoid(),
          description: "AC gas refill + wheel alignment",
          cost: 3500,
          servicedAt: new Date("2025-10-20T00:00:00+05:30"),
        },
      },
    },
  });

  await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Hyundai",
      model: "Grand i10 Nios",
      regNo: "KA20CD2002",
      odo: 21000,
      fuelLevel: 60,
      insuranceExpiry: new Date("2027-09-30T00:00:00+05:30"),
      branchId: manipalBranch.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE,
      customPricing: {
        create: {
          publicId: nanoid(),
          hourlyRate: 175,
          price12Hour: 1000,
          price24Hour: 1800,
          priceMonthly: 38000,
          enabled: true,
        },
      },
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL-4W-002",
          provider: "New India Assurance",
          validTill: new Date("2027-09-30T00:00:00+05:30"),
        },
      },
    },
  });

  // ── 14. Discount Rules (sample coupons) ───────────────────────────────────
  await prisma.discountRule.createMany({
    data: [
      {
        publicId: nanoid(),
        code: "WELCOME10",
        name: "Welcome Discount",
        description: "10% off for new customers",
        discountType: "PERCENTAGE",
        value: 10,
        maxDiscountCap: 200,
        scope: "GLOBAL",
        applicableBranchIds: [],
        targetCustomerIds: [],
        newCustomersOnly: true,
        applicableVehicleCategoryIds: [],
        applicablePaymentPlans: [],
        allowPartialPayment: true,
        allowPostBooking: false,
        allowPostInvoice: false,
        stackable: false,
        priority: 10,
        startDate: new Date("2026-01-01T00:00:00+05:30"),
        endDate:   new Date("2027-12-31T23:59:59+05:30"),
        isActive: true,
        createdById: admin.id,
      },
      {
        publicId: nanoid(),
        code: "FLAT100",
        name: "Flat ₹100 Off",
        description: "Flat ₹100 discount on any booking",
        discountType: "FLAT",
        value: 100,
        scope: "GLOBAL",
        applicableBranchIds: [],
        targetCustomerIds: [],
        newCustomersOnly: false,
        applicableVehicleCategoryIds: [],
        applicablePaymentPlans: [],
        allowPartialPayment: true,
        allowPostBooking: false,
        allowPostInvoice: false,
        stackable: false,
        priority: 5,
        startDate: new Date("2026-01-01T00:00:00+05:30"),
        endDate:   new Date("2027-12-31T23:59:59+05:30"),
        isActive: true,
        createdById: admin.id,
      },
    ],
  });

  // ── 15. Feature Flags ─────────────────────────────────────────────────────
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
      branchId: manipalBranch.id,
      flagId: branchDiscountFlag.id,
      enabled: true,
    },
  });

  // ── 16. Timezone & System Settings ───────────────────────────────────────
  await prisma.timezoneSetting.upsert({
    where: { id: 1 },
    create: { publicId: nanoid(), timezone: "Asia/Kolkata", enabled: true },
    update: { timezone: "Asia/Kolkata", enabled: true },
  });

  console.log("VRMS seed completed successfully!");
  console.log({
    branch: "Manipal Central",
    vehicles: "2x Two Wheeler (Activa 6G, Jupiter Classic) · 2x Four Wheeler (Swift VXI, Grand i10 Nios)",
    admin:    { email: "admin@vrms.com",    password: "Markjeo076&" },
    manager:  { email: "manager@vrms.com",  password: "Markjeo076&" },
    staff:    { email: "staff@vrms.com",    password: "Markjeo076&" },
    customer: { email: "customer@vrms.com", password: "Markjeo076&" },
  });
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
