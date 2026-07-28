# Google Play Store — Release Guide (WUW Cars)

Operating manual for shipping the Expo app in `mobile/` to Google Play. Written
for an agent or engineer picking this up cold.

**App identity (do not change after first publish):**

| Field | Value |
|---|---|
| Package / applicationId | `com.whatuwantrentals.cars` |
| App name | WUW Cars |
| EAS project ID | `ddb96052-cb64-4baf-a780-dccbfaeb6284` |
| EAS owner | `sushanshetty` |
| Expo SDK / RN | 54 / 0.81.5 |
| targetSdk / compileSdk | 36 (Android 16) — meets Play's API-35+ minimum |
| Production API | `https://api.whatuwantrentals.com` |

> The package name was changed from `com.wuw.cars` to `com.whatuwantrentals.cars`
> before first publish. **Once an app is published under a package name, that name
> is permanent** — it cannot be renamed, reused, or reclaimed, even after deleting
> the app. Never change it again.

---

## 1. Release blockers — must be cleared before submitting

These are not optional polish. Each one either fails Play review or ships a
broken app.

### 1.1 Deploy the backend (`forgot-password` returns 404 in production)

`POST /api/auth/email/forgot-password` and `/reset-password` exist in the repo
but are **not deployed**. Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://api.whatuwantrentals.com/api/auth/email/forgot-password
# 400 = deployed (validation error).  404 = NOT deployed.
```

The app's "Forgot password?" link is reachable from the sign-in screen, so a
reviewer will hit it. A 404 there reads as broken functionality.

The same deploy also ships `DELETE /api/user/account` (account deletion), which
Play policy requires. Verify it too — it must return 403 (not 404) unauthenticated:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE \
  https://api.whatuwantrentals.com/api/user/account   # expect 403, not 404
```

Also required in the backend environment: `OTP_SENDER_EMAIL` (defaults to
`no-reply@whatuwantrentals.com`; the sending domain must be verified in MSG91).

### 1.2 Deploy the frontend (account-deletion page must be live)

Play requires a publicly reachable deletion URL. The page exists at
`apps/frontend/public/legal/delete-account.html` but must be deployed:

```bash
curl -sIL https://whatuwantrentals.com/legal/delete-account | grep -E '^HTTP'
# expect a final 200
```

**This exact URL goes into Play Console → Data safety → Data deletion.**

### 1.3 Confirm the support mailbox actually exists

`support@whatuwantrentals.com` is used on the deletion page. The domain has
valid MX records (MSG91), but **confirm the mailbox receives mail** — Google may
contact it during review.

Separately: `terms.html`, `refund.html`, `AdminLayout.tsx` and
`ManagerProfilePage.tsx` all publish `support@whatuwantrental.in` — a domain with
**no MX records at all**, so mail to it bounces. Fix those to a working address.

### 1.4 Closed-testing requirement (personal developer accounts)

If the Play developer account is a **personal** account created after 13 Nov 2023,
Google requires a **closed test with at least 12 testers opted in continuously for
14 days** before you can apply for production access. Organisation accounts are
exempt.

Check the account type at Play Console → Settings → Developer account → Account
details. If personal, **start the closed test first** — it is a hard 14-day wall
and nothing else can shorten it.

---

## 2. What is already configured in this repo

Do not redo these.

- **`app.json`** — package/bundle id `com.whatuwantrentals.cars`; adaptive icon;
  `blockedPermissions: [RECORD_AUDIO]`; splash wired to `assets/splash-icon.png`.
- **`eas.json`** — `appVersionSource: remote` (EAS owns `versionCode`, so an
  upload can never collide with a used version code); `production` builds an
  **app-bundle (.aab)** and **now sets `EXPO_PUBLIC_API_URL`** (it previously did
  not, which would have shipped an app pointing at `http://localhost:3000`);
  `submit.production.android` wired for `eas submit`.
- **Icons** — `assets/icon.png` and `assets/adaptive-icon.png` were regenerated
  from the real brand logo (`apps/frontend/public/logo-W.png`). The previous
  `icon.png` was a **blank black square** with zero artwork, which Play rejects.
- **Store assets** — in `mobile/store-assets/` (see §5).
- **Account deletion** — backend `DELETE /api/user/account`, in-app screen at
  `app/delete-account.tsx` linked from Profile, public web page at
  `/legal/delete-account`.
- **`.gitignore`** — `*.apk`, `*.aab`, and `*-service-account.json` are ignored.
  Never commit the service-account key or a build artifact (the APK is ~107 MB,
  over GitHub's 100 MB hard limit).

### Permissions in the shipped manifest

| Permission | Why | Notes |
|---|---|---|
| `CAMERA` | QR scan, KYC capture, vehicle condition photos | Declared intentionally |
| `INTERNET` | API calls | — |
| `READ_/WRITE_EXTERNAL_STORAGE` | Injected by `expo-image-picker` | Legacy; ignored on Android 13+ |
| `SYSTEM_ALERT_WINDOW`, `VIBRATE` | Injected by the Expo/RN base template | Not a review blocker |
| `RECORD_AUDIO` | **Removed** | Injected by `expo-camera` + `expo-image-picker`; stripped via `blockedPermissions` (`tools:node="remove"`) |

The app requests **no location permission** — confirmed, `expo-location` is not
installed. Note the *privacy policy* describes vehicle telematics/location
tracking; that is the vehicles, not the app. Answer the Data safety form for
**what the app collects**, not what the fleet hardware does.

---

## 3. One-time Play Console setup

1. **Create the app** — Play Console → All apps → Create app.
   - Name `WUW Cars`, language English, type **App**, **Free**.
2. **Create the app entry with the exact package name** `com.whatuwantrentals.cars`
   (set implicitly by the first uploaded bundle — the first upload must be manual).
3. **App access** — the app is entirely behind a login. You **must** give Google
   working demo credentials or it will be rejected as untestable.
   Provide a customer test account, and note that "Forgot password" needs a real
   inbox. Add instructions: sign in → Rent tab → pick dates → view a vehicle.
4. **Ads** — declare **No ads** (no ad SDK is present).
5. **Content rating** — complete the questionnaire. It is a utility/business app;
   no user-generated content, no gambling.
6. **Target audience** — **18+**. Renting requires a driving licence; do not tick
   any child audience or the app enters Families policy.
7. **Financial features** — the app takes payment for a **real-world service**
   (vehicle rental), which is exempt from Google Play Billing. Declare it as such;
   do **not** integrate Play Billing.
8. **Data safety** — see §4.
9. **Privacy policy URL** — `https://whatuwantrentals.com/legal/privacy`
10. **Store listing** — assets from §5.

---

## 4. Data safety form

The app handles **government ID documents**, so this must be filled carefully.
Answers below reflect what the code actually does.

Collected, **linked to the user**, and **not** used for tracking/advertising:

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Name | Yes | Account management, booking contract | Required |
| Email address | Yes | Account management, OTP, invoices | Required |
| Phone number | Yes | Booking contact, walk-in verification | Required |
| Physical address | Yes | KYC / rental agreement | Required |
| Date of birth | Yes | Driver eligibility | Required |
| Photos | Yes | KYC documents, vehicle condition evidence | Required for booking |
| **Government ID** | Yes | Driving-licence verification (legal requirement) | Required for booking |
| Purchase history | Yes | Booking, invoice and payment records | Required |
| App interactions / diagnostics | Only if you add analytics — **none present today** | — | — |

Declarations to tick:

- Data is **encrypted in transit** — yes (HTTPS only; cleartext is debug-only).
- Users **can request data deletion** — yes → URL `https://whatuwantrentals.com/legal/delete-account`
- Data is **not** shared with third parties for advertising.
- Payment card data is **not** collected by the app (handled by the payment gateway).

> If you later add Firebase/Crashlytics/analytics, this form must be updated —
> a stale Data safety form is itself a policy violation.

---

## 5. Store listing assets

Generated and committed in `mobile/store-assets/`:

| Asset | File | Spec |
|---|---|---|
| Hi-res icon | `play-icon-512.png` | 512×512, 32-bit PNG, no alpha ✅ |
| Feature graphic | `play-feature-graphic-1024x500.png` | 1024×500, no alpha ✅ |

**Still required from you — Google will not let you publish without these:**

- **Phone screenshots**: 2–8 images, PNG/JPEG, 16:9 or 9:16, each side
  320–3840 px. Capture from a real device or emulator: Home, Offers list,
  Vehicle detail, Checkout, Trips.
- **Short description**: ≤ 80 characters.
- **Full description**: ≤ 4000 characters.

`store-assets/ALT-feature-graphic-with-car-REVIEW-IP.png` is an alternate feature
graphic built from `assets/hero-dark.jpg`. **It depicts a recognisable Porsche
Cayenne.** Using another manufacturer's trademarked vehicle design in store
marketing is a trademark risk — do not upload it without clearing rights. The
default brand-only graphic is the safe choice. (The same image is used as the
in-app home hero; lower risk there, but worth reviewing.)

---

## 6. Building and submitting

### 6.1 Prerequisites

```bash
npm install -g eas-cli
eas login          # account: sushanshetty
cd mobile
```

### 6.2 Production build (AAB)

```bash
cd mobile
eas build --platform android --profile production
```

- Produces an **.aab** (Play requires app bundles for new apps).
- `appVersionSource: remote` means EAS assigns and increments `versionCode`
  automatically — you do **not** edit it by hand.
- Bump the user-facing `version` in `app.json` (e.g. `1.0.0` → `1.0.1`) for each
  meaningful release.

Because the package name changed, **the next build generates a new Android
keystore**. That is expected and correct — nothing was ever published under the
old name. Let EAS manage it, then back it up:

```bash
eas credentials --platform android      # view / download the keystore
```

> Losing the keystore before enrolling in Play App Signing means you can never
> update the app. Enrol in **Play App Signing** (default for new apps) so Google
> holds the signing key and EAS holds only the upload key.

### 6.3 First release — must be manual

A brand-new app's first bundle cannot be pushed by `eas submit`; the Console has
to create the app entry first.

1. Download the `.aab` from the EAS build page.
2. Play Console → Testing → **Internal testing** → Create new release.
3. Upload the `.aab`, add release notes, roll out to internal testers.
4. Verify install and sign-in on a real device against the production API.

### 6.4 Automated submission (after the first upload)

Create the service account once:

1. Play Console → Setup → **API access** → link a Google Cloud project.
2. In Google Cloud → IAM → Service Accounts → create one → **Keys → Add key →
   JSON**. Download it.
3. Play Console → Users and permissions → Invite the service-account email →
   grant **Release** permissions (Release to testing tracks / production).
4. Save the JSON as `mobile/google-play-service-account.json`.
   **It is gitignored — never commit it.**

Then:

```bash
cd mobile
eas build --platform android --profile production
eas submit --platform android --profile production --latest
```

`eas.json` sets `track: internal` and `releaseStatus: draft`, so submissions land
as a draft on the internal track. Promote to production in the Console when
you're ready. To submit straight to another track, edit `submit.production.android.track`
(`internal` → `alpha` → `beta` → `production`).

Alternative to a local key file — store it as an EAS secret:

```bash
eas secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY \
  --type file --value ./google-play-service-account.json
```

---

## 7. Pre-submission verification

```bash
cd mobile

# 1. Config resolves and the identity is right
npx expo config --type public --json | grep -E '"package"|"version"'

# 2. Typecheck
npx tsc --noEmit

# 3. Confirm RECORD_AUDIO is stripped from the real manifest
npx expo prebuild --platform android --no-install --clean
grep -A0 'RECORD_AUDIO' android/app/src/main/AndroidManifest.xml
#   -> must show tools:node="remove"
rm -rf android      # IMPORTANT: delete it again (see warning below)
```

> **Never commit or keep the generated `android/` directory.** Its presence
> switches the project to the bare workflow, after which `app.json` changes
> (icons, permissions, package name) silently stop applying to EAS builds.
> `prebuild` also rewrites `package.json` scripts to `expo run:*` — revert that
> with `git checkout mobile/package.json`.

Manual checks on a real device before rolling out:

- Sign in, sign up, and **Forgot password** (needs §1.1 deployed).
- Profile → **Delete account** → confirm; the account signs out and cannot sign
  in again. Confirm it is refused (409) while a booking is active.
- Book a vehicle end-to-end against the production API.
- App icon renders correctly on the launcher (not a blank square).

---

## 8. Release checklist

- [ ] Backend deployed — forgot-password returns 400, `DELETE /api/user/account` returns 403
- [ ] Frontend deployed — `/legal/delete-account` returns 200
- [ ] Support mailbox verified; `whatuwantrental.in` addresses corrected
- [ ] Developer account type checked; closed test started if personal
- [ ] `eas build --profile production` succeeds and yields an `.aab`
- [ ] Keystore backed up / Play App Signing enrolled
- [ ] First `.aab` uploaded manually to internal testing
- [ ] Demo credentials supplied under **App access**
- [ ] Data safety form completed (incl. Government ID + deletion URL)
- [ ] Content rating, target audience (18+), ads = none, financial features declared
- [ ] Privacy policy URL set
- [ ] Screenshots, short + full description uploaded
- [ ] Tested on a real device against the production API

---

## 9. Known gaps and deferred items

- **No crash reporting.** There is no Sentry/Crashlytics, so production crashes
  surface only as Play Console ANR/crash reports. Adding one later requires
  updating the Data safety form.
- **No OTA updates.** `expo-updates` is not installed; every change needs a new
  store release. This is a deliberate simplification, not an oversight.
- **JWTs are signed without an expiry** (`jwtsign` sets no `expiresIn`), so
  access tokens are valid forever. `authCheckJwt` now checks the soft-delete
  tombstone on every request so deleted accounts lose access immediately, but
  adding a real token expiry + refresh flow is still the correct fix.
- **Retention periods** on the deletion page (8 years for books of account, per
  the Companies Act 2013) are the conservative Indian statutory maximum.
  Confirm them with your accountant and adjust the page if they differ.
- **iOS is not configured for release.** The bundle identifier is set, but no
  App Store provisioning, and `ios/` is gitignored. This guide is Android-only.
