---
goal: UI/UX Flow Reference — Discount System (Coupons, Duration Slabs, Manual Overrides)
version: 1.0
date_created: 2026-03-25
owner: UI/UX Team
status: 'Planned'
tags: [ui, ux, discount, coupon, manual-override, pricing, flows]
---

# Discount System — UI/UX Flow Reference

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This document is the authoritative UI/UX design reference for the Discount System of the Vehicle Rental Management System. It covers every screen, modal, state badge, and API call for the **Customer**, **Employee**, and **Branch Manager** roles.

> **Backend contract note:** All booking IDs passed in URLs are `publicId` (nanoid string). All monetary values are `Decimal` strings (e.g., `"1500.00"`). Coupon codes are case-insensitive on the backend — normalize to uppercase before display.

---

## Table of Contents

1. [Roles & Access Levels](#1-roles--access-levels)
2. [Global Discount State Badges](#2-global-discount-state-badges)
3. [Flow A — Customer: Coupon Entry on Booking Review Page](#3-flow-a--customer-coupon-entry-on-booking-review-page)
4. [Flow B — Employee Booking: Coupon Entry on Booking Summary Page](#4-flow-b--employee-booking-coupon-entry-on-booking-summary-page)
5. [Flow C — Employee Pickup: Apply Discount at Pickup](#5-flow-c--employee-pickup-apply-discount-at-pickup)
6. [Flow D — Manager: Manual Discount Approval Dashboard](#6-flow-d--manager-manual-discount-approval-dashboard)
7. [Flow E — Manager: Coupon Management](#7-flow-e--manager-coupon-management)
8. [Flow F — Manager: Duration Slab Configuration](#8-flow-f--manager-duration-slab-configuration)
9. [Error States & Edge Cases](#9-error-states--edge-cases)
10. [API Quick Reference](#10-api-quick-reference)

---

## 1. Roles & Access Levels

| Role | Enter Coupon (Booking) | Apply Coupon Post-Booking | Apply Manual Discount | Approve Manual Discount | Manage Rules/Slabs |
|------|------------------------|--------------------------|----------------------|------------------------|-------------------|
| **Customer** | Yes (booking review page) | No | No | No | No |
| **Employee** | Yes (employee booking summary) | Yes (at pickup) | Yes (at pickup, requires manager approval if > threshold) | No | No |
| **Branch Manager** | Yes | Yes | Yes (self-approving if below threshold) | Yes | Yes (slabs, config, coupons) |
| **Admin** | No | No | No | Yes (high-value) | Yes (full CRUD) |

---

## 2. Global Discount State Badges

| State | Badge Label | Color |
|-------|-------------|-------|
| `NONE` applied | No Discount | Grey |
| Duration discount only | Duration Discount | Blue |
| Coupon applied | Coupon Applied | Green |
| Manual discount | Manual Discount | Purple |
| Duration + Coupon stacked | Stacked Discount | Teal |
| Manual pending approval | Pending Approval | Yellow |
| Manual rejected | Rejected | Red |

---

## 3. Flow A — Customer: Coupon Entry on Booking Review Page

### 3.1 Entry Point

Customer selects a vehicle → fills in dates → reaches the **Review & Confirm** page. The coupon field sits **below the pricing summary**, just above the payment button.

```
┌──────────────────────────────────────────────────────────────────┐
│  Booking Summary                                                  │
│  Vehicle:      Honda Activa MH-01-XY-5678                        │
│  Duration:     25 Mar → 28 Mar 2026  (3 days)                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Base price:               ₹  6,000.00                   │   │
│  │  Duration discount:        ─  ₹  0.00                    │   │
│  │  Coupon discount:          ─  ₹  0.00                    │   │
│  │  GST (18%):                +  ₹  1,080.00                │   │
│  │  ─────────────────────────────────────────────────────   │   │
│  │  Total:                    ₹  7,080.00                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Have a coupon code?                                      │   │
│  │  [_________________________]  [Apply]                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│             [Proceed to Payment →]                                │
└──────────────────────────────────────────────────────────────────┘
```

**UX notes:**
- Coupon field is entirely optional — no validation on the main form unless user clicks "Apply"
- Input is plain text; display the code in UPPERCASE as the user types
- "Apply" button is disabled when the field is empty
- Show an inline spinner while validation is running

### 3.2 Coupon Validation (Real-Time Preview)

**API call:** `POST /api/public/discount/validate`

> **Note:** This endpoint needs to be added. It validates without creating a booking or recording any usage. It requires: `{ couponCode, vehiclePublicId, startAt, endAt }`. Returns a pricing preview.

```json
// Request
{
  "couponCode": "SUMMER25",
  "vehiclePublicId": "veh_abc123",
  "startAt": "2026-03-25T12:00:00.000Z",
  "endAt": "2026-03-28T12:00:00.000Z"
}

// Success response
{
  "data": {
    "valid": true,
    "couponCode": "SUMMER25",
    "discountType": "PERCENTAGE",
    "discountValue": "25.00",
    "originalAmount": "6000.00",
    "durationDiscountAmount": "0.00",
    "couponDiscountAmount": "1500.00",
    "finalAmountBeforeTax": "4500.00",
    "taxAmount": "810.00",
    "finalTotal": "5310.00",
    "savingsAmount": "1770.00"
  }
}

// Failure response
{
  "data": {
    "valid": false,
    "code": "COUPON_EXPIRED",
    "reason": "This coupon expired on 15 Mar 2026."
  }
}
```

### 3.3 Success State

When coupon is valid, the pricing summary updates live:

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Base price:               ₹  6,000.00                   │   │
│  │  Duration discount:        ─  ₹  0.00                    │   │
│  │  Coupon (SUMMER25 −25%):   ─  ₹  1,500.00               │   │
│  │  GST (18%):                +  ₹    810.00                │   │
│  │  ─────────────────────────────────────────────────────   │   │
│  │  Total:                    ₹  5,310.00   [SAVED ₹1,770] │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ✓ Coupon applied: SUMMER25                [Remove ×]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│             [Proceed to Payment →]                                │
└──────────────────────────────────────────────────────────────────┘
```

- Show a green "✓ Coupon applied: {CODE}" pill with a remove button
- "Proceed to Payment" now shows the discounted total
- Coupon code is stored in local/session state and passed in the booking creation body

### 3.4 Failure States

| Error Code | Display Message |
|------------|----------------|
| `COUPON_NOT_FOUND` | "Invalid coupon code. Please check and try again." |
| `COUPON_EXPIRED` | "This coupon has expired." |
| `COUPON_INACTIVE` | "This coupon is no longer active." |
| `COUPON_BRANCH_MISMATCH` | "This coupon is not valid at this branch." |
| `COUPON_MIN_DURATION` | "This coupon requires a minimum rental of {n} days." |
| `COUPON_MIN_AMOUNT` | "This coupon requires a minimum booking of ₹{n}." |
| `COUPON_USAGE_LIMIT` | "This coupon has reached its usage limit." |
| `COUPON_ALREADY_USED` | "You have already used this coupon." |
| `COUPON_CATEGORY_MISMATCH` | "This coupon is not valid for this vehicle category." |

Show the error inline below the coupon input — small red text, no toast needed.

### 3.5 Booking Creation with Coupon

When the customer proceeds to payment, the booking creation API call includes `couponCode`:

**API call:** `POST /api/public/vehicles/booking` (existing endpoint — add `couponCode` field)

```json
{
  "vehicleId": "veh_abc123",
  "startAt": "2026-03-25T12:00:00.000Z",
  "endAt": "2026-03-28T12:00:00.000Z",
  "couponCode": "SUMMER25",
  "paymentPlan": "FULL"
}
```

> **Note (backend task):** `couponCode` needs to be added to the booking creation schema and applied in the pricing engine call inside the booking creation controller. This is TASK-037/038 from `feature-discount-system-1.md`.

If the coupon is invalid at booking creation time (race condition — e.g., limit reached between validate and create):
- Backend returns `{ code: "COUPON_INVALID", reason: "..." }`
- Frontend shows a toast: "Your coupon could not be applied — proceeding without discount. You can try again after booking is created."
- Booking proceeds without coupon

---

## 4. Flow B — Employee Booking: Coupon Entry on Booking Summary Page

### 4.1 Entry Point

Employee creates a booking for a customer → reaches the **Booking Summary** page (existing `EmployeeBookingSummaryPage`). A coupon code section appears below the price breakdown, identical to the customer flow.

```
┌──────────────────────────────────────────────────────────────────┐
│  Booking Summary — MH-01-XY-5678                                 │
│  Customer: Ravi Kumar  |  25 Mar → 28 Mar  (3 days)             │
│                                                                   │
│  Base:         ₹ 6,000.00                                        │
│  Duration:     ─  ₹ 0.00                                         │
│  Coupon:       ─  ₹ 0.00                                         │
│  GST:          +  ₹ 1,080.00                                     │
│  Total:           ₹ 7,080.00                                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Coupon Code (optional)                                   │   │
│  │  [___________________]   [Apply]                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [← Back]                      [Confirm Booking →]               │
└──────────────────────────────────────────────────────────────────┘
```

**API call (validate preview):** `POST /api/public/discount/validate` — same as customer flow.

**Booking creation:** Coupon code passed with booking creation payload (same as Flow A, Section 3.5).

---

## 5. Flow C — Employee Pickup: Apply Discount at Pickup

### 5.1 Entry Point

From the **StaffPickupsPage** (pickup detail screen), after the `BookingPaymentPanel` section. Visible when `booking.status === "CONFIRMED" || booking.status === "PICKED_UP"`.

A new **"Discounts"** section appears between the payment panel and the extension section:

```
┌──────────────────────────────────────────────────────────────────┐
│  Discounts                                           [+ Apply]   │
│                                                                   │
│  No discounts applied.                                            │
└──────────────────────────────────────────────────────────────────┘
```

If a `DiscountApplication` already exists for this booking, show it:

```
┌──────────────────────────────────────────────────────────────────┐
│  Discounts                                                        │
│                                                                   │
│  Duration discount:       ₹  600.00   (10% for 3+ days)         │
│  Coupon (SUMMER25):       ₹  1,500.00  (25% off)                 │
│  ─────────────────────────────────────────────────────────────  │
│  Total discount:          ₹  2,100.00                             │
│  Final total:             ₹  4,980.00                             │
│                                                                   │
│                                           [Apply / Change →]     │
└──────────────────────────────────────────────────────────────────┘
```

**API call to load:** `GET /api/employee/discount/bookings/:bookingId/discount-summary`

> **Note:** Employee-accessible discount summary endpoint needs to be added (mirrors manager endpoint with `EmployeeCheck`).

### 5.2 Apply Discount Modal

Clicking `[+ Apply]` or `[Apply / Change →]` opens a modal with two tabs:

```
┌──────────────────────────────────────────────────────────────────┐
│  Apply Discount — BK-20250325                                    │
│                                                                   │
│  ┌─────────────────┬───────────────────────────────────────┐    │
│  │  Coupon Code    │  Manual Discount                       │    │
│  └─────────────────┴───────────────────────────────────────┘    │
│                                                                   │
│  ── Coupon Code Tab ──────────────────────────────────────────   │
│                                                                   │
│  Coupon Code                                                      │
│  [_________________________________]   [Validate →]              │
│                                                                   │
│  ── after validation ─────────────────────────────────────────   │
│  ✓ SUMMER25 — 25% off                                            │
│                                                                   │
│  Current total:           ₹  7,080.00                            │
│  After coupon:            ₹  5,310.00                            │
│  Customer savings:        ₹  1,770.00                            │
│                                                                   │
│  [Cancel]                           [Apply Coupon →]             │
└──────────────────────────────────────────────────────────────────┘
```

**Coupon tab API call (validate):** `POST /api/employee/discount/bookings/:bookingId/validate-coupon`

> **Note:** Returns pricing preview without applying. Needs to be added to employee discount routes.

**Coupon tab API call (apply):** `POST /api/employee/discount/bookings/:bookingId/apply-coupon`

> **Note:** This is the employee-accessible version of the manager apply-coupon endpoint. Needs to be added to employee routes, reusing `ApplyCoupon` controller with `EmployeeCheck`.

```json
// Request
{ "couponCode": "SUMMER25" }

// Success response
{
  "message": "Coupon applied successfully",
  "data": {
    "couponCode": "SUMMER25",
    "durationDiscountAmount": "0.00",
    "couponDiscountAmount": "1500.00",
    "totalDiscountAmount": "1500.00",
    "totalTax": "810.00",
    "finalTotal": "5310.00"
  }
}
```

### 5.3 Manual Discount Tab

```
┌──────────────────────────────────────────────────────────────────┐
│  Apply Discount — BK-20250325                                    │
│                                                                   │
│  ┌─────────────────┬───────────────────────────────────────┐    │
│  │  Coupon Code    │  Manual Discount                       │    │
│  └─────────────────┴───────────────────────────────────────┘    │
│                                                                   │
│  ── Manual Discount Tab ──────────────────────────────────────   │
│                                                                   │
│  Discount Amount  ₹ [____________]                               │
│  Reason (required)                                                │
│  [____________________________________________________]          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⚠ Amounts over ₹ 500 require manager approval before   │    │
│  │  the discount is applied to the booking total.          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Cancel]                        [Submit Manual Discount →]      │
└──────────────────────────────────────────────────────────────────┘
```

**Validation (client-side):**
- Amount > 0 and ≤ booking total
- Reason is required (min 10 characters)
- If amount ≤ `branchDiscountConfig.managerApprovalThreshold` (e.g., ₹500): applied immediately
- If amount > threshold: submitted for approval, pending state shown

**API call:** `POST /api/employee/discount/bookings/:bookingId/manual-discount`

> **Note:** Employee-accessible version needs to be added. Reuses `ApplyManualDiscount` controller with `EmployeeCheck`.

```json
// Request
{
  "amount": 300,
  "reason": "Customer loyalty — third booking this month"
}
```

**Response outcomes:**

| `requiresApproval` | UI behavior |
|--------------------|-------------|
| `false` | Toast: "Discount of ₹300 applied." Discount summary updates. |
| `true` | Toast: "Discount of ₹800 submitted for manager approval." Show pending badge. |

### 5.4 Overpayment / Refund Scenario

When a discount is applied **after** advance payment has been collected, and the advance exceeds the new discounted total:

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠  Overpayment Detected                                         │
│                                                                   │
│  The applied discount reduces the booking total below the        │
│  advance already collected.                                       │
│                                                                   │
│  Advance collected:        ₹ 4,000.00                            │
│  New discounted total:     ₹ 3,200.00                            │
│  Overpayment:              ₹   800.00                            │
│                                                                   │
│  A refund request has been created automatically for ₹ 800.00.  │
│  The manager will process the refund via the Refunds dashboard.  │
│                                                                   │
│                                      [View Refund Request →]     │
└──────────────────────────────────────────────────────────────────┘
```

**API call (refund):** `POST /api/employee/payment/refunds` — same refund endpoint already implemented.

> The discount application controller detects `adjustmentType: PENDING_REFUND` in the pricing result and automatically calls `refundService.requestRefund()`. The employee is shown this banner as confirmation.

---

## 6. Flow D — Manager: Manual Discount Approval Dashboard

### 6.1 Entry Point

Manager dashboard → new nav item **"Discount Approvals"** (with badge count of pending approvals).

```
┌──────────────────────────────────────────────────────────────────┐
│  Pending Manual Discounts                           (3 pending)  │
│                                                                   │
│  Booking     │ Customer   │ Amount    │ Reason        │ Employee │ Action      │
│ ─────────────│ ───────── │ ──────── │ ──────────── │ ──────── │ ──────────  │
│  BK-20250325 │ Ravi Kumar │ ₹ 800   │ Loyalty disc. │ Raj K.  │ [Review]    │
│  BK-20250324 │ Priya M.   │ ₹ 1,200 │ Vehicle issue │ Neha S. │ [Review]    │
│  BK-20250323 │ Arjun P.   │ ₹ 600   │ Late return   │ Raj K.  │ [Review]    │
└──────────────────────────────────────────────────────────────────┘
```

**API call:** `GET /api/branchManager/discount/manual-discounts/pending`

### 6.2 Review Modal

```
┌──────────────────────────────────────────────────────────────────┐
│  Review Manual Discount Request                                   │
│                                                                   │
│  Booking:          BK-20250325                                   │
│  Customer:         Ravi Kumar                                    │
│  Requested by:     Raj Kumar (Employee)                          │
│  Discount amount:  ₹ 800.00                                      │
│  Booking total:    ₹ 7,080.00                                    │
│  After discount:   ₹ 6,280.00                                    │
│                                                                   │
│  Reason provided:                                                 │
│  "Customer loyalty — third booking this month. Requested         │
│   discount as goodwill gesture."                                 │
│                                                                   │
│  Manager note (optional):                                         │
│  [__________________________________________________]            │
│                                                                   │
│  [Reject ✗]                              [Approve ✓]             │
└──────────────────────────────────────────────────────────────────┘
```

**API calls:**
- Approve: `POST /api/branchManager/discount/manual-discounts/:publicId/approve`
- Reject: `POST /api/branchManager/discount/manual-discounts/:publicId/reject`

**After approval:** Booking total updates. If advance already exceeds new total → refund flow triggered (same as Flow C, Section 5.4).

**After rejection:**
- Employee who submitted gets the discount removed from the booking
- Toast shown on their pickup page if they're still on it: "Manager rejected the manual discount request."

---

## 7. Flow E — Manager: Coupon Management

### 7.1 Entry Point

Manager dashboard → **"Coupons"** nav section.

```
┌──────────────────────────────────────────────────────────────────┐
│  My Coupons                                    [+ Create Coupon] │
│                                                                   │
│  Code        │ Type       │ Value   │ Used │ Limit │ Expires    │
│ ──────────── │ ─────────  │ ────── │ ──── │ ───── │ ─────────  │
│  SUMMER25    │ 25% off    │ —       │  12  │  50   │ 30 Apr     │
│  FLAT500     │ ₹500 flat  │ —       │   3  │  20   │ 31 Mar     │
│  LOYALTY10   │ 10% off    │ ₹200 cap│   8  │ 100   │ No expiry  │
└──────────────────────────────────────────────────────────────────┘
```

**API call:** `GET /api/branchManager/discount/coupons`

### 7.2 Create Coupon Modal

```
┌──────────────────────────────────────────────────────────────────┐
│  Create Coupon                                                    │
│                                                                   │
│  Coupon Code         [______________]  [Auto-Generate]           │
│  Name                [__________________________]                 │
│  Discount Type       ○ Percentage     ○ Flat Amount              │
│  Value               [_______]  %  /  ₹                          │
│  Max Discount Cap    [_______]  ₹  (optional, for % type)        │
│  Total Usage Limit   [_______]  (leave blank = unlimited)        │
│  Per-Customer Limit  [_______]  (leave blank = 1)                │
│  Valid From          [  Date  ]   Valid To   [  Date  ]           │
│  Min Booking Amount  [_______]  ₹ (optional)                     │
│  Min Rental Days     [_______]  (optional)                       │
│                                                                   │
│  [Cancel]                              [Create Coupon →]         │
└──────────────────────────────────────────────────────────────────┘
```

**Auto-Generate API:** `GET /api/branchManager/discount/coupons/limits` then `POST /api/branchManager/discount/coupons`

> Auto-generate calls the backend to suggest a code. Manager can override it.

---

## 8. Flow F — Manager: Duration Slab Configuration

### 8.1 Entry Point

Manager dashboard → **"Discount Config"** page.

```
┌──────────────────────────────────────────────────────────────────┐
│  Discount Configuration                                           │
│                                                                   │
│  ── Duration Discount Settings ─────────────────────────────    │
│                                                                   │
│  Duration discounts enabled   [● ON]                             │
│  Stack with coupons           [○ OFF]                            │
│  Max combined discount        [20]  %                            │
│  Manual discount threshold    ₹ [500]  (approval required above) │
│  Max manual discounts/day     [5]  per employee                  │
│                                                                   │
│                                               [Save Config]       │
│                                                                   │
│  ── Duration Discount Slabs ────────────────────────────────    │
│  Days       │ Discount   │ Type       │ Label         │ Action   │
│ ──────────  │ ─────────  │ ─────────  │ ───────────── │ ──────  │
│  1 – 2 days │ 0%         │ Percentage │ Standard      │ [Edit]  │
│  3 – 6 days │ 10%        │ Percentage │ Short stay    │ [Edit]  │
│  7+ days    │ ₹ 500 flat │ Flat       │ Weekly deal   │ [Edit]  │
│                                                                   │
│                                         [+ Add Slab]             │
└──────────────────────────────────────────────────────────────────┘
```

**API calls:**
- Load config: `GET /api/branchManager/discount/config`
- Update config: `PATCH /api/branchManager/discount/config`
- Load slabs: `GET /api/branchManager/discount/slabs`
- Create slab: `POST /api/branchManager/discount/slabs`
- Update slab: `PATCH /api/branchManager/discount/slabs/:id`
- Delete slab: `DELETE /api/branchManager/discount/slabs/:id`

### 8.2 Slab Edit Inline Modal

```
┌──────────────────────────────────────────────────┐
│  Edit Duration Slab                               │
│                                                   │
│  Min Days     [3]      Max Days     [6]          │
│  Discount Type    ○ Percentage   ○ Flat Amount    │
│  Value            [10]  %  /  ₹                   │
│  Label (optional) [Short stay discount]           │
│                                                   │
│  [Delete Slab]                     [Save Changes]│
└──────────────────────────────────────────────────┘
```

---

## 9. Error States & Edge Cases

| Scenario | UI Behaviour |
|----------|-------------|
| Coupon applied but booking creation fails | Strip coupon silently, proceed without discount, show toast warning |
| Manual discount > threshold submitted | Status shows "Pending Approval" badge — no price change until approved |
| Manual discount rejected by manager | Booking total reverts, employee sees rejection toast on pickup page |
| Discount applied after advance collected → overpayment | Auto-create refund request, show overpayment banner |
| Coupon usage limit reached between validate and apply | Show toast: "Coupon limit reached. Please try another code." |
| Duration + coupon stacking blocked by config | Show: "This branch does not allow stacking coupons with duration discounts." |
| Booking already has invoice (RETURNED) | Block apply-coupon: "Discounts cannot be applied after invoice generation." |
| Network error during coupon validation | Show: "Couldn't validate coupon. Please try again." — don't block proceed |

---

## 10. API Quick Reference

### New Endpoints Required (to be added to backend)

| Role | Method | Path | Description |
|------|--------|------|-------------|
| Public | `POST` | `/api/public/discount/validate` | Validate coupon + preview pricing (no auth, no usage recorded) |
| Employee | `GET` | `/api/employee/discount/bookings/:bookingId/discount-summary` | Get applied discount for booking |
| Employee | `POST` | `/api/employee/discount/bookings/:bookingId/validate-coupon` | Validate coupon for specific booking |
| Employee | `POST` | `/api/employee/discount/bookings/:bookingId/apply-coupon` | Apply coupon to booking (EmployeeCheck) |
| Employee | `DELETE` | `/api/employee/discount/bookings/:bookingId/apply-coupon` | Remove coupon from booking |
| Employee | `POST` | `/api/employee/discount/bookings/:bookingId/manual-discount` | Request manual discount (may require manager approval) |

### Existing Endpoints Used

| Role | Method | Path | Description |
|------|--------|------|-------------|
| Manager | `GET` | `/api/branchManager/discount/config` | Get branch discount config |
| Manager | `PATCH` | `/api/branchManager/discount/config` | Update branch discount config |
| Manager | `GET` | `/api/branchManager/discount/slabs` | List duration discount slabs |
| Manager | `POST` | `/api/branchManager/discount/slabs` | Create duration slab |
| Manager | `PATCH` | `/api/branchManager/discount/slabs/:id` | Update duration slab |
| Manager | `DELETE` | `/api/branchManager/discount/slabs/:id` | Delete duration slab |
| Manager | `GET` | `/api/branchManager/discount/manual-discounts/pending` | List pending manual discount approvals |
| Manager | `GET` | `/api/branchManager/discount/manual-discounts/:publicId` | Get manual discount detail |
| Manager | `POST` | `/api/branchManager/discount/manual-discounts/:publicId/approve` | Approve manual discount |
| Manager | `POST` | `/api/branchManager/discount/manual-discounts/:publicId/reject` | Reject manual discount |
| Manager | `GET` | `/api/branchManager/discount/coupons` | List manager-created coupons |
| Manager | `GET` | `/api/branchManager/discount/coupons/limits` | Get coupon creation limits |
| Manager | `POST` | `/api/branchManager/discount/coupons` | Create manager coupon |
| Manager | `POST` | `/api/branchManager/discount/bookings/:bookingId/apply-coupon` | Apply coupon (manager) |
| Manager | `DELETE` | `/api/branchManager/discount/bookings/:bookingId/apply-coupon` | Remove coupon (manager) |
| Manager | `POST` | `/api/branchManager/discount/bookings/:bookingId/manual-discount` | Apply manual discount (manager) |
| Manager | `GET` | `/api/branchManager/discount/bookings/:bookingId/discount-summary` | Get discount summary |
| Admin | `GET` | `/api/admin/discount-rules/` | List all discount rules |
| Admin | `POST` | `/api/admin/discount-rules/` | Create discount rule |
| Admin | `GET` | `/api/admin/discount-rules/:publicId` | Get discount rule |
| Admin | `PATCH` | `/api/admin/discount-rules/:publicId` | Update discount rule |
| Admin | `POST` | `/api/admin/discount-rules/:publicId/deactivate` | Deactivate discount rule |
| Admin | `POST` | `/api/admin/discount-rules/generate-code` | Generate coupon code |

### Backend Changes Required in Existing Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /api/public/vehicles/booking` | Add `couponCode?: string` to request schema; apply discount in pricing engine call |
| `POST /api/employee/booking/create` | Add `couponCode?: string` to request schema; same as above |

---

*Document maintained by the UI/UX team. Backend endpoints marked "to be added" must be implemented before the corresponding UI flows can be built.*
