# Admin Reports Module — Spec Conformance Design

**Date:** 2026-05-30
**Author:** Claude (with sushanshetty1)
**Source spec:** `WUW_Admin_Reports_Spec.pages` (v1.0 · May 2026) — "Reports Module: Complete Specification"
**Status:** Approved approach (A). Pending detailed implementation plan.

---

## 1. Problem & Framing

The Admin Reports module **already exists** (backend + frontend): a dashboard with 6 KPI cards plus
~11 detailed reports, CSV/Excel export utilities, routes, and pages. The May 2026 spec is newer and far
more precise than what was implemented. This is therefore an **audit-and-conform** task — bring the
existing, working module into exact conformance with the spec — **not** a greenfield rebuild.

### Root cause (the "100k vs 61.2k bug", spec §0.2)

Every revenue-bearing report anchors its date range on `booking.createdAt` (when the booking was *made*)
instead of `booking.startAt` (the rental *start date* the spec mandates). There is **no shared filter
module** — all 14 controllers reimplement their own date/status/category logic, so widgets disagree on
the same filters. The fix and the bug are the same thing: a single shared reporting filter that encodes
the canonical revenue definition, consumed by every report and every dashboard card.

---

## 2. Canonical Conventions (the single source of truth)

These are derived from spec §0 reconciled with the actual Prisma schema. **All reports must use these.**

| Concept | Canonical rule |
|---|---|
| **Status mapping** | spec `confirmed` = `CONFIRMED`; `active` = `PICKED_UP`; `completed` = `RETURNED`; `cancelled` = `CANCELLED`. |
| **Revenue status set** | `[CONFIRMED, PICKED_UP, RETURNED]`. Exclude `HOLD`, `HOLD_EXPIRED`, `CANCELLED`. |
| **Revenue field** | `SUM(booking.totalFinal)`. (`totalFinal` is the billed total = base − discount + tax.) |
| **Date range anchor (revenue/most reports)** | `booking.startAt` (= spec `booking_start_date`). **Never `createdAt`** unless a report explicitly says otherwise. |
| **Payment-date anchor reports** | Collection, Receipt, Daily Summary cash/UPI columns anchor on payment date (`PaymentTransaction.collectedAt`, fallback `createdAt`). Invoice anchors on `invoice.createdAt`. |
| **Soft delete** | Always `deletedAt: null` on bookings/vehicles. |
| **amount_paid (canonical)** | `SUM(PaymentTransaction.totalAmount)` WHERE `status IN (COLLECTED, CONFIRMED)` AND `purpose IN (ADVANCE, REMAINING_BALANCE, FULL_PAYMENT, EXTENSION, DAMAGE_FEE)`. Cash = `cashAmount`, online/UPI/gateway = `onlineAmount` (+ `onlineGateway`). Collector = `collectedById`. (Already used by Sales + Collection — standardize everywhere.) |
| **Category filter** | Booking has no `categoryId`. Filter via `bookingItems.some({ vehicle: { categoryId / category.publicId } })`. For vehicle-centric reports, filter `vehicle.categoryId` directly. |
| **GST split** | Per-`BookingItem` `cgstAmount` + `sgstAmount`. **No `igstAmount` column exists** (treat IGST = 0 / intra-state). Never recompute from `invoice.tax / 2`. |
| **Branch filter** | Frontend sends branch `publicId`; filter via relation `branch: { publicId }`. "All Branches" = no filter. |
| **Previous period** | Same-duration window immediately before the selected range, computed server-side. |

### Deferred / shown-as-blank (no schema change — documented)

- **Input GST (GST Report Section B):** requires `Expense`/`VendorInvoice` tables that do not exist. Deferred.
  GST report renders Section A (Output) fully; Section B shows "Input GST not configured"; Net Liability = Output total.
- **Customer GSTIN:** not stored. Column rendered blank (spec §GST: "if GSTIN not captured, leave blank — do not error").
- **Insurance Start Date:** `VehicleInsurance` has only `validTill`, no `validFrom`. Column rendered blank.

---

## 3. Architecture — Shared Reporting Core (built first)

New backend module (e.g. `apps/backend/src/utils/reporting/` or `src/services/reporting/`), consumed by
every report controller and the dashboard:

1. **`resolveReportRange(query)`** → `{ start, end, prevStart, prevEnd, days }`.
   Presets: Today, Last 7 Days, Last 30 Days (default), This Month, Last Month, Custom. Single shared context.
2. **`REVENUE_STATUSES`** constant + status mapping helpers.
3. **`buildBookingWhere({ branchPublicId, from, to, categoryPublicIds, statuses? })`** → Prisma `where`:
   `startAt` anchor, branch relation, category via `bookingItems.some(...)`, `deletedAt: null`, status set.
4. **`getPaidByBooking(bookingIds)`** → `Map<bookingId, { total, cash, online }>` using the canonical
   PaymentTransaction rule. Plus `getCollectionsByDate` / `getCollectionsByCollector` variants for
   Collection / Daily Summary / Fleet Executive.
5. **CSV core (extend `apps/backend/src/utils/exportToCSV.ts`)**: per-report column-ordered exporters that
   exactly match the spec's CSV column lists, plus summary/total rows. One helper for "append summary row".

**Frontend:** one shared filter bar (`ReportFilters`) matching spec presets, category **multiselect sent as
an array** (current code sends only the first item), Apply/Reset, single context object. Shared CSV download
already exists (`ExportButton` + `triggerExport`) — reuse.

---

## 4. Per-Report Conformance Requirements

For each: fix controller calc + columns, frontend table columns/order, CSV column order + summary rows,
sort default, and edge cases, all via the shared core. Cross-report invariants (§5) must hold.

### 4.0 Global Dashboard (`global-kpi` → keep endpoint, conform output)
- Revenue, Avg Booking Value: anchor `startAt` (not `createdAt`); apply category filter.
- **Pending Revenue** = `SUM(totalFinal − amount_paid)` WHERE `status = CONFIRMED` AND `amount_paid < totalFinal`; sub "X confirmed bookings"; no % badge.
- **Total Customers** = `COUNT(DISTINCT customer)` with bookings **in range**; sub shows all-time count; % badge = new-in-range vs prev.
- **Fleet Utilization** = active bookings now / total vehicles × 100; % badge vs prev.
- Apply category filter to all 6 cards. Add This Month / Last Month presets. Keep single endpoint.

### 4.1 Sales Report (master reconciliation)
- Anchor `startAt`; sort `startAt DESC`. Filters: Branch, Date, **Category**, Status, **Payment Mode**.
- Columns (exact spec order): Booking ID, Booking Date, Start, End, Customer, Phone, Vehicle Reg, Vehicle Name, Category, Branch, Duration, Base, Discount, **GST (single column)**, Total, Amount Paid, Outstanding, Payment Mode, Status.
- GST from `BookingItem.cgst+sgst` (not `tax/2`). Cancelled rows: shown, status Cancelled, **revenue = 0** (excluded from sums). CSV summary row: Total Revenue, Total Collected, Total Outstanding.

### 4.2 Daily Summary (**rebuild to multi-day**)
- Filter: Branch, **Date Range** (one row per calendar day), Category. Show all days incl. zero.
- Per-day columns: Date, New Bookings (`startAt`=day), Active Trips (status active AND start≤day≤end), Completed (returned on day), Revenue (`SUM(totalFinal)` of bookings starting that day), Cash Collected (payments by payment-date), UPI Collected (UPI only), Outstanding, Cancellations (`cancelledAt`=day).
- CSV: tabular per-day rows + TOTAL row summing numeric columns.

### 4.3 Collection Report (cash-flow, payment-date anchored)
- Anchor payment date; sort desc. Filters: Branch, Date, Payment Mode, **Staff/Executive** (`collectedById`).
- Columns: Date, Booking ID, Customer, **Vehicle Reg**, Payment Mode, Amount, **Collected By**, Branch, **Reference No**.
- Credit (outstanding) shown for visibility but **excluded** from Total Collected. Total = Cash + UPI + Gateway. Summary block: Total Cash | UPI | Gateway | Credit | Grand Total. Remove phantom `Type` CSV field.

### 4.4 Receipt Report (**switch to per-payment**)
- Source `PaymentTransaction` (one row per payment, not per `ReturnReceipt`). Anchor payment date; sort desc.
- Filters: Branch, Date, Payment Mode, Staff. Columns: Receipt No, Receipt Date, Booking ID, Invoice No, Customer, Phone, Amount Received, Payment Mode, Transaction Ref, Collected By, Branch. Total row = Σ Amount Received. **Add CSV export.** Must reconcile with Collection totals for same filters.

### 4.5 Vehicle Reports (**new — per-vehicle list**)
- New list endpoint + page (distinct from existing per-vehicle detail). Filters: Branch, Date, Category, Vehicle Status.
- Columns: Reg No, Vehicle Name, Category, Branch, Total Bookings, Total Revenue, Utilisation %, Avg Booking Duration, Status.
- Revenue per vehicle via `bookingItems` join + revenue statuses + `startAt` anchor. Utilisation = rented days (capped to range) / available days (range minus inactive/maintenance). **Zero-booking vehicles still listed with 0s.** Sort Total Revenue DESC. CSV in spec order.

### 4.6 Vehicle Availability (operational, no revenue)
- Add **Next Available From** (`MAX(end) + 1` over active/confirmed) and **Booked Dates in Range** (comma-separated ranges). Booked = status `CONFIRMED`/`PICKED_UP` overlaps day (**exclude HOLD**). **Exclude INACTIVE vehicles.** Fix CSV order + drop extra columns. Sort: most free days first.

### 4.7 Insurance Report (compliance, no revenue)
- Filters: Branch, **Expiry Status** (All / Expiring Soon ≤30d / Expired / Valid), Category.
- 3-level status: Expired (`<today`), Expiring Soon (`today..today+30`), Valid (`>today+30`). Days Until Expiry. Insurance Start Date column **blank** (no DB field). Summary: X Expired / Y Expiring ≤30 / Z Valid. **Implement CSV export** (currently TODO). Sort: Days Until Expiry ASC. Row highlight red/yellow/white (frontend).

### 4.8 Fleet Executive (**redesign to per-staff**)
- One row per executive = `booking.createdById` (null → "Unassigned" row at bottom). Filters: Branch, Date (`startAt`), Executive.
- Columns: Executive Name, Branch, Bookings Handled, Total Revenue, Cash Collected, UPI Collected, Outstanding, Cancellations. Revenue = their bookings (revenue statuses, `startAt`). Cash/UPI = `PaymentTransaction` where `collectedById` = executive. Sort Total Revenue DESC. CSV in spec order.
- The existing branch/category performance report is **preserved** (not deleted); the "Fleet Executive" page surfaces the new per-staff report.

### 4.9 GST Report (Output now; Input deferred)
- Anchor `startAt`. CGST/SGST from `BookingItem` (not `invoice.tax/2`); IGST = 0. Customer GSTIN blank.
- Two-section structure: Section A Output GST (full), Section B Input GST ("not configured" placeholder). Per-section summary rows (Total Taxable/CGST/SGST/IGST/GST) + Net Liability = Output − Input (= Output). GST Type filter (Both/Output/Input). CSV with `Section` + `Document No` columns + summary + net liability rows.

### 4.10 Invoice Report (add payment data)
- Anchor `invoice.createdAt`; sort desc. Filters: Branch, Date, **Payment Status** (Paid/Partial/Unpaid — derived from payments, not `invoice.status`), Customer search.
- Add **Amount Paid** (canonical paid), **Balance Due** (`total − paid`, never negative, flag overpaid), Payment Status, **Vehicle** (name + reg via bookingItems), **Rental Period**. **Implement CSV export** (currently missing); CSV omits PDF link (replace with Invoice No). Validate `base − discount + gst = total`.

### 4.11 Customer Report
- Anchor `startAt`; only customers with bookings in range; sort Revenue in Range DESC. Filters: Branch, Date, **Customer Type** (All/New/Returning).
- Columns: Customer, Phone, Email, Registered On, **Total Bookings (all-time)**, Bookings in Range, Revenue in Range, **Amount Paid (canonical PaymentTransaction, not credit ledger)**, Outstanding (Revenue − Paid), Last Booking Date, **Customer Type** (New = first-ever booking in range; else Returning). Summary row: total customers/revenue/outstanding. **Add CSV export.**

---

## 5. Verification (acceptance gate)

A check script/tests asserting the spec's consistency invariants for identical filters:

1. `Sales Σ(Total, non-cancelled) == Dashboard "Revenue (Selected)" card`.
2. `Dashboard Revenue == Vehicle Reports Σ(Total Revenue)`.
3. `GST Output (Taxable + Total GST)` **reconciles to** Dashboard Revenue for the same filters
   (exact equality not expected — deposits and non-taxable line items are excluded from the GST taxable base;
   assert the difference equals the sum of non-taxable/deposit components).
4. `Collection Grand Total == Receipt Σ(Amount Received)` for same date + payment-mode filters.
5. Per-report: CSV column order matches spec exactly; sort defaults correct; zero/edge rows present.

These must pass before the work is declared complete. Also a manual smoke test of each page with the
default Last-30 filter and one custom range + branch + category combination.

---

## 6. Execution & Parallelization

- **Phase 1 (sequential):** shared reporting core (§3) + extend `exportToCSV.ts` + add route/service/type
  stubs for new/changed endpoints. These are shared files; building them first prevents parallel conflicts.
- **Phase 2 (parallel):** per-report conformance (§4). Each agent owns its controller + frontend component
  + its CSV function body — no shared-file contention once Phase 1 stubs exist. Group by report.
- **Phase 3:** frontend shared filter bar unification + sidebar nav for new Vehicle Reports (list).
- **Phase 4:** verification (§5) + smoke test; fix fallout.

Build order respects the dependency: nothing in Phase 2 starts until Phase 1's shared API is stable.

---

## 7. Out of Scope (explicit)

- Expense / VendorInvoice schema + data-entry UI (and therefore full Input GST). Deferred.
- Customer GSTIN capture; Insurance `validFrom` capture. Columns rendered blank.
- Excel (`.xlsx`) parity beyond what already exists — CSV is the spec's required format; existing Excel
  exporters are updated only where trivially aligned, not expanded.
- Mobile app reporting (separate app).
