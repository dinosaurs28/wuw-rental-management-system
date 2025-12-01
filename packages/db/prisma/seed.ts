/// <reference types="node" />

import {Role, AuthProvider, PricingRuleType, VehicleStatus, prisma } from "@repo/database/client";
import { customAlphabet } from "nanoid";


const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);

async function main() {
  console.log("Starting VRMS seed...");
  const admin = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Admin User",
      email: "admin@vrms.com",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv1234567890abcd",
      role: Role.ADMIN,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userProvider.create({
    data: {
      publicId: nanoid(),
      userId: admin.id,
      provider: AuthProvider.PASSWORD,
      providerUserId: admin.email,
    },
  });

  const staff = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "Staff Member",
      email: "staff@vrms.com",
      passwordHash: "$2b$10$xyzxyzxyzxyzxyzxyzxyzxy000111222333",
      role: Role.STAFF,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
    },
  });

  const customer = await prisma.user.create({
    data: {
      publicId: nanoid(),
      name: "John Customer",
      email: "customer@vrms.com",
      passwordHash: "$2b$10$customerhashdummyvalue1122334455",
      role: Role.CUSTOMER,
      authProvider: AuthProvider.PASSWORD,
      emailVerifiedAt: new Date(),
    },
  });

  const branch1 = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Mangalore Central",
      address: "Near KSRTC Bus Stand, Mangalore",
      phone: "9876543210",
    },
  });

  const branch2 = await prisma.branch.create({
    data: {
      publicId: nanoid(),
      name: "Udupi Station",
      address: "Near Railway Station, Udupi",
      phone: "9876543211",
    },
  });

  await prisma.branchPricingSetting.createMany({
    data: [
      {
        branchId: branch1.id,
        weekendEnabled: true,
        peakEnabled: false,
        customEnabled: false,
        weekendMultiplier: 1.2,
        peakMultiplier: 1.5,
        customMultiplier: 1.0,
      },
      {
        branchId: branch2.id,
        weekendEnabled: true,
        peakEnabled: false,
        customEnabled: false,
        weekendMultiplier: 1.2,
        peakMultiplier: 1.5,
        customMultiplier: 1.0,
      },
    ],
  });

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

  await prisma.rentalPlan.createMany({
    data: [
      {
        publicId: nanoid(),
        name: "Hourly",
        durationHours: 1,
        basePrice: 80,
      },
      {
        publicId: nanoid(),
        name: "Half Day",
        durationHours: 6,
        basePrice: 350,
      },
      {
        publicId: nanoid(),
        name: "Daily",
        durationHours: 24,
        basePrice: 700,
      },
    ],
  });

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

  const activa = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Honda",
      model: "Activa 6G",
      regNo: "KA19AB1234",
      odo: 12000,
      insuranceExpiry: new Date("2026-12-31"),
      branchId: branch1.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      baseDailyPrice: 800,
    },
  });

  const dio = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Honda",
      model: "Dio BS6",
      regNo: "KA19CD5678",
      odo: 8000,
      insuranceExpiry: new Date("2026-06-01"),
      branchId: branch1.id,
      categoryId: twoWheeler.id,
      status: VehicleStatus.AVAILABLE,
      baseDailyPrice: 900,
    },
  });

  const swift = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Maruti Suzuki",
      model: "Swift VXI",
      regNo: "KA20EF4321",
      odo: 34000,
      insuranceExpiry: new Date("2025-11-20"),
      branchId: branch2.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE,
      baseDailyPrice: 1550,
    },
  });

  const i20 = await prisma.vehicle.create({
    data: {
      publicId: nanoid(),
      make: "Hyundai",
      model: "i20 Asta",
      regNo: "KA20GH8765",
      odo: 29000,
      insuranceExpiry: new Date("2025-07-18"),
      branchId: branch2.id,
      categoryId: fourWheeler.id,
      status: VehicleStatus.AVAILABLE,
      baseDailyPrice: 1800,
    },
  });

  await prisma.vehiclePricingOverride.createMany({
    data: [
      { vehicleId: activa.id, enabled: false },
      { vehicleId: dio.id, enabled: false },
      { vehicleId: swift.id, enabled: false },
      { vehicleId: i20.id, enabled: false },
    ],
  });

  await prisma.vehicleInsurance.createMany({
    data: [
      {
        publicId: nanoid(),
        vehicleId: activa.id,
        policyNumber: "POL1001",
        provider: "ICICI Lombard",
        validTill: new Date("2026-01-01"),
      },
      {
        publicId: nanoid(),
        vehicleId: swift.id,
        policyNumber: "POL2001",
        provider: "HDFC Ergo",
        validTill: new Date("2025-11-01"),
      },
    ],
  });

  await prisma.vehicleMaintenanceRecord.createMany({
    data: [
      {
        publicId: nanoid(),
        vehicleId: activa.id,
        description: "Oil change + brake service",
        cost: 1500,
        servicedAt: new Date("2024-09-20"),
      },
      {
        publicId: nanoid(),
        vehicleId: swift.id,
        description: "AC gas refill + wheel alignment",
        cost: 3500,
        servicedAt: new Date("2024-08-14"),
      },
    ],
  });

  console.log("VRMS seed completed successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
