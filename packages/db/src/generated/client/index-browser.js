
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
  actorPublicId: 'actorPublicId',
  actorName: 'actorName',
  actorRole: 'actorRole',
  branchId: 'branchId',
  branchName: 'branchName',
  actionType: 'actionType',
  entityType: 'entityType',
  entityRef: 'entityRef',
  description: 'description',
  metadata: 'metadata',
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
  description: 'description',
  rank: 'rank'
};

exports.Prisma.VehiclePhotoCaptureConfigScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  branchId: 'branchId',
  categoryId: 'categoryId',
  fields: 'fields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
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
  advancePayAmount: 'advancePayAmount',
  insuranceExpiry: 'insuranceExpiry',
  status: 'status',
  fastagNumber: 'fastagNumber',
  hasFastag: 'hasFastag',
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
  isAdvancePayment: 'isAdvancePayment',
  advanceAmount: 'advanceAmount',
  advancePaidAt: 'advancePaidAt',
  advancePaymentId: 'advancePaymentId',
  advancePaymentMode: 'advancePaymentMode',
  remainingBalance: 'remainingBalance',
  remainingPaidAt: 'remainingPaidAt',
  remainingPaymentId: 'remainingPaymentId',
  remainingPaymentMode: 'remainingPaymentMode',
  remainingPaidDuring: 'remainingPaidDuring',
  safetyDeposit: 'safetyDeposit',
  safetyDepositPaidAt: 'safetyDepositPaidAt',
  safetyDepositMethod: 'safetyDepositMethod',
  safetyDepositRefunded: 'safetyDepositRefunded',
  safetyDepositRefundedAt: 'safetyDepositRefundedAt',
  safetyDepositSetOff: 'safetyDepositSetOff',
  cancelledAt: 'cancelledAt',
  cancellationReason: 'cancellationReason',
  requiresManagerConfirmation: 'requiresManagerConfirmation',
  couponCode: 'couponCode',
  discountRuleId: 'discountRuleId',
  originalEndAt: 'originalEndAt',
  extensionCount: 'extensionCount',
  lastExtendedAt: 'lastExtendedAt',
  activeExtensionId: 'activeExtensionId',
  displacedByExtensionId: 'displacedByExtensionId',
  extensionDisplacedAt: 'extensionDisplacedAt',
  frozenChargeConfig: 'frozenChargeConfig',
  chargeConfigVersion: 'chargeConfigVersion',
  activePaymentSessionId: 'activePaymentSessionId',
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
  captureLabel: 'captureLabel',
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
  amount: 'amount',
  isTaxable: 'isTaxable',
  chargeType: 'chargeType'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  actorId: 'actorId',
  actorName: 'actorName',
  actorRole: 'actorRole',
  actorBranchId: 'actorBranchId',
  approverId: 'approverId',
  approverName: 'approverName',
  approverRole: 'approverRole',
  action: 'action',
  category: 'category',
  severity: 'severity',
  description: 'description',
  entity: 'entity',
  entityId: 'entityId',
  entityLabel: 'entityLabel',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  requestId: 'requestId',
  before: 'before',
  after: 'after',
  changedFields: 'changedFields',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.SystemSettingScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  key: 'key',
  value: 'value',
  updatedAt: 'updatedAt'
};

exports.Prisma.WhatsAppSupportConfigScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  phoneNumber: 'phoneNumber',
  messageTemplate: 'messageTemplate',
  isEnabled: 'isEnabled',
  createdAt: 'createdAt',
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

exports.Prisma.ReturnReceiptScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  receiptNumber: 'receiptNumber',
  lineItems: 'lineItems',
  totalCharges: 'totalCharges',
  depositPaid: 'depositPaid',
  amountDue: 'amountDue',
  refundAmount: 'refundAmount',
  receiptPdfFileId: 'receiptPdfFileId',
  generatedAt: 'generatedAt',
  createdAt: 'createdAt'
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

exports.Prisma.VehicleSwapScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  originalVehicleId: 'originalVehicleId',
  newVehicleId: 'newVehicleId',
  swappedById: 'swappedById',
  reason: 'reason',
  reasonNotes: 'reasonNotes',
  originalVehicleStatus: 'originalVehicleStatus',
  originalVehicleNotes: 'originalVehicleNotes',
  swappedAt: 'swappedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DiscountRuleScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  code: 'code',
  name: 'name',
  description: 'description',
  discountType: 'discountType',
  value: 'value',
  maxDiscountCap: 'maxDiscountCap',
  scope: 'scope',
  applicableBranchIds: 'applicableBranchIds',
  targetCustomerIds: 'targetCustomerIds',
  newCustomersOnly: 'newCustomersOnly',
  minBookingCount: 'minBookingCount',
  maxBookingCount: 'maxBookingCount',
  minBookingAmount: 'minBookingAmount',
  maxBookingAmount: 'maxBookingAmount',
  applicableVehicleCategoryIds: 'applicableVehicleCategoryIds',
  minRentalDays: 'minRentalDays',
  maxRentalDays: 'maxRentalDays',
  applicablePaymentPlans: 'applicablePaymentPlans',
  allowPartialPayment: 'allowPartialPayment',
  minAdvanceAfterDiscount: 'minAdvanceAfterDiscount',
  allowPostBooking: 'allowPostBooking',
  allowPostInvoice: 'allowPostInvoice',
  totalUsageLimit: 'totalUsageLimit',
  perUserLimit: 'perUserLimit',
  perBranchLimit: 'perBranchLimit',
  perDayLimit: 'perDayLimit',
  stackable: 'stackable',
  priority: 'priority',
  startDate: 'startDate',
  endDate: 'endDate',
  isActive: 'isActive',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DurationDiscountSlabScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  minDays: 'minDays',
  maxDays: 'maxDays',
  discountType: 'discountType',
  value: 'value',
  label: 'label',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BranchDiscountConfigScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  durationDiscountEnabled: 'durationDiscountEnabled',
  stackWithCoupon: 'stackWithCoupon',
  maxCombinedDiscountPercent: 'maxCombinedDiscountPercent',
  managerApprovalThreshold: 'managerApprovalThreshold',
  maxManualDiscountsPerEmployeePerDay: 'maxManualDiscountsPerEmployeePerDay',
  managerCouponCreationEnabled: 'managerCouponCreationEnabled',
  maxManagerCouponDiscountPercent: 'maxManagerCouponDiscountPercent',
  maxManagerCouponFlatAmount: 'maxManagerCouponFlatAmount',
  maxManagerCouponValidityDays: 'maxManagerCouponValidityDays',
  maxManagerCouponUsageLimit: 'maxManagerCouponUsageLimit',
  maxManagerCouponsPerDay: 'maxManagerCouponsPerDay',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DiscountApplicationScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  originalAmount: 'originalAmount',
  durationDiscountAmount: 'durationDiscountAmount',
  durationDiscountPercent: 'durationDiscountPercent',
  durationSlabId: 'durationSlabId',
  couponDiscountAmount: 'couponDiscountAmount',
  couponDiscountPercent: 'couponDiscountPercent',
  discountRuleId: 'discountRuleId',
  manualDiscountAmount: 'manualDiscountAmount',
  manualDiscountId: 'manualDiscountId',
  totalDiscountAmount: 'totalDiscountAmount',
  finalAmount: 'finalAmount',
  paymentPlan: 'paymentPlan',
  adjustmentType: 'adjustmentType',
  createdAt: 'createdAt'
};

exports.Prisma.CouponUsageLogScalarFieldEnum = {
  id: 'id',
  discountRuleId: 'discountRuleId',
  bookingId: 'bookingId',
  customerId: 'customerId',
  branchId: 'branchId',
  discountedAmount: 'discountedAmount',
  appliedAt: 'appliedAt'
};

exports.Prisma.ManualDiscountScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  amount: 'amount',
  reason: 'reason',
  issuedById: 'issuedById',
  approvedById: 'approvedById',
  status: 'status',
  requiresApproval: 'requiresApproval',
  approvedAt: 'approvedAt',
  rejectedAt: 'rejectedAt',
  rejectionReason: 'rejectionReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BranchPaymentConfigScalarFieldEnum = {
  id: 'id',
  branchId: 'branchId',
  cashConfirmationEnabled: 'cashConfirmationEnabled',
  blockProgressionUntilConfirmed: 'blockProgressionUntilConfirmed',
  maxCashPerEmployee: 'maxCashPerEmployee',
  requireShiftSettlement: 'requireShiftSettlement',
  splitPaymentEnabled: 'splitPaymentEnabled',
  crossBranchSettlementEnabled: 'crossBranchSettlementEnabled',
  refundApprovalRequired: 'refundApprovalRequired',
  onlineRefundEnabled: 'onlineRefundEnabled',
  delayedCashAlertHours: 'delayedCashAlertHours',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentTransactionScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  idempotencyKey: 'idempotencyKey',
  bookingId: 'bookingId',
  branchId: 'branchId',
  purpose: 'purpose',
  method: 'method',
  status: 'status',
  totalAmount: 'totalAmount',
  cashAmount: 'cashAmount',
  onlineAmount: 'onlineAmount',
  onlineTransactionRef: 'onlineTransactionRef',
  onlineGateway: 'onlineGateway',
  collectedById: 'collectedById',
  collectedAt: 'collectedAt',
  confirmedById: 'confirmedById',
  confirmedAt: 'confirmedAt',
  rejectedById: 'rejectedById',
  rejectedAt: 'rejectedAt',
  rejectionReason: 'rejectionReason',
  cashShiftId: 'cashShiftId',
  notes: 'notes',
  createdAt: 'createdAt'
};

exports.Prisma.RefundRequestScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  branchId: 'branchId',
  amount: 'amount',
  reason: 'reason',
  method: 'method',
  status: 'status',
  requestedById: 'requestedById',
  approvedById: 'approvedById',
  approvedAt: 'approvedAt',
  completedById: 'completedById',
  completedAt: 'completedAt',
  onlineTransactionRef: 'onlineTransactionRef',
  rejectionReason: 'rejectionReason',
  rejectedAt: 'rejectedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CashShiftScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  employeeId: 'employeeId',
  branchId: 'branchId',
  status: 'status',
  openedAt: 'openedAt',
  closedAt: 'closedAt',
  expectedTotal: 'expectedTotal',
  actualTotal: 'actualTotal',
  discrepancy: 'discrepancy',
  discrepancyExplanation: 'discrepancyExplanation',
  reconciledById: 'reconciledById',
  reconciledAt: 'reconciledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BookingExtensionScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  branchId: 'branchId',
  extensionTrigger: 'extensionTrigger',
  extensionStatus: 'extensionStatus',
  oldEndAt: 'oldEndAt',
  requestedEndAt: 'requestedEndAt',
  actualNewEndAt: 'actualNewEndAt',
  additionalAmount: 'additionalAmount',
  newTotalFinal: 'newTotalFinal',
  resolutionType: 'resolutionType',
  vehicleSwapOccurred: 'vehicleSwapOccurred',
  swappedVehicleId: 'swappedVehicleId',
  affectedBookingIds: 'affectedBookingIds',
  paymentTransactionId: 'paymentTransactionId',
  vehicleSwapId: 'vehicleSwapId',
  actorId: 'actorId',
  actorPublicId: 'actorPublicId',
  actorRole: 'actorRole',
  rejectionReason: 'rejectionReason',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BranchChargeConfigScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  branchId: 'branchId',
  extraKmEnabled: 'extraKmEnabled',
  extraTimeEnabled: 'extraTimeEnabled',
  fuelModuleEnabled: 'fuelModuleEnabled',
  fastagModuleEnabled: 'fastagModuleEnabled',
  gracePolicyEnabled: 'gracePolicyEnabled',
  damageModuleEnabled: 'damageModuleEnabled',
  graceType: 'graceType',
  graceMinutes: 'graceMinutes',
  employeeOverrideEnabled: 'employeeOverrideEnabled',
  maxOverridePercent: 'maxOverridePercent',
  overrideRequiresApproval: 'overrideRequiresApproval',
  overrideApprovalThreshold: 'overrideApprovalThreshold',
  safetyDepositEnabled: 'safetyDepositEnabled',
  safetyDepositRequiresApproval: 'safetyDepositRequiresApproval',
  usePaymentSessions: 'usePaymentSessions',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChargeEntryScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  chargeType: 'chargeType',
  moduleKey: 'moduleKey',
  label: 'label',
  originalAmount: 'originalAmount',
  finalAmount: 'finalAmount',
  quantity: 'quantity',
  unitRate: 'unitRate',
  notes: 'notes',
  isOverridden: 'isOverridden',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChargeOverrideScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  chargeEntryId: 'chargeEntryId',
  originalAmount: 'originalAmount',
  overriddenAmount: 'overriddenAmount',
  waivedAmount: 'waivedAmount',
  reason: 'reason',
  status: 'status',
  actorId: 'actorId',
  actorRole: 'actorRole',
  approverId: 'approverId',
  approvedAt: 'approvedAt',
  rejectedAt: 'rejectedAt',
  rejectionReason: 'rejectionReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FuelRecordScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  pickupFuelLevel: 'pickupFuelLevel',
  returnFuelLevel: 'returnFuelLevel',
  fuelDeficit: 'fuelDeficit',
  fuelDeficitCharge: 'fuelDeficitCharge',
  skipReason: 'skipReason',
  capturedByPickupId: 'capturedByPickupId',
  capturedByReturnId: 'capturedByReturnId',
  pickupAt: 'pickupAt',
  returnAt: 'returnAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SafetyDepositRequestScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  requestedAmount: 'requestedAmount',
  reason: 'reason',
  status: 'status',
  requestedById: 'requestedById',
  approvedById: 'approvedById',
  approvedAmount: 'approvedAmount',
  approvedAt: 'approvedAt',
  rejectedAt: 'rejectedAt',
  rejectionReason: 'rejectionReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentSessionScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  bookingId: 'bookingId',
  branchId: 'branchId',
  sessionType: 'sessionType',
  status: 'status',
  taxableBase: 'taxableBase',
  nonTaxableBase: 'nonTaxableBase',
  gstAmount: 'gstAmount',
  totalCharges: 'totalCharges',
  totalDiscounts: 'totalDiscounts',
  totalPaymentsRecorded: 'totalPaymentsRecorded',
  netPayable: 'netPayable',
  idempotencyKey: 'idempotencyKey',
  gatewayTransactionId: 'gatewayTransactionId',
  gatewayPaymentUrl: 'gatewayPaymentUrl',
  expiresAt: 'expiresAt',
  completedAt: 'completedAt',
  metadata: 'metadata',
  actorId: 'actorId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LedgerEntryScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  sessionId: 'sessionId',
  bookingId: 'bookingId',
  entryType: 'entryType',
  classification: 'classification',
  amount: 'amount',
  baseAmount: 'baseAmount',
  gstAmount: 'gstAmount',
  description: 'description',
  referenceId: 'referenceId',
  referenceType: 'referenceType',
  idempotencyKey: 'idempotencyKey',
  isVoided: 'isVoided',
  voidedAt: 'voidedAt',
  voidedById: 'voidedById',
  voidReason: 'voidReason',
  actorId: 'actorId',
  actorRole: 'actorRole',
  metadata: 'metadata',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CustomerCreditEntryScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  customerId: 'customerId',
  bookingId: 'bookingId',
  branchId: 'branchId',
  createdById: 'createdById',
  sections: 'sections',
  totalAmount: 'totalAmount',
  clearedAmount: 'clearedAmount',
  pendingAmount: 'pendingAmount',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CreditClearanceScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  creditEntryId: 'creditEntryId',
  clearedSectionKeys: 'clearedSectionKeys',
  amountCleared: 'amountCleared',
  paymentMethod: 'paymentMethod',
  transactionRef: 'transactionRef',
  clearedById: 'clearedById',
  clearedAt: 'clearedAt'
};

exports.Prisma.CreditNoteScalarFieldEnum = {
  id: 'id',
  publicId: 'publicId',
  creditNoteNumber: 'creditNoteNumber',
  bookingId: 'bookingId',
  invoiceId: 'invoiceId',
  receiptId: 'receiptId',
  amount: 'amount',
  reason: 'reason',
  status: 'status',
  issuedById: 'issuedById',
  pdfFileId: 'pdfFileId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.JsonNullValueInput = {
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

exports.StaffActionType = exports.$Enums.StaffActionType = {
  CREATED: 'CREATED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  CONFIRMED: 'CONFIRMED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  UPLOADED: 'UPLOADED',
  SWAPPED: 'SWAPPED',
  REFUNDED: 'REFUNDED',
  ASSESSED: 'ASSESSED',
  INITIATED: 'INITIATED',
  COMPLETED: 'COMPLETED',
  APPLIED: 'APPLIED',
  OVERRIDDEN: 'OVERRIDDEN',
  RECALCULATED: 'RECALCULATED',
  FLAGGED: 'FLAGGED',
  COLLECTED: 'COLLECTED',
  RECONCILED: 'RECONCILED',
  SETTLED: 'SETTLED',
  DISBURSED: 'DISBURSED',
  EXTENDED: 'EXTENDED'
};

exports.StaffEntityType = exports.$Enums.StaffEntityType = {
  BOOKING: 'BOOKING',
  INVOICE: 'INVOICE',
  PAYMENT: 'PAYMENT',
  CUSTOMER: 'CUSTOMER',
  VEHICLE: 'VEHICLE',
  KYC: 'KYC',
  DAMAGE_REPORT: 'DAMAGE_REPORT',
  DEPOSIT: 'DEPOSIT',
  EMPLOYEE: 'EMPLOYEE',
  PRICING: 'PRICING',
  CAPTURE_CONFIG: 'CAPTURE_CONFIG',
  DISCOUNT_RULE: 'DISCOUNT_RULE',
  DISCOUNT_APPLICATION: 'DISCOUNT_APPLICATION',
  MANUAL_DISCOUNT: 'MANUAL_DISCOUNT',
  PAYMENT_TRANSACTION: 'PAYMENT_TRANSACTION',
  CASH_SHIFT: 'CASH_SHIFT',
  REFUND_REQUEST: 'REFUND_REQUEST',
  BOOKING_EXTENSION: 'BOOKING_EXTENSION',
  CHARGE_ENTRY: 'CHARGE_ENTRY',
  CHARGE_OVERRIDE: 'CHARGE_OVERRIDE',
  FUEL_RECORD: 'FUEL_RECORD',
  SAFETY_DEPOSIT_REQUEST: 'SAFETY_DEPOSIT_REQUEST',
  BRANCH_CHARGE_CONFIG: 'BRANCH_CHARGE_CONFIG',
  PAYMENT_SESSION: 'PAYMENT_SESSION',
  LEDGER_ENTRY: 'LEDGER_ENTRY'
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

exports.AuditCategory = exports.$Enums.AuditCategory = {
  BOOKING: 'BOOKING',
  PAYMENT: 'PAYMENT',
  VEHICLE: 'VEHICLE',
  CUSTOMER: 'CUSTOMER',
  EMPLOYEE: 'EMPLOYEE',
  BRANCH: 'BRANCH',
  AUTH: 'AUTH',
  SYSTEM: 'SYSTEM',
  DISCOUNT: 'DISCOUNT',
  CHARGE: 'CHARGE'
};

exports.AuditSeverity = exports.$Enums.AuditSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
};

exports.FeatureFlagScope = exports.$Enums.FeatureFlagScope = {
  SYSTEM: 'SYSTEM',
  BRANCH: 'BRANCH',
  VEHICLE: 'VEHICLE'
};

exports.SwapReason = exports.$Enums.SwapReason = {
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  MAINTENANCE: 'MAINTENANCE',
  UPGRADE: 'UPGRADE',
  DOWNGRADE: 'DOWNGRADE',
  DAMAGE: 'DAMAGE',
  OTHER: 'OTHER'
};

exports.DiscountType = exports.$Enums.DiscountType = {
  PERCENTAGE: 'PERCENTAGE',
  FLAT: 'FLAT'
};

exports.DiscountScope = exports.$Enums.DiscountScope = {
  GLOBAL: 'GLOBAL',
  BRANCH: 'BRANCH',
  USER: 'USER'
};

exports.AdjustmentType = exports.$Enums.AdjustmentType = {
  NONE: 'NONE',
  PENDING_REFUND: 'PENDING_REFUND',
  REFUNDED: 'REFUNDED',
  WALLET_CREDITED: 'WALLET_CREDITED',
  CASH_HANDLED: 'CASH_HANDLED'
};

exports.ManualDiscountStatus = exports.$Enums.ManualDiscountStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.PaymentPurpose = exports.$Enums.PaymentPurpose = {
  ADVANCE: 'ADVANCE',
  REMAINING_BALANCE: 'REMAINING_BALANCE',
  FULL_PAYMENT: 'FULL_PAYMENT',
  EXTENSION: 'EXTENSION',
  DAMAGE_FEE: 'DAMAGE_FEE',
  SAFETY_DEPOSIT: 'SAFETY_DEPOSIT',
  OVERPAYMENT_REFUND: 'OVERPAYMENT_REFUND',
  CANCELLATION_REFUND: 'CANCELLATION_REFUND'
};

exports.PaymentMethod = exports.$Enums.PaymentMethod = {
  CASH: 'CASH',
  ONLINE: 'ONLINE',
  SPLIT: 'SPLIT'
};

exports.PaymentTransactionStatus = exports.$Enums.PaymentTransactionStatus = {
  INITIATED: 'INITIATED',
  COLLECTED: 'COLLECTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED'
};

exports.RefundStatus = exports.$Enums.RefundStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED'
};

exports.CashShiftStatus = exports.$Enums.CashShiftStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  DISCREPANCY_FLAGGED: 'DISCREPANCY_FLAGGED'
};

exports.ExtensionTrigger = exports.$Enums.ExtensionTrigger = {
  CUSTOMER_BEFORE_PICKUP: 'CUSTOMER_BEFORE_PICKUP',
  CUSTOMER_AFTER_PICKUP: 'CUSTOMER_AFTER_PICKUP',
  EMPLOYEE_AT_PICKUP: 'EMPLOYEE_AT_PICKUP',
  EMPLOYEE_DURING_RENTAL: 'EMPLOYEE_DURING_RENTAL'
};

exports.ExtensionStatus = exports.$Enums.ExtensionStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAYMENT_COLLECTED: 'PAYMENT_COLLECTED',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

exports.ExtensionResolutionType = exports.$Enums.ExtensionResolutionType = {
  SAME_VEHICLE: 'SAME_VEHICLE',
  SWAP_CURRENT_TO_OTHER: 'SWAP_CURRENT_TO_OTHER',
  SWAP_FUTURE_BOOKING: 'SWAP_FUTURE_BOOKING',
  PARTIAL_EXTENSION: 'PARTIAL_EXTENSION',
  NO_RESOLUTION: 'NO_RESOLUTION'
};

exports.GraceType = exports.$Enums.GraceType = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL'
};

exports.ChargeType = exports.$Enums.ChargeType = {
  BASE: 'BASE',
  EXTRA_KM: 'EXTRA_KM',
  EXTRA_TIME: 'EXTRA_TIME',
  FUEL_DEFICIT: 'FUEL_DEFICIT',
  FASTAG: 'FASTAG',
  DAMAGE: 'DAMAGE',
  GRACE_ADJUSTMENT: 'GRACE_ADJUSTMENT',
  SAFETY_DEPOSIT: 'SAFETY_DEPOSIT'
};

exports.OverrideStatus = exports.$Enums.OverrideStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  AUTO_APPROVED: 'AUTO_APPROVED',
  REJECTED: 'REJECTED'
};

exports.FuelLevel = exports.$Enums.FuelLevel = {
  EMPTY: 'EMPTY',
  QUARTER: 'QUARTER',
  HALF: 'HALF',
  THREE_QUARTER: 'THREE_QUARTER',
  FULL: 'FULL'
};

exports.SafetyDepositStatus = exports.$Enums.SafetyDepositStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CHARGED: 'CHARGED',
  REFUNDED: 'REFUNDED'
};

exports.PaymentSessionType = exports.$Enums.PaymentSessionType = {
  BOOKING: 'BOOKING',
  PICKUP: 'PICKUP',
  EXTENSION: 'EXTENSION',
  RETURN: 'RETURN'
};

exports.PaymentSessionStatus = exports.$Enums.PaymentSessionStatus = {
  OPEN: 'OPEN',
  COMPUTING: 'COMPUTING',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED'
};

exports.LedgerEntryType = exports.$Enums.LedgerEntryType = {
  BOOKING_BASE: 'BOOKING_BASE',
  EXTENSION: 'EXTENSION',
  DEPOSIT: 'DEPOSIT',
  EXTRA_KM: 'EXTRA_KM',
  EXTRA_TIME: 'EXTRA_TIME',
  FUEL: 'FUEL',
  FASTAG: 'FASTAG',
  DAMAGE: 'DAMAGE',
  GRACE_ADJUSTMENT: 'GRACE_ADJUSTMENT',
  DISCOUNT: 'DISCOUNT',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND'
};

exports.LedgerEntryClassification = exports.$Enums.LedgerEntryClassification = {
  TAXABLE: 'TAXABLE',
  NON_TAXABLE: 'NON_TAXABLE',
  DISCOUNT: 'DISCOUNT',
  PAYMENT: 'PAYMENT'
};

exports.CreditStatus = exports.$Enums.CreditStatus = {
  PENDING: 'PENDING',
  PARTIALLY_CLEARED: 'PARTIALLY_CLEARED',
  CLEARED: 'CLEARED'
};

exports.CreditNoteStatus = exports.$Enums.CreditNoteStatus = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
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
  VehiclePhotoCaptureConfig: 'VehiclePhotoCaptureConfig',
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
  WhatsAppSupportConfig: 'WhatsAppSupportConfig',
  GSTRule: 'GSTRule',
  TimezoneSetting: 'TimezoneSetting',
  CancellationInvoice: 'CancellationInvoice',
  ReturnReceipt: 'ReturnReceipt',
  FeatureFlag: 'FeatureFlag',
  BranchFeatureFlag: 'BranchFeatureFlag',
  VehicleFeatureFlag: 'VehicleFeatureFlag',
  VehicleSwap: 'VehicleSwap',
  DiscountRule: 'DiscountRule',
  DurationDiscountSlab: 'DurationDiscountSlab',
  BranchDiscountConfig: 'BranchDiscountConfig',
  DiscountApplication: 'DiscountApplication',
  CouponUsageLog: 'CouponUsageLog',
  ManualDiscount: 'ManualDiscount',
  BranchPaymentConfig: 'BranchPaymentConfig',
  PaymentTransaction: 'PaymentTransaction',
  RefundRequest: 'RefundRequest',
  CashShift: 'CashShift',
  BookingExtension: 'BookingExtension',
  BranchChargeConfig: 'BranchChargeConfig',
  ChargeEntry: 'ChargeEntry',
  ChargeOverride: 'ChargeOverride',
  FuelRecord: 'FuelRecord',
  SafetyDepositRequest: 'SafetyDepositRequest',
  PaymentSession: 'PaymentSession',
  LedgerEntry: 'LedgerEntry',
  CustomerCreditEntry: 'CustomerCreditEntry',
  CreditClearance: 'CreditClearance',
  CreditNote: 'CreditNote'
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
