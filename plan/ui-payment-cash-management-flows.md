---
goal: UI/UX Flow Reference — Payment & Cash Management System
version: 1.0
date_created: 2026-03-22
owner: UI/UX Team
status: 'Planned'
tags: [ui, ux, payment, cash, flows, design]
---

# Payment & Cash Management — UI/UX Flow Reference

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This document is the authoritative UI/UX design reference for the Payment & Cash Management module of the Vehicle Rental Management System (VRMS). It covers every screen, modal, state badge, user action, and API call for both **Employee** and **Branch Manager** roles.

> **Backend contract note:** All IDs passed in URLs are `publicId` (nanoid string). Internal integer `id` is never exposed to the frontend. All monetary values are `Decimal` strings (e.g., `"1500.00"`), not plain numbers.

---

## Table of Contents

1. [Roles & Access Levels](#1-roles--access-levels)
2. [Global Payment State Badges](#2-global-payment-state-badges)
3. [Flow 1 — Employee: Cash Shift Lifecycle](#3-flow-1--employee-cash-shift-lifecycle)
4. [Flow 2 — Employee: Payment Collection](#4-flow-2--employee-payment-collection)
5. [Flow 3 — Manager: Cash Confirmation Dashboard](#5-flow-3--manager-cash-confirmation-dashboard)
6. [Flow 4 — Manager: Pending Settlements](#6-flow-4--manager-pending-settlements)
7. [Flow 5 — Refund Workflow](#7-flow-5--refund-workflow)
8. [Flow 6 — Manager: Cash Shift Reconciliation](#8-flow-6--manager-cash-shift-reconciliation)
9. [Flow 7 — Booking Pickup Gate](#9-flow-7--booking-pickup-gate)
10. [Error States & Edge Cases](#10-error-states--edge-cases)
11. [API Quick Reference](#11-api-quick-reference)

---

## 1. Roles & Access Levels

| Role | Can Record Payment | Can Confirm/Reject Cash | Can Approve Refunds | Can Reconcile Shift | Can View All Shifts |
|------|--------------------|------------------------|---------------------|---------------------|---------------------|
| **Employee** | Yes | No | No (can request) | No | Own shifts only |
| **Branch Manager** | Yes | Yes | Yes | Yes | All branch shifts |
| **Admin** | No (via admin panel only) | NO | NO | NO | NO |

---

## 2. Global Payment State Badges

Use these badge styles consistently across all screens.

### Financial Lifecycle State (booking-level)

| `lifecycleState` | Badge Label | Color | Icon |
|------------------|-------------|-------|------|
| `UNPAID` | Unpaid | Red | `⚠` |
| `PARTIALLY_PAID` | Partial | Orange | `◑` |
| `PAID_PENDING_CONFIRMATION` | Pending Confirmation | Yellow | `⏳` |
| `FULLY_PAID` | Paid | Green | `✓` |
| `OVERPAID` | Overpaid | Purple | `!` |
| `REFUNDED` | Refunded | Grey | `↩` |

### Transaction Status Badge (transaction-level)

| `status` | Badge Label | Color |
|----------|-------------|-------|
| `INITIATED` | Initiated | Blue |
| `COLLECTED` | Awaiting Confirmation | Yellow |
| `CONFIRMED` | Confirmed | Green |
| `REJECTED` | Rejected | Red |
| `FAILED` | Failed | Red |
| `REFUNDED` | Refunded | Grey |

### Cash Shift Status Badge

| `status` | Badge Label | Color |
|----------|-------------|-------|
| `OPEN` | Shift Open | Blue |
| `CLOSED` | Closed | Green |
| `DISCREPANCY_FLAGGED` | Discrepancy | Red |

---

## 3. Flow 1 — Employee: Cash Shift Lifecycle

### 3.1 Open Shift

**Entry point:** Employee logs in → Dashboard header shows **"No Active Shift"** banner with `[Open Shift]` button.

```
Dashboard Header
┌─────────────────────────────────────────────────────────┐
│  ⚠ No active cash shift.  [Open Shift]                 │
└─────────────────────────────────────────────────────────┘
```

**User action:** Click `[Open Shift]`

**Confirmation modal:**
```
┌─────────────────────────────────────────┐
│  Start Cash Shift                       │
│                                         │
│  This will open a new cash tracking     │
│  session for your account.              │
│                                         │
│       [Cancel]    [Start Shift]         │
└─────────────────────────────────────────┘
```

**API call:** `POST /api/branchManager/payment/shifts`
- Body: `{}` (employee identified from JWT)
- Success response: `{ data: { publicId, status: "OPEN", openedAt } }`

**After success:**
- Header banner changes to: `Shift Open — Started at 09:32 AM  [Close Shift]`
- Shift `publicId` stored in local state (needed for close action)

---

### 3.2 Close Shift

**Entry point:** Employee clicks `[Close Shift]` in header.

**Close Shift Modal:**
```
┌─────────────────────────────────────────────────────────┐
│  Close Cash Shift                                        │
│                                                          │
│  Expected cash total: ₹ 4,200.00                        │
│  (Based on confirmed transactions during this shift)     │
│                                                          │
│  Actual cash counted: [__________] ₹                    │
│                                                          │
│  Discrepancy explanation:                                │
│  [________________________________________________]     │
│  (Required only if actual ≠ expected)                    │
│                                                          │
│       [Cancel]    [Close Shift]                          │
└─────────────────────────────────────────────────────────┘
```

**Validation (client-side):**
- `actualTotal` is required and must be ≥ 0
- If `actualTotal ≠ expectedTotal`, `discrepancyExplanation` becomes required (min 10 chars)
- Show inline error: *"Explanation required when amounts don't match"*

**API call:** `POST /api/branchManager/payment/shifts/{shiftPublicId}/close`
```json
{
  "actualTotal": 3800,
  "discrepancyExplanation": "One customer paid short — difference of ₹400"
}
```

**Response outcomes:**

| `status` in response | UI action |
|----------------------|-----------|
| `CLOSED` | Show success toast: "Shift closed successfully." Header resets to "No Active Shift" |
| `DISCREPANCY_FLAGGED` | Show warning toast: "Shift closed with discrepancy — awaiting manager reconciliation." Header shows `Shift: Discrepancy Flagged` badge |

---

## 4. Flow 2 — Employee: Payment Collection

### 4.1 Entry Point

From any **Booking Detail** screen, a **Payment** tab or section shows:

```
┌──────────────────────────────────────────────────────────────────┐
│  Payment Status                                      [UNPAID ⚠]  │
│                                                                   │
│  Total Due:         ₹ 8,500.00                                   │
│  Collected:         ₹ 0.00                                       │
│  Pending Confirm:   ₹ 0.00                                       │
│  Amount Remaining:  ₹ 8,500.00                                   │
│                                                                   │
│                          [+ Record Payment]                       │
└──────────────────────────────────────────────────────────────────┘
```

**API call to load state:** `GET /api/branchManager/payment/bookings/{bookingPublicId}/financial-state`

---

### 4.2 Record Payment Modal

**Step 1 — Payment Purpose & Method:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Record Payment                              Step 1 of 2         │
│                                                                   │
│  Payment Purpose                                                  │
│  ○ Full Payment      ○ Advance      ○ Remaining Balance          │
│  ○ Extension Fee     ○ Damage Fee                                │
│                                                                   │
│  Payment Method                                                   │
│  ○ Cash              ○ Online       ○ Split (Cash + Online)      │
│                                                                   │
│                       [Cancel]  [Next →]                         │
└─────────────────────────────────────────────────────────────────┘
```

**Step 2 — Amount & Details (varies by method):**

**CASH method:**
```
┌──────────────────────────────────────────────────┐
│  Record Payment — Cash               Step 2 of 2  │
│                                                    │
│  Amount Due:   ₹ 8,500.00                         │
│  Amount:       [__________] ₹                     │
│                                                    │
│  Notes (optional):                                 │
│  [______________________________________________]  │
│                                                    │
│  Idempotency key: [auto-generated, hidden field]   │
│                                                    │
│  [← Back]  [Record Cash Payment]                  │
└──────────────────────────────────────────────────┘
```

**ONLINE method:**
```
┌────────────────────────────────────────────────────┐
│  Record Payment — Online              Step 2 of 2   │
│                                                      │
│  Amount Due:            ₹ 8,500.00                  │
│  Amount:                [__________] ₹              │
│  Transaction Reference: [__________]  (required)    │
│  Gateway:               [UPI / Razorpay / Other ▾]  │
│                                                      │
│  [← Back]  [Record Online Payment]                  │
└────────────────────────────────────────────────────┘
```

**SPLIT method:**
```
┌──────────────────────────────────────────────────────┐
│  Record Payment — Split               Step 2 of 2    │
│                                                       │
│  Total Amount Due:     ₹ 8,500.00                    │
│                                                       │
│  Cash Portion:         [__________] ₹                │
│  Online Portion:       [__________] ₹  (auto-fills)  │
│  ── Must sum to total ────────────────               │
│  Transaction Reference:[__________]  (required)      │
│  Gateway:              [UPI / Razorpay / Other ▾]    │
│                                                       │
│  [← Back]  [Record Split Payment]                    │
└──────────────────────────────────────────────────────┘
```

> **UX note:** Auto-fill `onlineAmount = totalAmount - cashAmount` as the user types the cash portion. Show live validation: *"Cash + Online must equal ₹ 8,500.00"*.

---

### 4.3 API Call

`POST /api/branchManager/payment/transactions`
```json
{
  "bookingPublicId": "abc123...",
  "purpose": "FULL_PAYMENT",
  "method": "SPLIT",
  "totalAmount": 8500,
  "cashAmount": 3500,
  "onlineAmount": 5000,
  "onlineTransactionRef": "pay_xyz789",
  "onlineGateway": "Razorpay",
  "idempotencyKey": "auto-generated-nanoid"
}
```

> **Frontend responsibility:** Generate a unique `idempotencyKey` per modal open (nanoid or UUID). Do NOT regenerate on retry — reuse the same key to prevent duplicate payment on network retry.

---

### 4.4 Response Handling

| Response `status` | UI Action |
|-------------------|-----------|
| `CONFIRMED` | Green toast: *"Payment recorded and confirmed."* Payment section updates to `FULLY_PAID` badge |
| `COLLECTED` | Yellow toast: *"Cash collected — awaiting manager confirmation."* Transaction appears in list with `Awaiting Confirmation` badge |

---

### 4.5 Payment History Section

Below the payment summary, show a transaction list:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Transaction History                                                     │
│                                                                          │
│  #  │ Purpose         │ Method  │ Amount     │ Status              │ By  │
│ ──  │ ──────────────  │ ──────  │ ──────     │ ──────              │ ──  │
│  1  │ Full Payment    │ Cash    │ ₹ 8,500    │ [Awaiting Conf. ⏳] │ Raj │
│  2  │ Damage Fee      │ Online  │ ₹ 1,200    │ [Confirmed ✓]       │ Raj │
└────────────────────────────────────────────────────────────────────────┘
```

**API call:** `GET /api/branchManager/payment/bookings/{bookingPublicId}/transactions`

---

## 5. Flow 3 — Manager: Cash Confirmation Dashboard

### 5.1 Dashboard Entry

**Navigation:** Manager Sidebar → **Cash Confirmations** (with badge showing pending count)

```
Sidebar
│  Dashboard
│  Bookings
│  ── Payments ──
│  ├─ Cash Confirmations  [3]
│  ├─ Settlements
│  └─ Refunds
│  Cash Shifts
```

### 5.2 Pending Cash Confirmations List

**API call:** `GET /api/branchManager/payment/cash/pending?page=1&pageSize=20`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Pending Cash Confirmations                                      [Filter ▾]   │
│                                                                               │
│  Booking       │ Customer     │ Amount     │ Employee  │ Collected │ Action   │
│ ─────────────  │ ──────────── │ ──────     │ ──────    │ ───────── │ ───────  │
│  BK-20250322   │ Arjun Mehta  │ ₹ 8,500    │ Raj Kumar │ 09:45 AM  │ [Review] │
│  BK-20250321   │ Priya Sharma │ ₹ 3,200    │ Raj Kumar │ Yesterday │ [Review] │
│  BK-20250319   │ Dev Patel    │ ₹ 12,000   │ Neha S.   │ 2d ago ⚠  │ [Review] │
└──────────────────────────────────────────────────────────────────────────────┘
```

> **UX note:** Highlight rows in red/orange if `collectedAt` is older than the branch's `delayedCashAlertHours` threshold (e.g., 2 hours). This surfaces delayed cash that triggered a fraud alert.

---

### 5.3 Confirm/Reject Modal

**User clicks `[Review]`:**

```
┌──────────────────────────────────────────────────────────┐
│  Confirm Cash Payment                                      │
│                                                            │
│  Booking:     BK-20250322 (Arjun Mehta)                   │
│  Purpose:     Full Payment                                 │
│  Amount:      ₹ 8,500.00                                  │
│  Collected by: Raj Kumar                                   │
│  Collected at: 22 Mar 2026, 09:45 AM                      │
│                                                            │
│  Notes (optional):                                         │
│  [______________________________________________]          │
│                                                            │
│  [ Reject ]                    [ ✓ Confirm Cash ]         │
└──────────────────────────────────────────────────────────┘
```

**Confirm:** `POST /api/branchManager/payment/cash/{txnPublicId}/confirm`
```json
{ "notes": "Cash counted and verified." }
```

**Reject flow — rejection reason modal:**
```
┌───────────────────────────────────────────────┐
│  Reject Cash Payment                           │
│                                                │
│  Reason for rejection: (required, min 5 chars) │
│  [__________________________________________]  │
│                                                │
│  [Cancel]          [Confirm Rejection]         │
└───────────────────────────────────────────────┘
```

**Reject:** `POST /api/branchManager/payment/cash/{txnPublicId}/reject`
```json
{ "rejectionReason": "Cash amount was short by ₹500" }
```

**After action:** Row removed from pending list. Toast shown. Booking's financial state badge updates live.

---

## 6. Flow 4 — Manager: Pending Settlements

Settlements apply to bookings in **RETURNED** status that still have an outstanding net balance (damage fees, late charges, remaining rental balance).

### 6.1 Settlements List

**Navigation:** Manager Sidebar → **Settlements**

**API call:** `GET /api/branchManager/payment/settlements?page=1&pageSize=20`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Pending Settlements                              [Filter by vehicle/amount]  │
│                                                                               │
│  Booking       │ Customer      │ Vehicle        │ Net Payable │ Action       │
│ ─────────────  │ ─────────── │ ──────────────── │ ──────────  │ ────────     │
│  BK-20250310   │ Arjun Mehta   │ MH-12-AB-3456  │ ₹ 2,800    │ [Settle]     │
│  BK-20250308   │ Priya Sharma  │ MH-14-XY-7890  │ ₹ 500      │ [Settle]     │
│  BK-20250305   │ Dev Patel     │ MH-01-CD-1234  │ −₹ 1,200   │ [Refund Due] │
└──────────────────────────────────────────────────────────────────────────────┘
```

> **UX note:** Negative `netPayable` means the customer is owed a refund — show in blue with `[Refund Due]` CTA that routes to the Refund flow.

---

### 6.2 Settlement Detail View

**User clicks `[Settle]`:**

**API call:** `GET /api/branchManager/payment/settlements/{bookingPublicId}`

```
┌──────────────────────────────────────────────────────────────────┐
│  Settlement Summary — BK-20250310                                 │
│                                                                    │
│  Rental Balance Remaining:   ₹  1,500.00                         │
│  Damage Charges:             ₹  1,800.00   (2 damage reports)    │
│  Extension Charges:          ₹    500.00                         │
│  Already Paid (confirmed):   − ₹ 1,000.00                       │
│  ─────────────────────────────────────────                       │
│  Net Payable by Customer:    ₹  2,800.00                         │
│                                                                    │
│  Payment Method:  ○ Cash   ○ Online   ○ Split                    │
│  Amount:          [₹ 2,800.00]  (pre-filled, editable)           │
│  Transaction Ref: [__________]  (required if Online/Split)        │
│                                                                    │
│                       [Cancel]   [Record Settlement]              │
└──────────────────────────────────────────────────────────────────┘
```

**API call:** `POST /api/branchManager/payment/settlements/{bookingPublicId}/pay`
```json
{
  "purpose": "REMAINING_BALANCE",
  "method": "CASH",
  "totalAmount": 2800,
  "cashAmount": 2800,
  "idempotencyKey": "auto-generated"
}
```

**After success:** Row removed from settlements list. Toast: *"Settlement payment recorded."*

---

## 7. Flow 5 — Refund Workflow

### 7.1 Refund Request (Employee or Manager)

**Entry point:** Booking detail → Payment tab → `[Request Refund]` button

Visible when `lifecycleState` is `FULLY_PAID`, `OVERPAID`, or booking status is `RETURNED`/`CANCELLED`.

```
┌───────────────────────────────────────────────────────────┐
│  Request Refund                                            │
│                                                            │
│  Max refundable:   ₹ 8,500.00                             │
│                                                            │
│  Refund Amount:    [__________] ₹                         │
│  Refund Method:    ○ Cash   ○ Online                      │
│  Reason:           [__________________________________]    │
│                    (min 10 characters, required)           │
│                                                            │
│              [Cancel]    [Submit Refund Request]           │
└───────────────────────────────────────────────────────────┘
```

**API call:** `POST /api/branchManager/payment/refunds`
```json
{
  "bookingPublicId": "abc123...",
  "amount": 2000,
  "reason": "Customer cancelled before pickup — full refund",
  "method": "ONLINE"
}
```

**Response outcomes:**

| Response `status` | UI message |
|-------------------|------------|
| `PENDING_APPROVAL` | *"Refund request submitted — awaiting manager approval."* |
| `APPROVED` | *"Refund auto-approved and ready to disburse."* (when `refundApprovalRequired=false`) |

---

### 7.2 Manager: Refund Approvals Queue

**Navigation:** Manager Sidebar → **Refunds** (with pending count badge)

**API call:** `GET /api/branchManager/payment/refunds/pending`

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Pending Refund Approvals                                                 │
│                                                                           │
│  Booking       │ Customer      │ Amount   │ Method  │ Reason    │ Action  │
│ ─────────────  │ ────────────  │ ──────── │ ──────  │ ───────── │ ──────  │
│  BK-20250318   │ Arjun Mehta   │ ₹ 2,000  │ Online  │ Cancelled │ [View]  │
│  BK-20250315   │ Priya Sharma  │ ₹ 500    │ Cash    │ Overcharg │ [View]  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 7.3 Refund Approval/Rejection Modal

**User clicks `[View]`:**

**API call:** `GET /api/branchManager/payment/refunds/{publicId}`

```
┌───────────────────────────────────────────────────────────────┐
│  Refund Request Detail                                         │
│                                                                │
│  Booking:      BK-20250318 (Arjun Mehta)                      │
│  Amount:       ₹ 2,000.00                                     │
│  Method:       Online                                          │
│  Reason:       Customer cancelled before pickup — full refund  │
│  Requested by: Raj Kumar  at  18 Mar 2026, 11:00 AM           │
│                                                                │
│  [ Reject ]                          [ ✓ Approve Refund ]     │
└───────────────────────────────────────────────────────────────┘
```

**Approve:** `POST /api/branchManager/payment/refunds/{publicId}/approve`

**Reject:** Triggers rejection reason modal → `POST /api/branchManager/payment/refunds/{publicId}/reject`
```json
{ "rejectionReason": "Refund policy does not apply after 48h" }
```

---

### 7.4 Refund Disbursement (Complete Step)

After approval, the refund moves to `APPROVED` state. The manager must mark it as disbursed.

**On the same refund detail view, the approved refund shows:**

```
┌───────────────────────────────────────────────────────────────┐
│  Refund — Approved ✓                                           │
│                                                                │
│  Amount:       ₹ 2,000.00   Method: Online                    │
│  Approved by:  Manager Name  at 22 Mar 2026, 09:00 AM         │
│                                                                │
│  Online Transaction Reference (optional):                      │
│  [______________________________________________]              │
│                                                                │
│                        [Mark as Disbursed]                     │
└───────────────────────────────────────────────────────────────┘
```

**API call:** `POST /api/branchManager/payment/refunds/{publicId}/complete`
```json
{ "onlineTransactionRef": "refund_pay_abc123" }
```

**After success:** Status changes to `COMPLETED`. Toast: *"Refund disbursed successfully."*

---

## 8. Flow 6 — Manager: Cash Shift Reconciliation

### 8.1 All Shifts Dashboard

**Navigation:** Manager Sidebar → **Cash Shifts**

**API call:** `GET /api/branchManager/payment/shifts?page=1&pageSize=20`

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Cash Shifts                                         [Filter by date/employee]  │
│                                                                                 │
│  Employee   │ Opened At    │ Closed At    │ Expected   │ Actual    │ Status     │
│ ──────────  │ ──────────── │ ──────────── │ ─────────  │ ───────── │ ──────     │
│  Raj Kumar  │ 08:00 AM     │ 06:00 PM     │ ₹ 4,200   │ ₹ 4,200   │ [Closed ✓] │
│  Neha S.    │ 09:00 AM     │ 05:30 PM     │ ₹ 6,500   │ ₹ 6,100   │ [Discrepancy ⚠] │
│  Amit T.    │ 10:00 AM     │ —            │ ₹ 1,800   │ —         │ [Open 🔵]  │
└────────────────────────────────────────────────────────────────────────────────┘
```

> **UX note:** `DISCREPANCY_FLAGGED` rows should have a red left border or row highlight. `OPEN` shifts older than `X` hours (configurable) should show a warning icon.

---

### 8.2 Reconcile Discrepancy

**User clicks on a `DISCREPANCY_FLAGGED` row:**

**API call:** `GET /api/branchManager/payment/shifts/{publicId}`

```
┌──────────────────────────────────────────────────────────────────────┐
│  Shift Detail — Neha S.    [DISCREPANCY ⚠]                          │
│                                                                       │
│  Opened:           22 Mar 2026, 09:00 AM                             │
│  Closed:           22 Mar 2026, 05:30 PM                             │
│  Expected Total:   ₹ 6,500.00  (sum of confirmed cash transactions)  │
│  Actual Total:     ₹ 6,100.00  (entered by employee at close)        │
│  Discrepancy:      − ₹ 400.00                                        │
│  Employee note:    "One customer paid short"                          │
│                                                                       │
│  Manager Reconciliation Note: (required, min 10 chars)               │
│  [__________________________________________________________]         │
│                                                                       │
│                              [Mark as Reconciled]                     │
└──────────────────────────────────────────────────────────────────────┘
```

**API call:** `POST /api/branchManager/payment/shifts/{publicId}/reconcile`
```json
{ "discrepancyExplanation": "Verified with employee — customer shortfall noted. Acceptable." }
```

**After success:** Shift status changes to `CLOSED`. Toast: *"Shift reconciled."*

---

## 9. Flow 7 — Booking Pickup Gate

When a manager attempts to confirm vehicle pickup (`ConfirmPickupWithDeposit`), the backend checks payment state first.

### 9.1 Normal Flow (Payment Complete)

Pickup proceeds normally. No additional UI step needed.

### 9.2 Blocked Flow (Payment Incomplete)

**Backend returns 402 Payment Required:**
```json
{
  "message": "Payment must be collected and confirmed before vehicle pickup",
  "financialState": {
    "lifecycleState": "PAID_PENDING_CONFIRMATION",
    "amountDue": "0.00"
  }
}
```

**UI should display a blocking modal — do NOT silently fail:**

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ Cannot Confirm Pickup                                  │
│                                                            │
│  Payment Status: Pending Confirmation                      │
│  Amount Due:     ₹ 0.00                                   │
│                                                            │
│  Cash has been collected but not yet confirmed by a        │
│  manager. Please confirm the pending cash payment first.   │
│                                                            │
│  [ Go to Cash Confirmations ]          [ Close ]           │
└──────────────────────────────────────────────────────────┘
```

**Routing:** `[Go to Cash Confirmations]` deep-links to the pending cash confirmation for that booking.

> **lifecycleState logic for UI:**
> - `UNPAID` → *"No payment has been collected."*
> - `PARTIALLY_PAID` → *"Payment is incomplete."*
> - `PAID_PENDING_CONFIRMATION` → *"Cash collected but awaiting manager confirmation."* (only shown in strict mode)
> - `FULLY_PAID` → Pickup allowed.

---

## 10. Error States & Edge Cases

### 10.1 Duplicate Payment Prevention (Idempotency)

If the same `idempotencyKey` is submitted twice (e.g., double-tap on submit button), the server returns the original transaction instead of creating a duplicate.

**UI should:**
- Disable the submit button immediately on first click and show a spinner
- Re-enable only on error
- Never re-generate the idempotency key on the same modal session

---

### 10.2 Excess Payment Prevention

If the entered amount would exceed the booking's outstanding balance, the backend returns `400 Bad Request`.

**Inline validation (client-side first, server-side enforced):**
```
Amount entered:  ₹ 10,000
Max allowed:     ₹  8,500
──────────────────────────
⚠ Amount exceeds outstanding balance (₹ 8,500). Please enter ₹ 8,500 or less.
```

---

### 10.3 Employee Cash Limit Exceeded

If `maxCashPerEmployee` is configured and the employee's shift total would exceed it, the backend returns `400 Bad Request`.

**UI toast (error):** *"Cash limit exceeded. This transaction would exceed your allowed cash handling limit. Use online payment instead."*

---

### 10.4 Shift Not Open (When Required)

If `requireShiftSettlement=true` and the employee has no open shift, the system should prompt them to open a shift before collecting cash.

**UI guard:** Before showing the `[+ Record Payment]` button for cash transactions, call `GET /api/branchManager/payment/shifts/me/active`. If `data` is `null` and branch config requires a shift, show:

```
┌──────────────────────────────────────────────────────────┐
│  Open a Cash Shift First                                   │
│                                                            │
│  This branch requires an active cash shift before         │
│  recording cash payments.                                  │
│                                                            │
│                     [ Open Shift ]                         │
└──────────────────────────────────────────────────────────┘
```

---

### 10.5 Network Retry Safety

- Always pass the same `idempotencyKey` on retry
- Show a persistent error toast (not auto-dismissing) on network failure
- Include a `[Retry]` action in the toast

---

## 11. API Quick Reference

> Base URL: `/api/branchManager/payment/`

### Payment Config
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/config` | Get branch payment config |
| `PATCH` | `/config` | Update config (limited manager fields) |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/transactions` | Record a payment |
| `GET` | `/transactions/{publicId}` | Get single transaction |
| `GET` | `/bookings/{bookingPublicId}/transactions` | List all transactions for booking |
| `GET` | `/bookings/{bookingPublicId}/financial-state` | Get financial state |

### Cash Confirmation (Manager)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cash/pending` | List pending cash confirmations |
| `POST` | `/cash/{publicId}/confirm` | Confirm cash payment |
| `POST` | `/cash/{publicId}/reject` | Reject cash payment |

### Settlements
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settlements` | List pending settlements |
| `GET` | `/settlements/{bookingPublicId}` | Get settlement summary |
| `POST` | `/settlements/{bookingPublicId}/pay` | Record settlement payment |

### Refunds
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/refunds` | Request a refund |
| `GET` | `/refunds/pending` | List pending refund approvals |
| `GET` | `/refunds/{publicId}` | Get refund detail |
| `POST` | `/refunds/{publicId}/approve` | Approve refund |
| `POST` | `/refunds/{publicId}/reject` | Reject refund |
| `POST` | `/refunds/{publicId}/complete` | Mark refund as disbursed |

### Cash Shifts
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/shifts` | Open a new shift |
| `GET` | `/shifts/me/active` | Get my active shift |
| `POST` | `/shifts/{publicId}/close` | Close shift with actual total |
| `GET` | `/shifts/{publicId}` | Get shift detail |
| `GET` | `/shifts` | List all branch shifts (manager) |
| `POST` | `/shifts/{publicId}/reconcile` | Reconcile discrepancy (manager) |

---

*Document maintained by the Backend team. UI/UX team should treat API response shapes and status codes in this document as authoritative. For schema changes, refer to `plan/feature-payment-cash-management-1.md`.*
