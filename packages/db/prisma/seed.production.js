"use strict";
/// <reference types="node" />
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@repo/database/client");
var nanoid_1 = require("nanoid");
var nanoid = (0, nanoid_1.customAlphabet)("1234567890abcdefghijklmnopqrstuvwxyz", 16);
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var twoWheeler, fourWheeler, mainBranch, adminPasswordHash, branchDiscountFlag;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("Starting VRMS production seed...");
                    // ── Cleanup (order matters for foreign keys) ──────────────────────────────
                    console.log("Cleaning up existing data...");
                    return [4 /*yield*/, client_1.prisma.ledgerEntry.deleteMany()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.paymentSession.deleteMany()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.chargeOverride.deleteMany()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.chargeEntry.deleteMany()];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.cashShift.deleteMany()];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.paymentTransaction.deleteMany()];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.paymentWebhookLog.deleteMany()];
                case 7:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.refundRequest.deleteMany()];
                case 8:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.couponUsageLog.deleteMany()];
                case 9:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.manualDiscount.deleteMany()];
                case 10:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.discountApplication.deleteMany()];
                case 11:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.discountRule.deleteMany()];
                case 12:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.durationDiscountSlab.deleteMany()];
                case 13:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.safetyDepositRequest.deleteMany()];
                case 14:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.fuelRecord.deleteMany()];
                case 15:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchFeatureFlag.deleteMany()];
                case 16:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleFeatureFlag.deleteMany()];
                case 17:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.featureFlag.deleteMany()];
                case 18:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.staffActivityLog.deleteMany()];
                case 19:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.auditLog.deleteMany()];
                case 20:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.userProvider.deleteMany()];
                case 21:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.emailVerificationOtp.deleteMany()];
                case 22:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.customerKyc.deleteMany()];
                case 23:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleSwap.deleteMany()];
                case 24:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.bookingExtension.deleteMany()];
                case 25:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.cancellationInvoice.deleteMany()];
                case 26:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.bookingItem.deleteMany()];
                case 27:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.bookingPhoto.deleteMany()];
                case 28:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.payment.deleteMany()];
                case 29:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.invoiceItem.deleteMany()];
                case 30:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.deposit.deleteMany()];
                case 31:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.invoice.deleteMany()];
                case 32:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.damageReport.deleteMany()];
                case 33:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.booking.deleteMany()];
                case 34:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.customer.deleteMany()];
                case 35:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleMaintenanceRecord.deleteMany()];
                case 36:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleInsurance.deleteMany()];
                case 37:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehiclePricingOverride.deleteMany()];
                case 38:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleCustomPricing.deleteMany()];
                case 39:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleImage.deleteMany()];
                case 40:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicle.deleteMany()];
                case 41:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchPricingDefaults.deleteMany()];
                case 42:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.pricingRule.deleteMany()];
                case 43:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.pricingDiscountSlab.deleteMany()];
                case 44:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.user.deleteMany()];
                case 45:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.categoryDepositSetting.deleteMany()];
                case 46:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchPricingSetting.deleteMany()];
                case 47:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchChargeConfig.deleteMany()];
                case 48:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchDiscountConfig.deleteMany()];
                case 49:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchPaymentConfig.deleteMany()];
                case 50:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.gSTRule.deleteMany()];
                case 51:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehiclePhotoCaptureConfig.deleteMany()];
                case 52:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.branch.deleteMany()];
                case 53:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleCategory.deleteMany()];
                case 54:
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.fileObject.deleteMany()];
                case 55:
                    _a.sent();
                    console.log("Cleanup complete. Creating production data...");
                    return [4 /*yield*/, client_1.prisma.vehicleCategory.create({
                            data: {
                                publicId: nanoid(),
                                name: "Two Wheeler",
                                description: "Bikes & Scooters",
                            },
                        })];
                case 56:
                    twoWheeler = _a.sent();
                    return [4 /*yield*/, client_1.prisma.vehicleCategory.create({
                            data: {
                                publicId: nanoid(),
                                name: "Four Wheeler",
                                description: "Cars, SUVs",
                            },
                        })];
                case 57:
                    fourWheeler = _a.sent();
                    return [4 /*yield*/, client_1.prisma.branch.create({
                            data: {
                                publicId: nanoid(),
                                name: "Manipal",
                                address: "Main Branch Address", // ← update this
                                phone: "9999999999", // ← update this
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
                        })];
                case 58:
                    mainBranch = _a.sent();
                    // ── 3. Branch Charge Config ───────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.branchChargeConfig.create({
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
                        })];
                case 59:
                    // ── 3. Branch Charge Config ───────────────────────────────────────────────
                    _a.sent();
                    // ── 4. Branch Discount Config ─────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.branchDiscountConfig.create({
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
                        })];
                case 60:
                    // ── 4. Branch Discount Config ─────────────────────────────────────────────
                    _a.sent();
                    // ── 5. Branch Payment Config ──────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.branchPaymentConfig.create({
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
                        })];
                case 61:
                    // ── 5. Branch Payment Config ──────────────────────────────────────────────
                    _a.sent();
                    // ── 6. GST Rule ───────────────────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.gSTRule.create({
                            data: {
                                publicId: nanoid(),
                                branchId: mainBranch.id,
                                gstNumber: "IST2121", // ← update this
                                cgstRate: 9.0,
                                sgstRate: 9.0,
                                igstRate: 0.0,
                            },
                        })];
                case 62:
                    // ── 6. GST Rule ───────────────────────────────────────────────────────────
                    _a.sent();
                    // ── 7. Branch Pricing Defaults ────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.branchPricingDefaults.createMany({
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
                        })];
                case 63:
                    // ── 7. Branch Pricing Defaults ────────────────────────────────────────────
                    _a.sent();
                    // ── 8. Duration Discount Slabs ────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.durationDiscountSlab.createMany({
                            data: [
                                { branchId: mainBranch.id, minDays: 3, maxDays: 6, discountType: "PERCENTAGE", value: 5, label: "Short stay" },
                                { branchId: mainBranch.id, minDays: 7, maxDays: 13, discountType: "PERCENTAGE", value: 10, label: "Weekly" },
                                { branchId: mainBranch.id, minDays: 14, maxDays: 29, discountType: "PERCENTAGE", value: 15, label: "Bi-weekly" },
                                { branchId: mainBranch.id, minDays: 30, maxDays: null, discountType: "PERCENTAGE", value: 20, label: "Monthly" },
                            ],
                        })];
                case 64:
                    // ── 8. Duration Discount Slabs ────────────────────────────────────────────
                    _a.sent();
                    // ── 9. Category Deposit Settings ──────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.categoryDepositSetting.createMany({
                            data: [
                                { branchId: mainBranch.id, categoryId: twoWheeler.id, amount: 1000 },
                                { branchId: mainBranch.id, categoryId: fourWheeler.id, amount: 5000 },
                            ],
                        })];
                case 65:
                    // ── 9. Category Deposit Settings ──────────────────────────────────────────
                    _a.sent();
                    // ── 10. Vehicle Photo Capture Config ──────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.vehiclePhotoCaptureConfig.createMany({
                            data: [
                                {
                                    publicId: nanoid(),
                                    branchId: mainBranch.id,
                                    categoryId: twoWheeler.id,
                                    fields: [
                                        { name: "front", required: true },
                                        { name: "left_side", required: true },
                                        { name: "right_side", required: true },
                                        { name: "odometer", required: true },
                                        { name: "fuel_gauge", required: false },
                                    ],
                                },
                                {
                                    publicId: nanoid(),
                                    branchId: mainBranch.id,
                                    categoryId: fourWheeler.id,
                                    fields: [
                                        { name: "front", required: true },
                                        { name: "rear", required: true },
                                        { name: "left_side", required: true },
                                        { name: "right_side", required: true },
                                        { name: "odometer", required: true },
                                        { name: "fuel_gauge", required: false },
                                        { name: "dashboard", required: false },
                                    ],
                                },
                            ],
                        })];
                case 66:
                    // ── 10. Vehicle Photo Capture Config ──────────────────────────────────────
                    _a.sent();
                    // ── 11. Global Pricing Rules ──────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.pricingRule.createMany({
                            data: [
                                { publicId: nanoid(), ruleType: client_1.PricingRuleType.WEEKDAY, multiplier: 1.0 },
                                { publicId: nanoid(), ruleType: client_1.PricingRuleType.WEEKEND, multiplier: 1.25 },
                                { publicId: nanoid(), ruleType: client_1.PricingRuleType.PEAK, multiplier: 1.5, categoryId: fourWheeler.id },
                            ],
                        })];
                case 67:
                    // ── 11. Global Pricing Rules ──────────────────────────────────────────────
                    _a.sent();
                    adminPasswordHash = "$2a$10$C4fvLnge/TjgAjXiez26YeKCstsvpjdby.shoMyIZePHgGo5UixDG";
                    return [4 /*yield*/, client_1.prisma.user.create({
                            data: {
                                publicId: nanoid(),
                                name: "Admin",
                                email: "admin@wuw.com",
                                passwordHash: adminPasswordHash,
                                role: client_1.Role.ADMIN,
                                authProvider: client_1.AuthProvider.PASSWORD,
                                emailVerifiedAt: new Date(),
                                providers: {
                                    create: {
                                        publicId: nanoid(),
                                        provider: client_1.AuthProvider.PASSWORD,
                                        providerUserId: "admin@wuw.com",
                                    },
                                },
                            },
                        })];
                case 68:
                    _a.sent();
                    // ── 13. Feature Flags ─────────────────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.featureFlag.create({
                            data: {
                                publicId: nanoid(),
                                key: "system_maintenance",
                                name: "System Maintenance Mode",
                                scope: "SYSTEM",
                                enabled: false,
                            },
                        })];
                case 69:
                    // ── 13. Feature Flags ─────────────────────────────────────────────────────
                    _a.sent();
                    return [4 /*yield*/, client_1.prisma.featureFlag.create({
                            data: {
                                publicId: nanoid(),
                                key: "branch_discount",
                                name: "Branch Discount",
                                scope: "BRANCH",
                                enabled: true,
                            },
                        })];
                case 70:
                    branchDiscountFlag = _a.sent();
                    return [4 /*yield*/, client_1.prisma.branchFeatureFlag.create({
                            data: {
                                branchId: mainBranch.id,
                                flagId: branchDiscountFlag.id,
                                enabled: true,
                            },
                        })];
                case 71:
                    _a.sent();
                    // ── 14. Timezone & System Settings ────────────────────────────────────────
                    return [4 /*yield*/, client_1.prisma.timezoneSetting.upsert({
                            where: { id: 1 },
                            create: { publicId: nanoid(), timezone: "Asia/Kolkata", enabled: true },
                            update: { timezone: "Asia/Kolkata", enabled: true },
                        })];
                case 72:
                    // ── 14. Timezone & System Settings ────────────────────────────────────────
                    _a.sent();
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
                    return [2 /*return*/];
            }
        });
    });
}
var fs = require("fs");
main()
    .then(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, client_1.prisma.$disconnect()];
            case 1:
                _a.sent();
                process.exit(0);
                return [2 /*return*/];
        }
    });
}); })
    .catch(function (err) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.error("Seed failed:", err);
                fs.writeFileSync("seed_failure.txt", JSON.stringify(err, null, 2) + "\n" + err.toString());
                return [4 /*yield*/, client_1.prisma.$disconnect()];
            case 1:
                _a.sent();
                process.exit(1);
                return [2 /*return*/];
        }
    });
}); });
