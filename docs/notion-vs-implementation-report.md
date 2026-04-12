# VRMS: Feature Comparison Report
### Notion Docs vs Actual Implementation

**Generated:** 2026-04-04

---

## Section A — In the Docs but NOT in the Code

These were planned/promised in the original Notion documentation but are missing from the codebase.

| # | Feature | Where in Docs |
|---|---|---|
| 1 | **Mobile App (React Native)** — A customer-facing mobile app was explicitly planned. The Notion page exists but is completely blank. No React Native code exists. | Project Overview, Architecture, Mobile page |
| 2 | **Phone number OTP login** — Customers and staff were supposed to log in via mobile number + OTP (MSG91/Twilio). Currently uses email OTP instead. | Customer Flow 2.1, Staff Flow 3.1 |
| 3 | **MSG91 / Twilio SMS integration** — The OTP delivery mechanism specified in the docs. | Customer Flow 2.1 |
| 4 | **Redis-based OTP rate limiting** — Mentioned specifically to prevent OTP abuse. | Customer Flow 2.1 |
| 5 | **Branch holiday / blackout day configuration** — Admin should be able to set days when a branch is closed or unavailable for bookings. | Admin Flow 5.3 |
| 6 | **Branch working hours configuration** — Set per-branch operating hours. | Admin Flow 5.3 |
| 7 | **Vehicle move between branches** — Admin should be able to reassign a vehicle from one branch to another. | Admin Flow 5.4 |
| 8 | **Reports downloadable as CSV / Excel** — Admin reports were meant to be exportable. | Admin Flow 5.7 |
| 9 | **Maintenance Staff as a distinct role** — Docs define a separate Maintenance Staff role with its own login and task queue. Currently merged into the general Staff role. | Project Overview, Staff Flow 3.6 |
| 10 | **GCP Cloud Run + Cloud SQL deployment** — Architecture specified auto-scaling via Google Cloud. System runs on Hostinger VPS instead. | System Design & Architecture |

---

## Section B — In the Code but NOT in the Docs

These features were built and shipped during the project but were never documented in the original Notion spec. All are extra scope delivered on-the-go.

| # | Feature | Description |
|---|---|---|
| 1 | **Walk-in Booking System** | Create bookings for unregistered customers on the spot without prior account or payment. |
| 2 | **Booking Extensions** | Customers or staff can extend an active rental. Includes availability conflict resolution, extension pricing, vehicle reallocation, and displaced booking handling. |
| 3 | **Vehicle Swap System** | Mid-rental vehicle replacement. Tracks swap reason (customer request, maintenance, upgrade, damage, etc.) with full audit trail. |
| 4 | **Full Charge Engine (8 modules)** | Extra KM charges, extra time/overstay charges, fuel deficit charges, damage charges, FASTAG/toll charges, grace period adjustments, safety deposit charges, base pricing — none of these charge types were in the original spec. |
| 5 | **Grace Period Policy** | Configurable auto/manual grace period on overstay before charges apply. |
| 6 | **Coupon Code System** | Generate unique coupon codes, validate at booking, track redemptions, enforce usage limits per manager/branch. |
| 7 | **Discount Rules Engine** | Duration-based discount slabs, manual discounts with manager approval workflow, branch-level discount configuration. The docs only mentioned "manager can apply discounts" loosely. |
| 8 | **Safety Deposit Approval Workflow** | Separate safety deposit lifecycle (PENDING_APPROVAL → APPROVED → CHARGED/REFUNDED) distinct from the main payment flow. |
| 9 | **Cash & UPI Payment Methods** | Beyond Razorpay (online), the system handles cash deposits and UPI with manual payment confirmation by staff. |
| 10 | **Cash Shift Management** | Staff open/close cash shifts. Tracks cash collected per shift, enables reconciliation and shift-level collection reports. |
| 11 | **Customer Credit Ledger** | Per-customer credit balance tracking with credit entries, clearance workflow. Used for refunds and adjustments without issuing cash. |
| 12 | **Credit Notes** | Issue credit notes against bookings for refunds or adjustments. |
| 13 | **Cancellation Invoices** | Dedicated invoice type for cancelled bookings, separate from the standard invoice lifecycle. |
| 14 | **GST Rules & GST Report** | Per-branch GST configuration and a dedicated GST report for tax filing. |
| 15 | **Receipt PDF Generation** | Separate receipt documents generated per payment, distinct from invoices. |
| 16 | **Booking QR Code** | QR code generated per booking for quick identification during pickup/return. |
| 17 | **Hold Countdown Timer** | Real-time expiry timer for booking holds shown to the customer. |
| 18 | **Booking Hold Auto-Expiry Worker** | Background job that automatically cancels expired holds and frees up the vehicle. |
| 19 | **WhatsApp Notification Configuration** | Per-branch WhatsApp alert setup (not email or SMS as per docs). |
| 20 | **Insurance Expiry Alert Worker** | Automated background job that monitors insurance/permit expiry and sends alerts. |
| 21 | **Delayed Cash Alert Worker** | Alerts for pending/unconfirmed cash payments that have been sitting too long. |
| 22 | **Photo Capture Configuration** | Configurable per-branch/vehicle rules for which photos are required (pre-delivery, post-return, damage). |
| 23 | **Vehicle Rank System** | Category-level ranking used for upgrade/downgrade logic during vehicle swaps. |
| 24 | **Branch Feature Flags** | Toggle individual features on/off per branch without code changes. |
| 25 | **Ledger & Settlement Engine** | Full double-entry-style financial ledger with settlement tracking per booking. |
| 26 | **Fraud Detection on Payments** | Payment-level fraud detection mechanism on Razorpay transactions. |
| 27 | **FASTAG / Toll Charge Tracking** | Track and bill toll charges incurred during the rental period. |
| 28 | **Charge Override Approval Workflow** | Manager must approve any manual override of system-calculated charges. |
| 29 | **Pending Approvals Dashboard** | Centralized view for managers of all items waiting for approval (damage, discounts, charge overrides, deposits). |
| 30 | **Staff Activity Log & Dashboard** | Tracks individual staff actions over time with a visualization dashboard. |
