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

  // Cleanup existing data
  console.log("Cleaning up existing data...");
  await prisma.vehicleMaintenanceRecord.deleteMany();
  await prisma.vehicleInsurance.deleteMany();
  await prisma.vehiclePricingOverride.deleteMany();
  await prisma.vehicleCustomPricing.deleteMany();
  await prisma.branchPricingDefaults.deleteMany();
  await prisma.vehicleImage.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.pricingRule.deleteMany();

  // Clean up order matters for foreign keys
  await prisma.staffActivityLog.deleteMany();
  await prisma.userProvider.deleteMany();
  await prisma.emailVerificationOtp.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.customerKyc.deleteMany();
  await prisma.bookingItem.deleteMany();
  await prisma.bookingPhoto.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.damageReport.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.customer.deleteMany();

  // Delete users last (except for branch dependencies)
  await prisma.user.deleteMany();

  await prisma.categoryDepositSetting.deleteMany();
  await prisma.pricingDiscountSlab.deleteMany();
  await prisma.branchPricingSetting.deleteMany();
  await prisma.gSTRule.deleteMany();
  await prisma.branch.deleteMany();
  // await prisma.rentalPlan.deleteMany(); // Model does not exist
  await prisma.vehicleCategory.deleteMany();
  await prisma.fileObject.deleteMany();

  console.log("Cleanup complete. Creating new data...");

  // 1. Branches
  const mangaloreBranch = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Mangalore Central",
      address: "Near KSRTC Bus Stand, Mangalore",
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

  const udupiBranch = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Udupi Station",
      address: "Near Railway Station, Udupi",
      phone: "9876543211",
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

  // 2. Users
  const passwordHash =
    "$2a$10$C4fvLnge/TjgAjXiez26YeKCstsvpjdby.shoMyIZePHgGo5UixDG"; // Markjeo076&

  // Admin
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

  // Manager
  const manager = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Branch Manager",
      email: "manager@vrms.com",
      passwordHash,
      role: Role.MANAGER,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      branchId: mangaloreBranch.id,
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "manager@vrms.com",
        },
      },
    },
  });

  // Staff
  const staff = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Staff Member",
      email: "staff@vrms.com",
      passwordHash,
      role: Role.STAFF,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
      branchId: mangaloreBranch.id,
      providers: {
        create: {
          publicId: nanoid(),
          provider: AuthProvider.PASSWORD,
          providerUserId: "staff@vrms.com",
        },
      },
    },
  });

  // Customer
  const customerUser = await prisma.user.create({
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
          city: "Mangalore",
          state: "Karnataka",
          zipCode: "575001",
          isProfileCompleted: true,
        },
      },
    },
  });

  // 3. Vehicle Categories
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

  // 3.5. Pricing Defaults
  await prisma.branchPricingDefaults.createMany({
    data: [
      {
        publicId: nanoid(),
        branchId: mangaloreBranch.id,
        categoryId: twoWheeler.id,
        hourlyRate: 80,
        price12Hour: 450,
        price24Hour: 800,
        priceMonthly: 15000,
      },
      {
        publicId: nanoid(),
        branchId: udupiBranch.id,
        categoryId: twoWheeler.id,
        hourlyRate: 80,
        price12Hour: 500,
        price24Hour: 900,
        priceMonthly: 16000,
      },
      {
        publicId: nanoid(),
        branchId: mangaloreBranch.id,
        categoryId: fourWheeler.id,
        hourlyRate: 150,
        price12Hour: 900,
        price24Hour: 1500,
        priceMonthly: 35000,
      },
      {
        publicId: nanoid(),
        branchId: udupiBranch.id,
        categoryId: fourWheeler.id,
        hourlyRate: 160,
        price12Hour: 1000,
        price24Hour: 1800,
        priceMonthly: 38000,
      },
    ],
  });

  // 4. Vehicles
  // Activa (Mangalore, 2W)
  const activa = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Honda",
      model: "Activa 6G",
      regNo: "KA19AB1234",
      odo: 12000,
      fuelLevel: 100,
      insuranceExpiry: new Date("2026-12-31T00:00:00+05:30"), // Valid
      branchId: mangaloreBranch.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL1001",
          provider: "ICICI Lombard",
          validTill: new Date("2026-01-01T00:00:00+05:30"),
        },
      },
      maintenance: {
        create: {
          publicId: nanoid(),
          description: "Oil change + brake service",
          cost: 1500,
          servicedAt: new Date("2024-09-20T00:00:00+05:30"),
        },
      },
    },
  });

  // Dio (Mangalore, 2W)
  const dio = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Honda",
      model: "Dio BS6",
      regNo: "KA19CD5678",
      odo: 8000,
      fuelLevel: 80,
      insuranceExpiry: new Date("2026-06-01T00:00:00+05:30"), // Valid
      branchId: mangaloreBranch.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      customPricing: {
        create: {
          publicId: nanoid(),
          hourlyRate: 100,
          price12Hour: 600,
          price24Hour: 1000,
          priceMonthly: 18000,
          enabled: true,
        },
      },
    },
  });

  // Swift (Udupi, 4W)
  const swift = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Maruti Suzuki",
      model: "Swift VXI",
      regNo: "KA20EF4321",
      odo: 34000,
      fuelLevel: 50,
      insuranceExpiry: new Date("2025-11-20T00:00:00+05:30"), // Valid (assuming current date is early 2025 or late 2024)
      branchId: udupiBranch.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE,
      insuranceRecords: {
        create: {
          publicId: nanoid(),
          policyNumber: "POL2001",
          provider: "HDFC Ergo",
          validTill: new Date("2025-11-01T00:00:00+05:30"),
        },
      },
      maintenance: {
        create: {
          publicId: nanoid(),
          description: "AC gas refill + wheel alignment",
          cost: 3500,
          servicedAt: new Date("2024-08-14T00:00:00+05:30"),
        },
      },
    },
  });

  // i20 (Udupi, 4W) - Expired Insurance Case
  const i20 = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Hyundai",
      model: "i20 Asta",
      regNo: "KA20GH8765",
      odo: 29000,
      fuelLevel: 40,
      insuranceExpiry: new Date("2023-01-01T00:00:00+05:30"), // EXPIRED
      branchId: udupiBranch.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE, // Status is available but should be filtered out by date check
      customPricing: {
        create: {
          publicId: nanoid(),
          hourlyRate: 200,
          price12Hour: 1200,
          price24Hour: 2000,
          priceMonthly: 45000,
          enabled: true,
        },
      },
    },
  });

  // 5. Pricing Rules (Global)
  await prisma.pricingRule.createMany({
    data: [
      {
        publicId: nanoid(),
        ruleType: PricingRuleType.WEEKDAY,
        multiplier: 1.0,
      },
      {
        publicId: nanoid(),
        ruleType: PricingRuleType.WEEKEND,
        multiplier: 1.25,
      },
      {
        publicId: nanoid(),
        ruleType: PricingRuleType.PEAK,
        multiplier: 1.5,
        categoryId: fourWheeler.id,
      },
    ],
  });

  // 6. GST Rules
  await prisma.gSTRule.createMany({
    data: [
      {
        publicId: nanoid(),
        branchId: mangaloreBranch.id,
        gstNumber: "29ABCDE1234F1Z5",
        cgstRate: 9.00,
        sgstRate: 9.00,
        igstRate: 0.00,
      },
      {
        publicId: nanoid(),
        branchId: udupiBranch.id,
        gstNumber: "29ABCDE1234F1Z6",
        cgstRate: 9.00,
        sgstRate: 9.00,
        igstRate: 0.00,
      },
    ],
  });

  // 7. Category Deposit Settings
  await prisma.categoryDepositSetting.createMany({
    data: [
      { branchId: mangaloreBranch.id, categoryId: twoWheeler.id, amount: 1000 },
      { branchId: udupiBranch.id, categoryId: twoWheeler.id, amount: 1000 },
      { branchId: mangaloreBranch.id, categoryId: fourWheeler.id, amount: 5000 },
      { branchId: udupiBranch.id, categoryId: fourWheeler.id, amount: 5000 },
    ],
  });

  // 8. Timezone Setting
  await prisma.timezoneSetting.create({
    data: {
      publicId: nanoid(),
      timezone: "Asia/Kolkata",
      enabled: true,
    },
  });

  // 9. Feature Flags
  const maintenanceFlag = await prisma.featureFlag.create({
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

  console.log("VRMS seed completed successfully!");
  console.log({
    admin: { email: admin.email, password: "Markjeo076&" },
    manager: { email: manager.email, password: "Markjeo076&" },
    staff: { email: staff.email, password: "Markjeo076&" },
    customer: { email: customerUser.email, password: "Markjeo076&" },
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
