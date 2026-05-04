# Fleet Executive — Mobile Feature Plan

## Customer Flow (Current Status)

| Feature | Web | Mobile |
|---|---|---|
| Sign up / Login | — | Done |
| Profile completion | Yes | Done |
| KYC document upload | Yes | Done |
| Vehicle browse & search | Yes | Done |
| Vehicle booking / checkout | Yes | Done |
| Booking history / trips | Yes | Done |

Customer side is fully covered.

---

## Fleet Executive / Employee Flow

Zero of this exists in the mobile app today.

---

### 1. Cash Shift

| Feature | Backend Endpoint |
|---|---|
| Open shift | `POST /employee/payment/shifts` |
| View my active shift | `GET /employee/payment/shifts/me/active` |
| Close shift (actual total + explanation) | `POST /employee/payment/shifts/:id/close` |

---

### 2. Bookings Dashboard

| Feature | Backend Endpoint |
|---|---|
| List upcoming pickups | `GET /employee/booking` |
| List pending returns | `GET /employee/return` |
| Scan booking (QR / booking ID) | `GET /employee/booking/:bookingId/scan` |
| Employee dashboard stats | `GET /employee/dashboard/stats` |

---

### 3. Customer Lookup / Walk-in

| Feature | Backend Endpoint |
|---|---|
| Search customer by phone / name | `GET /employee/customer/search` |
| View customer profile + KYC | `GET /employee/customer/:publicId` |
| Walk-in: initiate (send OTP) | `POST /employee/walkin/initiate` |
| Walk-in: verify OTP | `POST /employee/walkin/verify` |
| Walk-in: complete profile | `POST /employee/walkin/complete` |
| Walk-in: upload / view / delete KYC | `POST /employee/walkin/kyc/upload` |
| Walk-in: verify KYC docs | `PATCH /employee/kyc/:kycId/status` |

---

### 4. Vehicle Pickup Flow

| Step | Backend Endpoint |
|---|---|
| Get booking + customer details | `GET /employee/pickup/:bookingId` |
| Get capture config (which photos required) | `GET /employee/pickup/:bookingId/capture-config` |
| Upload pre-pickup photos | `POST /employee/pickup/upload` |
| Delete a pickup photo | `DELETE /employee/pickup/image/:publicId` |
| Initiate pickup payment session | `POST /employee/bookings/:bookingId/pickup-session/initiate` |
| Get pickup session (with ledger) | `GET /employee/bookings/:bookingId/pickup-session` |
| Apply discount to session | `POST /employee/bookings/:bookingId/pickup-session/apply-discount` |
| Add safety deposit to session | `POST /employee/bookings/:bookingId/pickup-session/add-deposit` |
| Record payment (cash / UPI) | `POST /employee/payment/transactions` |
| Confirm pickup (mark PICKED_UP) | `POST /employee/pickup/:bookingId` |
| View pickup pricing rules | `GET /employee/pickup/:bookingId/pricing-rules` |
| Swap vehicle | `POST /employee/bookings/:bookingId/swap-vehicle` |

---

### 5. Vehicle Return Flow

| Step | Backend Endpoint |
|---|---|
| Get booking details for return | `GET /employee/return/:bookingId` |
| View pickup photos (reference) | `GET /employee/return/:bookingId/pickup-captures` |
| Upload post-return photos | `POST /employee/return/upload` |
| Compute return charges (km, fuel, fastag, extras) | `POST /employee/bookings/:bookingId/return/session/compute` |
| Get return session (charge breakdown) | `GET /employee/bookings/:bookingId/return/session` |
| Record remaining payment | `POST /employee/payment/transactions` |
| Complete return (mark RETURNED) | `POST /employee/return/:bookingId/complete` |
| Create damage report + photos | `POST /employee/damage/report` |

---

### 6. Extensions

| Feature | Backend Endpoint |
|---|---|
| List / manage booking extensions | `GET/POST /employee/extensions/...` |

---

## Proposed Screen Structure

```
app/
  (employee)/
    _layout.tsx          — employee tab layout (separate from customer tabs)
    dashboard.tsx        — stats + shift status + quick actions
    bookings.tsx         — pickup queue + return queue
    scan.tsx             — QR / booking ID scanner
  employee/
    shift/
      open.tsx           — open cash shift
      close.tsx          — close shift with actual total
    pickup/
      [bookingId].tsx    — full pickup flow (photos → payment → confirm)
    return/
      [bookingId].tsx    — full return flow (photos → charges → payment → complete)
    customer/
      search.tsx         — search existing customer
      [publicId].tsx     — customer profile + KYC view
    walkin/
      index.tsx          — walk-in OTP flow
      kyc.tsx            — walk-in KYC upload
```

## Auth Notes

- Employee login uses a separate auth endpoint (`POST /employee/auth/login`)
- After login, route to `(employee)` tab group instead of `(tabs)` customer group
- Role stored in auth store; root layout gates the tab group based on role
