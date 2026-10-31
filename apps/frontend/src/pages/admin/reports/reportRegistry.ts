/**
 * Every admin report, grouped by client-spec section (Oct 31 2026 TODO).
 * The Reports Hub renders this list. Owners flip `available` on their own
 * entries when the page is routed:
 *   1 + 9 + legacy → rpt-core · 2.x → rpt-finance · 3.x, 7.x, 8.x → rpt-bookings ·
 *   4.x, 5.x, 6.1 → rpt-fleet
 */

export interface ReportEntry {
  id: string;
  title: string;
  description: string;
  path: string;
  available: boolean;
  /** Filters this report honours (shown as chips in the hub). */
  filters?: ("date" | "branch" | "category" | "vehicle")[];
  csv?: boolean;
  compare?: boolean;
}

export interface ReportSection {
  id: string;
  title: string;
  reports: ReportEntry[];
}

const ALL: ReportEntry["filters"] = ["date", "branch", "category", "vehicle"];

export const REPORT_SECTIONS: ReportSection[] = [
  {
    id: "1",
    title: "1 · Dashboard",
    reports: [
      {
        id: "1",
        title: "Dashboard Home",
        description: "Today's revenue, MTD vs last month, fleet status, utilisation, pickups/returns, dues and alerts.",
        path: "/admin/dashboard",
        available: true,
        filters: ["branch", "category"],
        compare: true,
      },
    ],
  },
  {
    id: "2",
    title: "2 · Financial",
    reports: [
      { id: "2.1", title: "Revenue Summary", description: "Daily/weekly/monthly revenue by branch, category and vehicle, vs previous period.", path: "/admin/reports/revenue-summary", available: true, filters: ALL, csv: true, compare: true },
      { id: "2.2", title: "Payments & Collections", description: "By mode and staff, transaction-level reconciliation, recorded vs received.", path: "/admin/reports/payments-collections", available: true, filters: ALL, csv: true, compare: true },
      { id: "2.3", title: "Outstanding Dues & Aging", description: "Unpaid balances per customer in 0–7, 8–30 and 30+ day buckets.", path: "/admin/reports/outstanding-dues", available: true, filters: ["branch", "category", "vehicle"], csv: true },
      { id: "2.4", title: "Security Deposits", description: "Held, refunded and deducted deposits with reasons, reconcilable with rentals.", path: "/admin/reports/security-deposits", available: true, filters: ALL, csv: true },
      { id: "2.5", title: "Discounts & Refunds", description: "Discounts applied and refunds issued, with who, why and booking details.", path: "/admin/reports/discounts-refunds", available: true, filters: ALL, csv: true, compare: true },
    ],
  },
  {
    id: "3",
    title: "3 · Bookings",
    reports: [
      { id: "3.1", title: "Booking Summary", description: "Upcoming / active / completed / cancelled by branch and category.", path: "/admin/reports/booking-summary", available: true, filters: ALL, csv: true, compare: true },
      { id: "3.2", title: "Cancellations & No-Shows", description: "Counts, recorded reasons and estimated revenue lost.", path: "/admin/reports/cancellations", available: true, filters: ALL, csv: true, compare: true },
      { id: "3.3", title: "Booking Source", description: "Walk-in vs app: volume and revenue.", path: "/admin/reports/booking-source", available: true, filters: ALL, csv: true, compare: true },
      { id: "3.4", title: "Rental Duration & Lead Time", description: "Average rental length and booking lead time.", path: "/admin/reports/duration-lead-time", available: true, filters: ALL, csv: true, compare: true },
      { id: "3.5", title: "Extensions & Late Returns", description: "Extended rentals, late returns, late fees charged vs collected.", path: "/admin/reports/extensions-late-returns", available: true, filters: ALL, csv: true, compare: true },
    ],
  },
  {
    id: "4",
    title: "4 · Fleet performance",
    reports: [
      { id: "4.1", title: "Vehicle Utilization", description: "Rented days ÷ available days per vehicle and category.", path: "/admin/reports/fleet/utilization", available: true, filters: ALL, csv: true, compare: true },
      { id: "4.2", title: "Idle Vehicles", description: "Vehicles not rented for N days, with last rental date.", path: "/admin/reports/fleet/idle", available: true, filters: ["branch", "category", "vehicle"], csv: true },
      { id: "4.3", title: "Vehicle Profitability", description: "Revenue vs recorded costs per vehicle.", path: "/admin/reports/fleet/profitability", available: true, filters: ALL, csv: true, compare: true },
      { id: "4.4", title: "Kilometres & Mileage", description: "Km per trip and vehicle, excess-km charges.", path: "/admin/reports/fleet/km", available: true, filters: ALL, csv: true, compare: true },
      { id: "4.3a", title: "Vehicle Expenses", description: "Record maintenance, repair and other costs per vehicle (feeds 4.3 and 5.1).", path: "/admin/reports/fleet/expenses", available: true, filters: ALL, csv: true },
    ],
  },
  {
    id: "5",
    title: "5 · Damage & downtime",
    reports: [
      { id: "5.1", title: "Damage Report", description: "Damages logged, repair cost vs recovered from customer.", path: "/admin/reports/fleet/damage", available: true, filters: ALL, csv: true, compare: true },
      { id: "5.2", title: "Vehicle Downtime", description: "Days out of service per vehicle and effect on utilisation.", path: "/admin/reports/fleet/downtime", available: true, filters: ALL, csv: true, compare: true },
    ],
  },
  {
    id: "6",
    title: "6 · Compliance",
    reports: [
      { id: "6.1", title: "Vehicle Document Expiry", description: "Insurance, RC, permit, PUC and fitness expiring in 30 days.", path: "/admin/reports/fleet/document-expiry", available: true, filters: ["branch", "category", "vehicle"], csv: true },
    ],
  },
  {
    id: "7",
    title: "7 · Customers",
    reports: [
      { id: "7.1", title: "Customer Summary", description: "New vs repeat customers, top customers by revenue.", path: "/admin/reports/customer-summary", available: true, filters: ALL, csv: true, compare: true },
      { id: "7.2", title: "Customer History & Lifetime Value", description: "Trips, total spend and dues per customer.", path: "/admin/reports/customer-ltv", available: true, filters: ALL, csv: true },
    ],
  },
  {
    id: "8",
    title: "8 · Branches & staff",
    reports: [
      { id: "8.1", title: "Branch Comparison", description: "Revenue, utilisation and dues per branch.", path: "/admin/reports/branch-comparison", available: true, filters: ["date", "category"], csv: true, compare: true },
      { id: "8.2", title: "Staff Activity", description: "Bookings, payments, cash and handovers per staff member.", path: "/admin/reports/staff-activity", available: true, filters: ["date", "branch"], csv: true },
    ],
  },
  {
    id: "legacy",
    title: "Existing reports",
    reports: [
      { id: "L1", title: "Global Reports", description: "KPI overview with trends.", path: "/admin/reports", available: true },
      { id: "L2", title: "Daily Summary", description: "One day's bookings, collections and fleet status.", path: "/admin/reports/daily-summary", available: true },
      { id: "L3", title: "Sales", description: "Booking value by start date (the dashboard's booking-value figure).", path: "/admin/reports/sales", available: true },
      { id: "L4", title: "Collection", description: "Money received by date and mode.", path: "/admin/reports/collection", available: true },
      { id: "L5", title: "Receipts", description: "Receipt register.", path: "/admin/reports/receipts", available: true },
      { id: "L6", title: "Invoices", description: "Invoice register.", path: "/admin/reports/invoices", available: true },
      { id: "L7", title: "GST", description: "Output GST.", path: "/admin/reports/gst", available: true },
      { id: "L8", title: "Customers (legacy)", description: "Customer list report.", path: "/admin/reports/customers", available: true },
      { id: "L9", title: "Fleet Executive", description: "Per-executive bookings and collections.", path: "/admin/reports/fleet-executive", available: true },
      { id: "L10", title: "Vehicle Availability", description: "Availability calendar.", path: "/admin/reports/vehicle-availability", available: true },
      { id: "L11", title: "Insurance & Permit Expiry", description: "Insurance expiry list.", path: "/admin/reports/insurance-permit-expiry", available: true },
      { id: "L12", title: "Vehicle Reports", description: "Per-vehicle history.", path: "/admin/vehicle-reports", available: true },
    ],
  },
];

/** Lookup by spec id ("2.1") — used for dashboard click-throughs. */
export const reportById = (id: string): ReportEntry | undefined =>
  REPORT_SECTIONS.flatMap((s) => s.reports).find((r) => r.id === id);
