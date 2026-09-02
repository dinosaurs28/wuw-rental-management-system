# App Store resubmission — WUW Rentals (iOS)

Context for the build that answers the **Guideline 5.1.1(v)** rejection.

| | |
|---|---|
| Rejected submission ID | `55a8cf9b-69f0-4d3c-9179-518c4bce9cad` |
| Rejected version | 1.0 (2) |
| Review date | 01 Sep 2026 |
| Review device | iPad Air 11-inch (M3) |
| Bundle identifier | `com.whatuwantrentals.rentals` (permanent — never change) |
| EAS project | `05793a28-9b7b-4db6-8b2d-75f22fd68de4`, owner `dinosaurs28` |

---

## 1. Reply to App Review

Paste into the App Store Connect **Resolution Center**, replying on the rejected
submission. Plain text, no formatting.

> Thank you for the review.
>
> We have removed the account requirement for browsing. The previous build sent
> every user without a session to a sign-in screen at launch; that screen is gone.
>
> Without registering or signing in, a user can now:
>
> - Launch the app straight into the vehicle listing.
> - Browse the available fleet and switch between our branches.
> - Open any vehicle to see its full detail page, including photos,
>   specifications and pricing (base rate, refundable deposit, GST and total).
> - Search the fleet, and filter and sort it by branch and by vehicle category.
> - Save vehicles to a Saved list held on the device.
> - Read our Terms & Conditions, Privacy Policy, Refund Policy, FAQ and
>   Help & Contact pages.
>
> Sign-in is now requested only at the booking step — when the user taps
> "Book now" on a vehicle — and on the Trips and Profile tabs. These are
> account-based features: a booking, a customer's own rental history, and their
> own KYC documents. We understand this to be permitted under 5.1.1(v).
>
> To verify: install the build and open the app. You will land directly on the
> "Rent" tab showing the vehicle list, with no sign-in prompt. Tap any vehicle to
> see its detail page and pricing, and use the search screen to filter by branch
> and category — all without an account. Only when you then tap "Book now" does
> the app ask you to sign in.

**Confirm before sending:**

- [ ] The reply deliberately does NOT mention the Razorpay payment migration.
      It is factual but volunteers a payment flow for scrutiny the reviewer did
      not ask about. Section 5 still covers testing it before you submit.
- [ ] Nothing above promises a feature that is not in the build you actually
      upload. Re-read it against the pre-submit checklist in §4.

---

## 2. Version and build number

**Do not hardcode a build number.** This project uses EAS **remote** version
management:

- `eas.json` → `cli.appVersionSource: "remote"`
- `eas.json` → `build.production.autoIncrement: true`

With `appVersionSource: "remote"`, EAS stores `buildNumber` (iOS) and
`versionCode` (Android) on its own servers, and any `ios.buildNumber` /
`android.versionCode` written into `app.json` is **ignored**. Because the
production profile sets `autoIncrement: true`, each production build reads the
last remote value and bumps it — so the next iOS build becomes **1.0 (3)** on its
own, and the "same build number" upload error cannot occur.

The marketing `version` stays `1.0.0` in `app.json` (Apple displays it as
"1.0"). This is a fix to the same release, not a new one, so it does not change.

Before building, confirm the remote counter is where you expect:

```bash
cd mobile
eas build:version:get --platform ios
```

If it reports `2`, the next build is `3` — correct. If it reports nothing or a
value below `2`, set it explicitly **once** so the next auto-increment lands
above the rejected build:

```bash
eas build:version:set --platform ios   # enter 2 when prompted
```

---

## 3. Build and submit

Profile names below are the real ones from `mobile/eas.json` — `development`,
`preview`, `production`. There is no separate iOS-only profile.

```bash
cd mobile

# 1. Sanity check the config before spending a build slot
npx tsc --noEmit
npx expo-doctor

# 2. Production build (auto-increments the remote iOS buildNumber)
eas build --platform ios --profile production

# 3. Submit the finished build
eas submit --platform ios --profile production
```

**TODO — iOS submit credentials are not in the repo.** `eas.json` →
`submit.production` currently configures Android only
(`google-play-service-account.json`, `internal` track, `draft` status). There is
no `submit.production.ios` block, so `eas submit --platform ios` will prompt
interactively for the Apple ID, App Store Connect app ID (`ascAppId`) and team
ID. Either answer the prompts, or add an `ios` block to `submit.production` once
those values are known — do not guess them.

After submission, in App Store Connect: attach the new build to the 1.0 version,
then post the §1 reply in the Resolution Center and resubmit for review.

---

## 4. Pre-submit checklist (human, on a real device)

Run this against an **EAS build or dev build** — see §5. Uninstall any previous
copy first so no token survives in the keychain.

Guest browsing — the actual rejection:

- [ ] Launch the app with no account. It lands on the **Rent** tab, not sign-in.
- [ ] The vehicle list loads and shows real vehicles.
- [ ] The branch selector switches branches and the list updates.
- [ ] Tap a vehicle → detail page opens; photos, specs and a price are visible.
- [ ] Pick dates on the detail page → the price breakdown (base rate, deposit,
      GST, total) appears.
- [ ] Open search → filter by branch and by category, and change the sort.
- [ ] Saved tab works; saving and unsaving a vehicle does not ask for an account.
- [ ] Profile tab shows the guest state with Terms, Privacy, Refund, FAQ and
      Help & Contact all openable.
- [ ] Trips tab shows the "sign in" explainer rather than throwing you out.
- [ ] **Only now**: tap "Book now" on a vehicle → sign-in is requested, and after
      signing in you are returned to that same vehicle.

Do this on an iPad as well as an iPhone — Apple reviewed on an iPad Air 11-inch
(M3), and will likely do so again. The app is iPhone-only (see §6), so on iPad it
runs in iPhone compatibility mode; confirm it launches, browses and books there.

Regressions to spot-check:

- [ ] Sign in, sign out, sign up all still work.
- [ ] An existing customer's Trips and Profile load with real data.
- [ ] Camera and photo-library permission prompts appear with sensible text when
      uploading a KYC document.

---

## 5. This build also carries the PhonePe → Razorpay payment migration

Payments must be verified in the same pass, not assumed.

`react-native-razorpay` is a **native module**. It cannot run in Expo Go — the
checkout sheet will fail to open. Test payments on a development build
(`eas build --profile development`) or on the production build itself:

- [ ] Complete a real booking end to end and confirm the Razorpay checkout sheet
      opens.
- [ ] A successful payment lands the booking on the confirmed state.
- [ ] Cancelling the Razorpay sheet is handled gracefully and does not orphan a
      booking.
- [ ] The booking status screen resolves correctly when the webhook confirms late.

See `docs/RAZORPAY_SETUP.md` for keys and webhook configuration.

---

## 6. Config notes for this submission

Changes made to `mobile/app.json` for this build:

- `expo-audio` plugin now passes `microphonePermission: false`. It previously ran
  with defaults, which injected an `NSMicrophoneUsageDescription` ("Allow WUW
  Rentals to access your microphone") even though the app only *plays* a sound on
  the splash screen and never records. Shipping a permission string for a
  capability the app does not use is an avoidable review flag.
- The `NSCameraUsageDescription` string was unified. `expo-image-picker` and
  `expo-camera` both write that key and the later plugin wins, so the shipped
  string was the camera one, which mentioned only QR scanning and vehicle photos
  and omitted driving-licence capture. Both now carry one string covering all
  three uses.
- `photosPermission` reworded to say "WUW Rentals" to match the app name.

Deliberately left alone:

- `ios.supportsTablet: false` — the app ships as iPhone-only. That is coherent
  with the rejection: an iPhone-only app still installs and runs on iPad in
  compatibility mode, which is how Apple reviewed it, so the iPad review device
  does not imply an iPad-support defect. Turning `supportsTablet` on would commit
  the UI to a large-screen layout nobody has designed or tested, and would demand
  iPad screenshots. Leave it false unless iPad is a product decision.
- `ITSAppUsesNonExemptEncryption: false` — present and correct; the app uses only
  HTTPS.
- `LSApplicationQueriesSchemes: ["tez", "phonepe", "paytmmp"]` — well-formed, for
  the Razorpay UPI app handoff. Left as is.
- No privacy manifest (`PrivacyInfo.xcprivacy`) is committed, because `mobile/ios/`
  is generated by prebuild and intentionally not in the repo. Expo generates the
  manifest from the installed modules. If Apple emails an `ITMS-91053`
  missing-reason-API warning, the fix is an `ios.privacyManifests` block in
  `app.json` — not a checked-in `ios/` directory.
- `eas.json` was not modified. Its version handling is already correct for a
  resubmission (§2).
