/**
 * Feature Flag Definitions
 *
 * All feature flags are defined here with:
 * - Unique key
 * - Human-readable name
 * - Description
 * - Scope (SYSTEM/BRANCH/VEHICLE)
 * - Default enabled state
 */

export enum FeatureFlagKey {
  // ========================================
  // PRICING FLAGS
  // ========================================
  HOURLY_RENTAL_ENABLED = "hourly_rental_enabled",
  MONTHLY_RENTAL_ENABLED = "monthly_rental_enabled",
  CUSTOM_VEHICLE_PRICING = "custom_vehicle_pricing",
  DYNAMIC_PRICING = "dynamic_pricing",
  DISCOUNT_SLABS = "discount_slabs",

  // ========================================
  // DEPOSIT FLAGS
  // ========================================
  SAFETY_DEPOSIT_REQUIRED = "safety_deposit_required",
  ADVANCE_PAYMENT_REQUIRED = "advance_payment_required",

  // ========================================
  // DAMAGE FLAGS
  // ========================================
  DAMAGE_COMPENSATION_NON_TAXABLE = "damage_compensation_non_taxable",
  AUTO_DAMAGE_DETECTION = "auto_damage_detection",

  // ========================================
  // INVOICE FLAGS
  // ========================================
  AUTO_INVOICE_GENERATION = "auto_invoice_generation",
  PDF_INVOICE_GENERATION = "pdf_invoice_generation",

  // ========================================
  // CANCELLATION FLAGS
  // ========================================
  NO_SHOW_AUTO_CANCEL = "no_show_auto_cancel",
  CANCELLATION_FEE_100_PERCENT = "cancellation_fee_100_percent",

  // ========================================
  // TRACKING FLAGS
  // ========================================
  GPS_TRACKING = "gps_tracking",
  AUTO_DISTANCE_CALCULATION = "auto_distance_calculation",

  // ========================================
  // TIME CALCULATION FLAGS
  // ========================================
  USE_IST_TIMEZONE = "use_ist_timezone",
  PRECISE_HOUR_CALCULATION = "precise_hour_calculation",

  // ========================================
  // REPORTING FLAGS
  // ========================================
  DETAILED_SALES_REPORT = "detailed_sales_report",
  REAL_TIME_ANALYTICS = "real_time_analytics",
}

export interface FeatureFlagDefinition {
  key: FeatureFlagKey;
  name: string;
  description: string;
  scope: "SYSTEM" | "BRANCH" | "VEHICLE";
  defaultEnabled: boolean;
  config?: any;
}

export const FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [
  {
    key: FeatureFlagKey.HOURLY_RENTAL_ENABLED,
    name: "Hourly Rentals",
    description: "Enable hourly rental pricing option for customers",
    scope: "BRANCH",
    defaultEnabled: false,
  },
  {
    key: FeatureFlagKey.MONTHLY_RENTAL_ENABLED,
    name: "Monthly Rentals",
    description: "Enable monthly rental pricing option for customers",
    scope: "BRANCH",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.CUSTOM_VEHICLE_PRICING,
    name: "Custom Vehicle Pricing",
    description:
      "Allow each vehicle to have custom pricing instead of category defaults",
    scope: "VEHICLE",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.DYNAMIC_PRICING,
    name: "Dynamic Pricing",
    description: "Enable weekend/peak multipliers for pricing",
    scope: "BRANCH",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.DISCOUNT_SLABS,
    name: "Discount Slabs",
    description: "Enable multi-day discount slabs for rentals",
    scope: "BRANCH",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.SAFETY_DEPOSIT_REQUIRED,
    name: "Safety Deposit Required",
    description: "Require safety deposit collection during vehicle pickup",
    scope: "BRANCH",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.ADVANCE_PAYMENT_REQUIRED,
    name: "Advance Payment Required",
    description: "Require advance payment during booking creation",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.DAMAGE_COMPENSATION_NON_TAXABLE,
    name: "Non-Taxable Damage Compensation",
    description:
      "Allow damage charges to be marked as non-taxable compensation",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.AUTO_DAMAGE_DETECTION,
    name: "Auto Damage Detection",
    description: "Automatically detect damage from vehicle photos",
    scope: "SYSTEM",
    defaultEnabled: false,
  },
  {
    key: FeatureFlagKey.AUTO_INVOICE_GENERATION,
    name: "Auto Invoice Generation",
    description: "Automatically generate invoices on booking completion",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.PDF_INVOICE_GENERATION,
    name: "PDF Invoice Generation",
    description: "Generate PDF versions of invoices",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.NO_SHOW_AUTO_CANCEL,
    name: "No-Show Auto Cancel",
    description: "Automatically cancel bookings when customer is a no-show",
    scope: "BRANCH",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.CANCELLATION_FEE_100_PERCENT,
    name: "100% Cancellation Fee",
    description: "Charge 100% cancellation fee on no-shows",
    scope: "SYSTEM",
    defaultEnabled: false,
  },
  {
    key: FeatureFlagKey.GPS_TRACKING,
    name: "GPS Tracking",
    description: "Enable GPS tracking for rented vehicles",
    scope: "VEHICLE",
    defaultEnabled: false,
  },
  {
    key: FeatureFlagKey.AUTO_DISTANCE_CALCULATION,
    name: "Auto Distance Calculation",
    description: "Automatically calculate distance driven from GPS data",
    scope: "SYSTEM",
    defaultEnabled: false,
  },
  {
    key: FeatureFlagKey.USE_IST_TIMEZONE,
    name: "Use IST Timezone",
    description: "Use Indian Standard Time for all datetime operations",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.PRECISE_HOUR_CALCULATION,
    name: "Precise Hour Calculation",
    description: "Calculate rental duration precisely (5PM-5PM = 1 day, not 2)",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.DETAILED_SALES_REPORT,
    name: "Detailed Sales Report",
    description: "Enable detailed sales reporting with line-item breakdown",
    scope: "SYSTEM",
    defaultEnabled: true,
  },
  {
    key: FeatureFlagKey.REAL_TIME_ANALYTICS,
    name: "Real-Time Analytics",
    description: "Enable real-time dashboard analytics",
    scope: "SYSTEM",
    defaultEnabled: false,
  },
];
