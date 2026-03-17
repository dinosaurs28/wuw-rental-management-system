// ============================================================================
// Report Type Definitions
// ============================================================================

export interface DateRange {
  startDate: Date | string;
  endDate: Date | string;
}

export interface ReportMetadata {
  generatedAt: string;
  dateRange?: DateRange;
  branch?: string;
  filters?: Record<string, any>;
}

// ============================================================================
// Daily Summary Report Types
// ============================================================================

export interface DailySummaryRevenue {
  newBookings: number;
  advanceCollected: number;
  depositCollected: number;
  totalCollected: number;
}

export interface DailySummaryBookings {
  newBookings: number;
  pickups: number;
  returns: number;
  cancellations: number;
  active: number;
}

export interface DailySummaryVehicles {
  availableStartOfDay: number;
  availableEndOfDay: number;
  rentedOut: number;
  returned: number;
  currentUtilization: number;
}

export interface CollectionBreakdownItem {
  method: string;
  amount: number;
  count: number;
}

export interface DailySummaryCollections {
  cash: number;
  upi: number;
  online: number;
  total: number;
  breakdown: CollectionBreakdownItem[];
}

export interface DailySummaryDamages {
  newReports: number;
  totalEstimatedCost: number;
  pendingApproval: number;
}

export interface DailySummaryMaintenance {
  vehiclesServiced: number;
  totalCost: number;
}

export interface DailySummaryComparison {
  revenueVsYesterday: number;
  bookingsVsYesterday: number;
  revenueVsLastWeekSameDay: number;
}

export interface DailySummaryReport {
  metadata: {
    date: string;
    branch: string;
    generatedAt: string;
  };
  revenue: DailySummaryRevenue;
  bookings: DailySummaryBookings;
  vehicles: DailySummaryVehicles;
  collections: DailySummaryCollections;
  damages: DailySummaryDamages;
  maintenance: DailySummaryMaintenance;
  comparison: DailySummaryComparison;
}

// ============================================================================
// Sales Report Types
// ============================================================================

export interface SalesReportSummary {
  totalRevenue: number;
  totalBookings: number;
  averageBookingValue: number;
  taxCollected: number;
  depositsCollected: number;
  netRevenue: number;
  outstandingAmount: number;
}

export interface SalesBreakdownItem {
  status?: string;
  branch?: string;
  category?: string;
  count: number;
  revenue: number;
}

export interface SalesReportBreakdown {
  byStatus: SalesBreakdownItem[];
  byBranch: SalesBreakdownItem[];
  byCategory: SalesBreakdownItem[];
}

export interface SalesReportBooking {
  bookingId: string;
  bookingDate: string;
  invoiceNumber: string;
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  vehicle: {
    regNo: string;
    details: string;
  };
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
  financial: {
    baseAmount: number;
    discount: number;
    taxableAmount: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    depositAmount: number;
    totalAmount: number;
    amountPaid: number;
    balanceAmount: number;
  };
  payment: {
    depositMethod: string;
    paymentStatus: string;
    transactionId?: string;
  };
  status: string;
  branch: string;
  createdBy: string;
}

export interface Pagination {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface SalesReport {
  metadata: ReportMetadata;
  summary: SalesReportSummary;
  breakdown: SalesReportBreakdown;
  data: SalesReportBooking[];
  pagination: Pagination;
}

// Type aliases for convenience
export type SalesBooking = SalesReportBooking;
export type VehicleBookingHistory = BookingHistoryItem;

// ============================================================================
// Vehicle History Report Types
// ============================================================================

export interface VehicleInfo {
  publicId: string;
  regNo: string;
  make: string;
  model: string;
  year: number; // Added
  category: string;
  branch: string;
  status: string;
  purchaseDate?: string;
  purchasePrice?: number; // Added
  currentOdometer: number;
  fuelLevel?: number;
  insuranceExpiry?: string | null; // Added
  permitExpiry?: string | null; // Added
}

export interface VehiclePerformanceMetrics {
  totalRevenue: number;
  totalBookings: number;
  totalDaysRented?: number;
  utilizationRate: number;
  avgRevenuePerBooking: number; // Added
  avgBookingValue?: number;
  avgRentalDuration?: number;
  totalMaintenanceCost: number;
  totalDamageCost: number; // Added
  netProfitability: number;
  roi: number;
  vehicleAge?: number; // Added
}

export interface CurrentBookingInfo {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  expectedReturnDate: string;
  daysRemaining: number;
}

export interface VehicleCurrentStatus {
  isRented: boolean;
  currentBooking?: CurrentBookingInfo;
}

export interface UpcomingBooking {
  bookingId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  days: number;
  amount: number;
}

export interface BookingHistoryItem {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  days: number;
  revenue: number;
  depositAmount: number;
  status: string;
  damageReported: boolean;
  returnCondition: string;
}

export interface MaintenanceRecord {
  id?: number; // Added
  publicId?: string;
  date: string;
  description: string;
  cost: number;
  odometer: number;
  servicedBy: string;
  nextServiceDue?: string | null; // Added
}

export interface DamageRecord {
  id?: number; // Added
  publicId?: string;
  bookingId?: string; // Added
  customerName?: string; // Added
  reportedDate?: string; // Added
  date?: string;
  severity?: string;
  description: string;
  estimatedCost: number;
  actualCost?: number; // Changed from finalCost
  finalCost?: number;
  status: string;
  customerCharged?: boolean;
  images?: string[]; // Added
}

export interface InsuranceInfo {
  policyNumber: string;
  provider: string;
  validTill: string;
  daysUntilExpiry: number;
}

export interface MonthlyDataPoint {
  month: string;
  revenue?: number;
  bookings?: number;
  utilization?: number;
}

export interface VehicleAnalytics {
  monthlyRevenueTrend: MonthlyDataPoint[];
  utilizationTrend: MonthlyDataPoint[];
  peakBookingMonths: string[];
  averageCustomerRating?: number;
}

export interface UpcomingAlert {
  date: string;
  daysRemaining: number;
}

export interface UpcomingAlerts {
  insuranceExpiry: UpcomingAlert | null;
  permitExpiry: UpcomingAlert | null;
  nextServiceDue: UpcomingAlert | null;
}

export interface VehicleHistoryReport {
  vehicle: VehicleInfo;
  performanceMetrics: VehiclePerformanceMetrics;
  currentStatus: VehicleCurrentStatus;
  upcomingBookings?: UpcomingBooking[];
  bookingHistory: {
    total?: number;
    totalCount?: number;
    data: BookingHistoryItem[];
    pagination?: Pagination;
  };
  maintenanceHistory: MaintenanceRecord[];
  damageHistory: DamageRecord[];
  insuranceInfo?: InsuranceInfo;
  analytics?: VehicleAnalytics;
  upcomingAlerts?: UpcomingAlerts; // Added
}

// ============================================================================
// Filter Types
// ============================================================================

export type DateRangePreset =
  | "current"
  | "15days"
  | "30days"
  | "60days"
  | "90days"
  | "custom";

export interface ReportFilters {
  dateRangePreset: DateRangePreset;
  startDate?: Date;
  endDate?: Date;
  branchId?: string;
  status?: string;
  categoryId?: string;
  paymentStatus?: string;
}

// ============================================================================
// Export Types
// ============================================================================

export type ExportFormat = "xlsx" | "csv";

export interface ExportOptions {
  format: ExportFormat;
  filename: string;
  data: any;
}
