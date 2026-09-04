# Razorpay Setup

PhonePe has been removed. Razorpay Orders + Checkout is now the only online
payment gateway across the backend, the web app, and the mobile app.

---

## 1. Credentials

Create keys in the Razorpay Dashboard → **Account & Settings → API Keys**.
Test keys are prefixed `rzp_test_`, live keys `rzp_live_`.

Set these in `apps/backend/.env` (see `apps/backend/.env.example`):

| Variable | Where it comes from | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | API Keys | Public. Sent to the browser/app so Checkout can open. |
| `RAZORPAY_KEY_SECRET` | API Keys | **Server-only.** Signs orders and verifies Checkout responses. Never ship to a client. |
| `RAZORPAY_WEBHOOK_SECRET` | Settings → Webhooks | A *different* secret from `KEY_SECRET`. You choose it when creating the webhook. |


There is no env var for the webhook URL — it is registered by hand in the
dashboard (§2). `BACKEND_CALLBACK_URL` built the old PhonePe callback and is
now unused by any code path.

The clients do **not** need a build-time key — `keyId` is returned by the
backend with each order. There is no `VITE_RAZORPAY_KEY_ID` requirement.

## 2. Webhook

Dashboard → **Settings → Webhooks → Add New Webhook**.

- **URL:** `https://<your-api-host>/api/payment/razorpay/webhook`
- **Secret:** the same value as `RAZORPAY_WEBHOOK_SECRET`
- **Active events:** `payment.captured`, `payment.failed`, `order.paid`

The endpoint verifies the `X-Razorpay-Signature` header against the **raw**
request body. It is unauthenticated by design — the signature is the auth — and
always returns `200` for events it does not handle, because Razorpay retries on
any non-2xx response.

Every delivery is recorded in the `PaymentWebhookLog` table for reconciliation.

## 3. Database migration

```bash
cd packages/db
npx prisma migrate deploy    # or: npm run db:migrate:deploy
npx prisma generate
npm run build
```

The migration `20260830120000_rename_phonepe_txn_to_gateway_txn`:

- renames `BookingExtension.phonePeTransactionId` → `gatewayTransactionId`
  (it now holds a Razorpay `order_…` id),
- relabels historical `PaymentTransaction.onlineGateway = 'PHONEPE'` rows to
  `'PHONEPE_LEGACY'` so old transactions stay distinguishable in reporting.

New online transactions are written with `onlineGateway = 'RAZORPAY'`.

## 4. Identifier change

The gateway reference stored on `Booking.transactionId`,
`Booking.remainingPaymentId` and `BookingExtension.gatewayTransactionId`
changed format:

```
before   MT-3f9c1a2b4d...      (PhonePe merchantTransactionId)
after    order_NqR8xY2zAbCdEf  (Razorpay order id)
```

Any client code that branched on a `MT` prefix now checks `order_`. Bookings
created before the cutover keep their `MT-` ids; they can no longer be
re-checked against a gateway, so settle them manually if any are still open.

## 5. Testing

Use test-mode keys and Razorpay's test instruments (Dashboard → Test Mode).
Card `4111 1111 1111 1111` with any future expiry and any CVV succeeds; UPI id
`success@razorpay` succeeds and `failure@razorpay` fails.

To exercise the webhook locally, tunnel the API (e.g. `ngrok http 8000`) and
point the dashboard webhook at the tunnel URL.

## 6. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/payment/status/:transactionId` | customer | Poll an order's state. Fallback path. |
| `POST` | `/api/payment/verify` | customer | Fast confirm from the Checkout handler. |
| `POST` | `/api/payment/staff/verify` | STAFF | Same handler, staff sessions. |
| `POST` | `/api/payment/manager/verify` | MANAGER | Same handler, manager sessions. |
| `POST` | `/api/payment/razorpay/webhook` | none (HMAC) | Razorpay event receiver. |
| `GET` | `/api/branchManager/payment/status/:transactionId` | MANAGER | Damage/fine payments only. |

The verify endpoint exists three times because `authCheckJwt` only admits
`Role.CUSTOMER` and there is no combined role gate in this codebase. All three
mounts share one handler; the Razorpay checkout HMAC — not the role gate — is
what actually authorises a confirmation, so a caller cannot confirm anything
without a signature only Razorpay can produce.

Damage and fine payments store their order id on `Payment.razorpayOrderId`
rather than `Booking.transactionId`, and finalize a damage report as part of
settlement. They therefore use the branch-manager endpoint, not verify.

`GET /api/payment/status/:transactionId` is customer-only. Staff flows have
their own gated status routes; pointing staff polling at it returns 403.

## 7. Clients confirm twice, on purpose

A successful Checkout is confirmed by two independent paths:

1. the client posts the signed handler response to a verify endpoint, and
2. Razorpay delivers `payment.captured` / `order.paid` to the webhook.

Either alone is sufficient. Both are idempotent, so whichever arrives second is
a no-op. This is deliberate: the verify call gives the user an immediate result,
and the webhook still settles the payment if the user closes the app, loses
connectivity, or blocks the callback.

A failed attempt (`payment.failed`) deliberately does **not** cancel anything.
Razorpay fires it on every failed attempt and Checkout lets the user retry
within the same order, so cancelling on the first failure would destroy a
booking the customer is still paying for. Cancellation is driven only by the
user-facing status poll or by hold expiry.

## 8. Mobile build requirement

The mobile app uses a native Checkout module, so **Expo Go cannot run the
payment flow**. Use a development build or an EAS build:

```bash
cd mobile
npx expo prebuild --clean
npx expo run:android    # or run:ios
```

## 9. The one alert you must not ignore

Money can be captured for something the system can no longer honour. There are
**four** such cases, and the system detects and refuses all of them — it confirms
nothing, writes no invoice, and changes no vehicle status:

| Case | What happened |
| --- | --- |
| Cancelled booking | The hold expired while the customer sat on checkout. |
| Cancelled parent booking | The booking under an extension was cancelled mid-payment. |
| Closed extension | The extension was REJECTED or CANCELLED — often a manager's explicit decision — while the customer was paying. |
| Unknown order | A captured order matching no booking, extension or fine. |

Refusing is the right behaviour: confirming would double-book a vehicle, or
silently reverse a manager's rejection and move the booking's end date.

**Nothing auto-refunds.** The customer is *told* their money will be returned.
Someone has to actually return it, from the Razorpay dashboard, using the
`pay_…` id in the log line:

```
[confirmBookingPayment]  REFUND REQUIRED booking=…   txn=order_…  gatewayPaymentId=pay_…
[confirmExtensionPayment] REFUND REQUIRED extension=… txn=order_…  gatewayPaymentId=pay_…
[razorpayWebhook]        REFUND REQUIRED booking=…/extension=… orderId=order_… paymentId=pay_…
```

**Alert on the string `REFUND REQUIRED`.** The matching `PaymentWebhookLog` row
is the paper trail. If nobody works these lines, customers are silently out of
pocket after being promised a refund.

## 10. Reading `PaymentWebhookLog`

Every signature-verified webhook is recorded. `processed` flips to `true` only
after the confirm or fail actually succeeded — ignored event types and webhooks
for unknown orders stay `processed: false` by design. A `false` row is therefore
not necessarily a failure, so do not build a failure alert on that column alone.
