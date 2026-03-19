
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  name: 'name',
  email: 'email',
  passwordHash: 'passwordHash',
  phone: 'phone',
  authProvider: 'authProvider',
  emailVerifiedAt: 'emailVerifiedAt',
  role: 'role',
  branchId: 'branchId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.RelationLoadStrategy = {
  query: 'query',
  join: 'join'
};

exports.Prisma.UserProviderScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  userId: 'userId',
  provider: 'provider',
  providerUserId: 'providerUserId',
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailVerificationOtpScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  phone: 'phone',
  otpHash: 'otpHash',
  expiresAt: 'expiresAt',
  used: 'used',
  createdAt: 'createdAt'
};

exports.Prisma.CustomerScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  userId: 'userId',
  alternatePhone: 'alternatePhone',
  dob: 'dob',
  addressLine1: 'addressLine1',
  city: 'city',
  state: 'state',
  country: 'country',
  zipCode: 'zipCode',
  isProfileCompleted: 'isProfileCompleted',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.CustomerKycScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  customerId: 'customerId',
  type: 'type',
  fileId: 'fileId',
  status: 'status',
  createdAt: 'createdAt'
};

exports.Prisma.FileObjectScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  key: 'key',
  url: 'url',
  mime: 'mime',
  size: 'size',
  createdAt: 'createdAt'
};

exports.Prisma.BranchScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  name: 'name',
  address: 'address',
  phone: 'phone',
  createdAt: 'createdAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.StaffActivityLogScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  staffId: 'staffId',
  action: 'action',
  entity: 'entity',
  entityId: 'entityId',
  createdAt: 'createdAt'
};

exports.Prisma.BranchPricingSettingScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  weekendEnabled: 'weekendEnabled',
  peakEnabled: 'peakEnabled',
  customEnabled: 'customEnabled',
  weekendMultiplier: 'weekendMultiplier',
  peakMultiplier: 'peakMultiplier',
  customMultiplier: 'customMultiplier',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VehicleCategoryScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  name: 'name',
  description: 'description'
};

exports.Prisma.VehicleScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  branchId: 'branchId',
  categoryId: 'categoryId',
  make: 'make',
  model: 'model',
  regNo: 'regNo',
  odo: 'odo',
  fuelLevel: 'fuelLevel',
  insuranceExpiry: 'insuranceExpiry',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.VehiclePricingOverrideScalarFieldEnum = {
  id: 'id',
  vehicleId: 'vehicleId',
  customPrice: 'customPrice',
  multiplier: 'multiplier',
  enabled: 'enabled'
};

exports.Prisma.VehicleCustomPricingScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  vehicleId: 'vehicleId',
  hourlyRate: 'hourlyRate',
  price12Hour: 'price12Hour',
  freeKm12Hour: 'freeKm12Hour',
  price24Hour: 'price24Hour',
  freeKm24Hour: 'freeKm24Hour',
  priceMonthly: 'priceMonthly',
  freeKmMonthly: 'freeKmMonthly',
  extraKmRate: 'extraKmRate',
  extraHourRate: 'extraHourRate',
  enabled: 'enabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BranchPricingDefaultsScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  branchId: 'branchId',
  categoryId: 'categoryId',
  hourlyRate: 'hourlyRate',
  price12Hour: 'price12Hour',
  freeKm12Hour: 'freeKm12Hour',
  price24Hour: 'price24Hour',
  freeKm24Hour: 'freeKm24Hour',
  priceMonthly: 'priceMonthly',
  freeKmMonthly: 'freeKmMonthly',
  extraKmRate: 'extraKmRate',
  extraHourRate: 'extraHourRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VehicleInsuranceScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  vehicleId: 'vehicleId',
  policyNumber: 'policyNumber',
  provider: 'provider',
  validTill: 'validTill'
};

exports.Prisma.VehicleMaintenanceRecordScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  vehicleId: 'vehicleId',
  description: 'description',
  cost: 'cost',
  servicedAt: 'servicedAt'
};

exports.Prisma.VehicleImageScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  vehicleId: 'vehicleId',
  fileId: 'fileId',
  isThumbnail: 'isThumbnail',
  createdAt: 'createdAt'
};

exports.Prisma.PricingRuleScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  ruleType: 'ruleType',
  multiplier: 'multiplier',
  categoryId: 'categoryId',
  createdAt: 'createdAt'
};

exports.Prisma.PricingDiscountSlabScalarFieldEnum = {
  id: 'id',
  days: 'days',
  multiplier: 'multiplier',
  branchId: 'branchId',
  categoryId: 'categoryId'
};

exports.Prisma.CategoryDepositSettingScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  categoryId: 'categoryId',
  amount: 'amount'
};

exports.Prisma.BookingScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  customerId: 'customerId',
  branchId: 'branchId',
  startAt: 'startAt',
  endAt: 'endAt',
  days: 'days',
  rentalPeriodType: 'rentalPeriodType',
  actualHours: 'actualHours',
  billableHours: 'billableHours',
  startOdometer: 'startOdometer',
  endOdometer: 'endOdometer',
  totalKmDriven: 'totalKmDriven',
  freeKmLimit: 'freeKmLimit',
  extraKmCharged: 'extraKmCharged',
  holdExpiresAt: 'holdExpiresAt',
  totalBase: 'totalBase',
  totalDiscount: 'totalDiscount',
  totalDeposit: 'totalDeposit',
  totalTax: 'totalTax',
  totalFinal: 'totalFinal',
  status: 'status',
  transactionId: 'transactionId',
  paymentStatus: 'paymentStatus',
  pricingSnapshot: 'pricingSnapshot',
  createdById: 'createdById',
  depositMethod: 'depositMethod',
  kycFileId: 'kycFileId',
  advanceAmount: 'advanceAmount',
  advancePaidAt: 'advancePaidAt',
  advancePaymentId: 'advancePaymentId',
  advancePaymentMode: 'advancePaymentMode',
  safetyDeposit: 'safetyDeposit',
  safetyDepositPaidAt: 'safetyDepositPaidAt',
  safetyDepositMethod: 'safetyDepositMethod',
  safetyDepositRefunded: 'safetyDepositRefunded',
  safetyDepositRefundedAt: 'safetyDepositRefundedAt',
  safetyDepositSetOff: 'safetyDepositSetOff',
  cancelledAt: 'cancelledAt',
  cancellationReason: 'cancellationReason',
  requiresManagerConfirmation: 'requiresManagerConfirmation',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.BookingItemScalarFieldEnum = {
  id: 'id',
  bookingId: 'bookingId',
  vehicleId: 'vehicleId',
  days: 'days',
  baseTotal: 'baseTotal',
  discountAmount: 'discountAmount',
  discountPercent: 'discountPercent',
  deposit: 'deposit',
  taxAmount: 'taxAmount',
  cgstAmount: 'cgstAmount',
  sgstAmount: 'sgstAmount',
  taxRate: 'taxRate',
  finalTotal: 'finalTotal'
};

exports.Prisma.BookingPhotoScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  fileId: 'fileId',
  type: 'type',
  damageReportId: 'damageReportId',
  createdAt: 'createdAt'
};

exports.Prisma.DamageReportScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  vehicleId: 'vehicleId',
  severity: 'severity',
  estimatedCost: 'estimatedCost',
  finalCost: 'finalCost',
  notes: 'notes',
  approvedById: 'approvedById',
  chargeType: 'chargeType',
  status: 'status',
  disposition: 'disposition',
  createdAt: 'createdAt'
};

exports.Prisma.DepositScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  amount: 'amount',
  method: 'method',
  isRefunded: 'isRefunded',
  refundedAt: 'refundedAt',
  refundMethod: 'refundMethod',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  invoiceId: 'invoiceId',
  method: 'method',
  razorpayOrderId: 'razorpayOrderId',
  razorpayPaymentId: 'razorpayPaymentId',
  status: 'status',
  amount: 'amount',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentWebhookLogScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  payload: 'payload',
  signature: 'signature',
  processed: 'processed',
  createdAt: 'createdAt'
};

exports.Prisma.InvoiceScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  subtotal: 'subtotal',
  discount: 'discount',
  tax: 'tax',
  damageCharges: 'damageCharges',
  total: 'total',
  status: 'status',
  invoiceNumber: 'invoiceNumber',
  invoicePdfFileId: 'invoicePdfFileId',
  generatedAt: 'generatedAt',
  createdAt: 'createdAt'
};

exports.Prisma.InvoiceItemScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  invoiceId: 'invoiceId',
  label: 'label',
  amount: 'amount'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  userId: 'userId',
  action: 'action',
  entity: 'entity',
  entityId: 'entityId',
  before: 'before',
  after: 'after',
  createdAt: 'createdAt'
};

exports.Prisma.SystemSettingScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  key: 'key',
  value: 'value',
  updatedAt: 'updatedAt'
};

exports.Prisma.GSTRuleScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  branchId: 'branchId',
  gstNumber: 'gstNumber',
  cgstRate: 'cgstRate',
  sgstRate: 'sgstRate',
  igstRate: 'igstRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TimezoneSettingScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  timezone: 'timezone',
  enabled: 'enabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CancellationInvoiceScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  customerId: 'customerId',
  advanceAmount: 'advanceAmount',
  cancellationFee: 'cancellationFee',
  reason: 'reason',
  notes: 'notes',
  invoiceNumber: 'invoiceNumber',
  invoicePdfFileId: 'invoicePdfFileId',
  generatedAt: 'generatedAt',
  sentToCustomer: 'sentToCustomer',
  sentAt: 'sentAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FeatureFlagScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  key: 'key',
  name: 'name',
  description: 'description',
  scope: 'scope',
  enabled: 'enabled',
  config: 'config',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BranchFeatureFlagScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  flagId: 'flagId',
  enabled: 'enabled',
  config: 'config',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VehicleFeatureFlagScalarFieldEnum = {
  id: 'id',
  vehicleId: 'vehicleId',
  flagId: 'flagId',
  enabled: 'enabled',
  config: 'config',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.AuthProvider = exports.$Enums.AuthProvider = {
  PASSWORD: 'PASSWORD',
  GOOGLE: 'GOOGLE'
};

exports.Role = exports.$Enums.Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER'
};

exports.KycType = exports.$Enums.KycType = {
  DL: 'DL',
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  STUDENT_ID: 'STUDENT_ID'
};

exports.KycStatus = exports.$Enums.KycStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.VehicleStatus = exports.$Enums.VehicleStatus = {
  AVAILABLE: 'AVAILABLE',
  OUT_FOR_RENTAL: 'OUT_FOR_RENTAL',
  MAINTENANCE: 'MAINTENANCE',
  INACTIVE: 'INACTIVE',
  MANAGER_REPORTED: 'MANAGER_REPORTED'
};

exports.PricingRuleType = exports.$Enums.PricingRuleType = {
  WEEKDAY: 'WEEKDAY',
  WEEKEND: 'WEEKEND',
  PEAK: 'PEAK',
  CUSTOM: 'CUSTOM'
};

exports.RentalPeriodType = exports.$Enums.RentalPeriodType = {
  HOURLY: 'HOURLY',
  HALF_DAY: 'HALF_DAY',
  FULL_DAY: 'FULL_DAY',
  MULTI_DAY: 'MULTI_DAY',
  MONTHLY: 'MONTHLY'
};

exports.BookingStatus = exports.$Enums.BookingStatus = {
  HOLD: 'HOLD',
  CONFIRMED: 'CONFIRMED',
  PICKED_UP: 'PICKED_UP',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
  HOLD_EXPIRED: 'HOLD_EXPIRED'
};

exports.PaymentStatus = exports.$Enums.PaymentStatus = {
  CREATED: 'CREATED',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
};

exports.DepositMethod = exports.$Enums.DepositMethod = {
  ONLINE_RAZORPAY: 'ONLINE_RAZORPAY',
  CASH: 'CASH',
  UPI: 'UPI'
};

exports.BookingPhotoType = exports.$Enums.BookingPhotoType = {
  PRE_DELIVERY: 'PRE_DELIVERY',
  POST_RETURN: 'POST_RETURN',
  DAMAGE: 'DAMAGE'
};

exports.DamageChargeType = exports.$Enums.DamageChargeType = {
  PENALTY: 'PENALTY',
  COMPENSATION: 'COMPENSATION'
};

exports.DamageReportStatus = exports.$Enums.DamageReportStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.VehicleReturnDisposition = exports.$Enums.VehicleReturnDisposition = {
  AVAILABLE: 'AVAILABLE',
  MAINTENANCE: 'MAINTENANCE',
  DAMAGED: 'DAMAGED'
};

exports.InvoiceStatus = exports.$Enums.InvoiceStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  FINALIZED: 'FINALIZED',
  PAID: 'PAID'
};

exports.FeatureFlagScope = exports.$Enums.FeatureFlagScope = {
  SYSTEM: 'SYSTEM',
  BRANCH: 'BRANCH',
  VEHICLE: 'VEHICLE'
};

exports.Prisma.ModelName = {
  User: 'User',
  UserProvider: 'UserProvider',
  EmailVerificationOtp: 'EmailVerificationOtp',
  Customer: 'Customer',
  CustomerKyc: 'CustomerKyc',
  FileObject: 'FileObject',
  Branch: 'Branch',
  StaffActivityLog: 'StaffActivityLog',
  BranchPricingSetting: 'BranchPricingSetting',
  VehicleCategory: 'VehicleCategory',
  Vehicle: 'Vehicle',
  VehiclePricingOverride: 'VehiclePricingOverride',
  VehicleCustomPricing: 'VehicleCustomPricing',
  BranchPricingDefaults: 'BranchPricingDefaults',
  VehicleInsurance: 'VehicleInsurance',
  VehicleMaintenanceRecord: 'VehicleMaintenanceRecord',
  VehicleImage: 'VehicleImage',
  PricingRule: 'PricingRule',
  PricingDiscountSlab: 'PricingDiscountSlab',
  CategoryDepositSetting: 'CategoryDepositSetting',
  Booking: 'Booking',
  BookingItem: 'BookingItem',
  BookingPhoto: 'BookingPhoto',
  DamageReport: 'DamageReport',
  Deposit: 'Deposit',
  Payment: 'Payment',
  PaymentWebhookLog: 'PaymentWebhookLog',
  Invoice: 'Invoice',
  InvoiceItem: 'InvoiceItem',
  AuditLog: 'AuditLog',
  SystemSetting: 'SystemSetting',
  GSTRule: 'GSTRule',
  TimezoneSetting: 'TimezoneSetting',
  CancellationInvoice: 'CancellationInvoice',
  FeatureFlag: 'FeatureFlag',
  BranchFeatureFlag: 'BranchFeatureFlag',
  VehicleFeatureFlag: 'VehicleFeatureFlag'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
