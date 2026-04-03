# Reports & Billing — Status Document

> **Revenue definition (agreed):** Revenue = total amount billed across all bookings (base rent + damage + extensions + other charges), regardless of whether payment has been collected. Collected vs. outstanding is a separate axis shown within each report.

---

## 1. Invoice Report *(while billing)*

**What is it:** Admin-level report listing all invoices raised across bookings — filterable by date, branch, status (PENDING / FINALIZED / PAID), with revenue vs. outstanding split.

| Layer | Status | Notes |
|---|---|---|
| DB model | ✅ Done | `Invoice` model — invoiceNumber, subtotal, discount, tax, damageCharges, total, status |
| Per-booking PDF generation | ✅ Done | `POST /api/invoices/download`, `GET /api/invoices/status/:invoiceId` |
| Admin Invoice Report (listing) | ❌ Missing | No endpoint or page to list/filter invoices across all bookings. The `SalesReport` shows booking-level revenue but is not an invoice-level listing. |
| Revenue split (billed vs. outstanding) | ⚠️ Partial | `SalesReport` has `outstandingAmount` metric but it's booking-level, not invoice-level. |

**Remaining work:**
- Backend: `GET /api/admin/reports/invoices` — list invoices with filters (date range, branch, status), aggregates: total billed, collected, outstanding.
- Frontend: Invoice Report page under Admin → Reports.

---

## 2. Receipt Report *(after return — extra charges: deposit, damage, etc.)*

**What is it:** Report listing all return receipts generated, with line items for safety deposit, damage charges, fuel, fastag, extra KM/time. Also needs a **Credit Note** option (see §7).

| Layer | Status | Notes |
|---|---|---|
| DB model | ✅ Done | `ReturnReceipt` — receiptNumber, lineItems (JSON), totalCharges, depositPaid, amountDue, refundAmount |
| Per-booking receipt fetch | ✅ Done | `GET /api/receipts/:bookingId` |
| Admin Receipt Report (listing) | ❌ Missing | No report page or endpoint to list receipts across all bookings. |
| Credit Note option on receipt | ❌ Missing | Completely absent — see §7. |

**Remaining work:**
- Backend: `GET /api/admin/reports/receipts` — list receipts with filters, show totals.
- Frontend: Receipt Report page under Admin → Reports.
- Credit Note feature (see §7).

---

## 3. Payment Method Report

**What is it:** Breakdown of collections by payment method (Cash / UPI / Online-Razorpay / Split) across date range and branch.

| Layer | Status | Notes |
|---|---|---|
| Backend endpoint | ✅ Done | `GET /api/admin/dashboard/reports/payment-methods` (`GetPaymentMethodBreakdown` in analytics.controller) |
| Collection Report (includes method breakdown) | ✅ Done | `GET /api/admin/dashboard/reports/collection` — shows method-wise totals + daily trend |
| Standalone report page | ⚠️ Partial | `CollectionReportPage.tsx` exists and shows method breakdown. No dedicated "Payment Method" page, but the collection report covers it adequately. |
| Revenue vs. collected distinction | ⚠️ Issue | Collection report uses `Payment` table (actual collected). It does not show billed-but-not-collected (outstanding) — needs a revenue column alongside collected. |

**Remaining work:**
- Clarify whether a separate "Payment Method Report" page is needed, or if the Collection Report is sufficient.
- Add an "Outstanding Revenue" column to the Collection Report to distinguish total billed from collected.

---

## 4. Fleet Executive Wise Report

**What is it:** Executive-level view — fleet utilization, revenue per vehicle, branch-wise and category-wise performance, damage/maintenance rates.

| Layer | Status | Notes |
|---|---|---|
| Backend | ✅ Done | `GET /api/admin/dashboard/reports/fleet-executive` (`GetFleetExecutiveReport`) |
| Frontend | ✅ Done | `FleetExecutivePage.tsx` + `FleetExecutiveReport.tsx` |
| KPIs | ✅ Done | Total revenue, active bookings, fleet utilization %, damage rate % |
| Branch performance table | ✅ Done | Vehicles, active, bookings, revenue, avg value, utilization % per branch |
| Category performance | ✅ Done | Revenue + bookings by vehicle category, pie + detail table |
| Operational metrics | ✅ Done | Damage reports count/rate, maintenance records count/rate |
| Export | ✅ Done | Export button with date filter |
| Revenue definition alignment | ⚠️ Check | Verify the controller sums `totalFinal` (billed) not just collected payments. |

**Status: Mostly done.** Minor review needed on revenue field used.

---

## 5. Customer Report

**What is it:** Report showing all customers — booking count, total revenue generated (billed), amount collected, outstanding credits, last booking date, KYC status.

| Layer | Status | Notes |
|---|---|---|
| DB model | ✅ Done | `Customer`, `Booking`, `CustomerCreditEntry` all exist |
| Backend report endpoint | ❌ Missing | No `/api/admin/reports/customers` endpoint |
| Frontend page | ❌ Missing | No Customer Report page in Admin → Reports |
| Outstanding credit per customer | ⚠️ Partial | `CustomerCreditEntry` tracks credit at booking level. An admin customer report would aggregate this. |

**Remaining work:**
- Backend: `GET /api/admin/reports/customers` — list customers with total bookings, total billed, collected, outstanding, last activity.
- Frontend: Customer Report page under Admin → Reports.

---

## 6. Insurance Report *(+ Admin Alert)*

### 6a. Insurance & Permit Expiry Report

| Layer | Status | Notes |
|---|---|---|
| DB model | ✅ Done | `VehicleInsurance` (policyNumber, provider, validTill) + `insuranceExpiry` on Vehicle |
| Backend report endpoint | ✅ Done | `GET /api/admin/dashboard/reports/insurance-permit-expiry` (`GetInsurancePermitExpiry`) |
| Frontend page | ✅ Done | `InsurancePermitExpiryPage.tsx` + `InsurancePermitExpiryReport.tsx` |
| Filters | ✅ Done | Days threshold (30/60/90/180), alert type (insurance/permit/both), branch |
| Alert levels | ✅ Done | EXPIRED / CRITICAL / HIGH / MEDIUM / LOW with colour coding |
| Charts | ✅ Done | Alert distribution (pie) + branch-wise breakdown (bar) |
| Manager view | ✅ Done | `ManagerInsuranceExpiryPage.tsx` exists |
| Export | ✅ Done | Export button |

### 6b. Admin Insurance Alert (badge/notification)

| Layer | Status | Notes |
|---|---|---|
| BullMQ worker | ✅ Done | Runs daily at 08:00, checks expired + expiring-in-7-days counts, caches in Redis |
| Alert counts endpoint | ✅ Done | `GET /api/insurance-alerts/counts` — returns `{expiredCount, expiringCount, total}` |
| Admin dashboard alert banner | ❌ Missing | Admin layout / dashboard does not display an alert banner or badge when vehicles have expired/expiring insurance. The data is available but not surfaced in the UI. |

**Remaining work:**
- Add an alert banner or sidebar badge in `AdminLayout.tsx` / admin dashboard that calls `/api/insurance-alerts/counts` and shows a warning when `total > 0`.
- Optionally surface the same in manager layout (already has `ManagerInsuranceExpiryPage.tsx` but no count badge).

---

## 7. Credit Note *(on Receipt)*

**What is it:** When generating a receipt, a Credit Note can be issued to represent a discount/waiver. It must reference the original invoice/bill so there is an audit trail of which bill received the discount and how much.

| Layer | Status | Notes |
|---|---|---|
| DB model | ❌ Missing | No `CreditNote` model. `ManualDiscount` exists for booking-level discount approvals, but it is not a formal credit note. |
| Reference to source invoice/receipt | ❌ Missing | No link between a credit note and its originating invoice number |
| Backend endpoints | ❌ Missing | No create/list/fetch credit note APIs |
| Frontend — credit note option on receipt | ❌ Missing | Receipt view has no "Issue Credit Note" action |
| PDF generation for credit note | ❌ Missing | No credit note PDF |

**What needs to be built:**

### DB — new `CreditNote` model (suggested)
```
CreditNote {
  id, publicId
  creditNoteNumber       String   (auto-generated, e.g. CN-2026-001)
  receiptId              String?  → ReturnReceipt (if issued at return)
  invoiceId              String?  → Invoice (if issued at billing)
  bookingId              String   → Booking
  amount                 Decimal
  reason                 String
  issuedById             String   → User (staff who issued)
  approvedById           String?  → User (manager approval if needed)
  status                 Enum     PENDING_APPROVAL | APPROVED | REJECTED
  pdfFileId              String?  → FileRecord
  createdAt, updatedAt
}
```

### Backend
- `POST /api/manager/receipts/:bookingId/credit-note` — issue credit note (links to receipt + invoice)
- `GET /api/manager/receipts/:bookingId/credit-notes` — list credit notes for a booking
- `GET /api/admin/reports/credit-notes` — admin listing with filters

### Frontend
- Add "Issue Credit Note" button on the return receipt view
- Credit note form: amount, reason, reference displayed (invoice number + receipt number auto-populated)
- Credit note PDF generation
- Admin Credit Notes report page

---

## Summary Table

| Feature | Backend | Frontend | Status |
|---|---|---|---|
| Invoice (per booking PDF) | ✅ | ✅ | Done |
| **Invoice Report** (admin listing) | ✅ | ✅ | **Built** — `GET /api/admin/dashboard/reports/invoices` + `/admin/reports/invoices` |
| Receipt (per booking fetch) | ✅ | ✅ | Done |
| **Receipt Report** (admin listing) | ✅ | ✅ | **Built** — `GET /api/admin/dashboard/reports/receipts` + `/admin/reports/receipts` |
| **Credit Note** (on receipt, with reference) | ✅ | ✅ | **Built** — DB model + `POST/GET /api/branchManager/credit-notes` + `CreditNoteDialog` component |
| Payment Method breakdown (via Collection Report) | ✅ | ✅ | Done — review revenue vs. collected |
| Fleet Executive Report | ✅ | ✅ | Done |
| **Customer Report** | ✅ | ✅ | **Built** — `GET /api/admin/dashboard/reports/customers` + `/admin/reports/customers` |
| Insurance & Permit Expiry Report | ✅ | ✅ | Done |
| Insurance Alert (backend worker + counts API) | ✅ | ✅ | Done — badge shown in admin sidebar |
| Revenue definition (billed, not just collected) | ⚠️ | ⚠️ | Invoice/Customer/Fleet reports use totalFinal (billed). Collection report still shows collected only — by design. |

---

## Priority Recommendations

1. **Credit Note** — foundational, impacts receipt flow and financial audit trail
2. **Invoice Report** — needed for accounts/billing reconciliation
3. **Customer Report** — useful for sales and credit tracking
4. **Insurance Alert banner in Admin UI** — backend is ready, just needs UI wiring
5. **Receipt Report** — listing across all bookings
6. **Revenue definition audit** — ensure all reports sum `totalFinal` (billed) not payment records
