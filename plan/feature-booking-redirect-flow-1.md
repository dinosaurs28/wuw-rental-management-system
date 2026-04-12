---
goal: Fix booking redirect flows — unauthenticated booking intent, post-profile redirect, and post-KYC return-to-review
version: 1.0
date_created: 2026-04-12
last_updated: 2026-04-12
owner: manish076
status: 'Completed'
tags: [feature, bug, booking, auth, kyc, profile, redirect]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Three broken redirect flows exist in the booking funnel. Each one drops the user out of context — away from the vehicle they were trying to book — and forces a manual restart of the process. This plan fixes all three with a shared `bookingIntent` mechanism in the auth store, a `returnTo` query-param convention for in-funnel redirects, and an inline KYC upload panel embedded directly in the Review page (matching the existing pattern used for the vehicle selection state).

---

## 1. Requirements & Constraints

- **REQ-001**: After a successful login (password or OTP), if a `bookingIntent` was saved, the user must be redirected to `/booking/review-confirm` — not `/my-bookings`.
- **REQ-002**: When the user clicks "Book Vehicle" while unauthenticated, the current vehicle rental store state (vehicleId, dates, pricing) must be persisted and a `bookingIntent` flag must be written to the auth store before navigating to `/auth/sign-in`.
- **REQ-003**: The vehicle rental store already persists to `sessionStorage` under key `"vehicle-rental-dates"`. No changes required to its persistence layer.
- **REQ-004**: After the user completes their profile on `/profile`, if a `bookingIntent` is active in the auth store, they must be redirected back to `/booking/review-confirm`.
- **REQ-005**: The KYC upload UI must be embedded inline inside the Review page (inside `KycSelectionCard`) rather than navigating away to `/verification/kyc`. The standalone `/verification/kyc` page must remain functional for direct access.
- **REQ-006**: After KYC documents are uploaded inline, the inline upload panel must close and the document list in `KycSelectionCard` must refresh automatically — no page navigation required.
- **REQ-007**: The `bookingIntent` must be cleared from the auth store after it has been consumed (i.e., after the user lands on `/booking/review-confirm` post-login).
- **CON-001**: The vehicle rental store (`useVehicleRentalStore`) must not be modified structurally — only the auth store receives the new `bookingIntent` field.
- **CON-002**: Do not break the existing unauthenticated guard in `VehicleDetailsPage` — the check `isAuthenticated` → navigate to `/auth/sign-in` is the correct entry point for Case 1.
- **CON-003**: The `KycVerificationPage` at `/verification/kyc` must continue to work as a standalone page (used by direct navigation and existing deep links).
- **GUD-001**: Use the existing `useVehicleRentalStore` session-persistence pattern as the model for the `bookingIntent` flag. Keep auth store changes minimal.
- **PAT-001**: All in-funnel redirects (profile → review, kyc → review) use the auth store `bookingIntent` as the source of truth, not query params, to avoid URL manipulation.

---

## 2. Implementation Steps

### Implementation Phase 1 — Auth Store: Add `bookingIntent`

- GOAL-001: Add a `bookingIntent` boolean field and its setter/clearer to `useAuthStore` so all three flows can read and write booking intent state from a single source of truth.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `apps/frontend/src/store/auth.store.ts`: add `hasBookingIntent: boolean` (default `false`) to the store state interface and initial state. Add two actions: `setBookingIntent()` sets it to `true`; `clearBookingIntent()` sets it to `false`. Do NOT persist this field to localStorage/sessionStorage — it is session-only and must be lost on page refresh (the vehicle rental store in sessionStorage is the persistent half of the intent). | ✅ | 2026-04-12 |

---

### Implementation Phase 2 — Case 1: Unauthenticated "Book Vehicle" → Sign In → Review

- GOAL-002: When an unauthenticated user clicks "Book Vehicle", save the booking intent and redirect to sign-in. After login/OTP success, redirect to review instead of `/my-bookings`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-002 | In `apps/frontend/src/pages/VehicleDetailsPage.tsx`, in the `handleBookVehicle` function (lines 150–218): after `setVehicleFullDetails(...)` and `setApiPricingDetails(...)` are called, add a check `if (!isAuthenticated)`. If not authenticated: call `useAuthStore.getState().setBookingIntent()`, then `navigate("/auth/sign-in")`. If authenticated: keep the existing `navigate("/booking/review-confirm")`. The vehicle rental store is already populated with vehicle + date state at this point, so sessionStorage is pre-filled before the redirect. | ✅ | 2026-04-12 |
| TASK-003 | In `apps/frontend/src/hooks/useAuth.ts`, in the `useSignIn` `onSuccess` callback (line 38 — the `status === 200` branch): replace `navigate("/my-bookings")` with: `const { hasBookingIntent, clearBookingIntent } = useAuthStore.getState(); if (hasBookingIntent) { clearBookingIntent(); navigate("/booking/review-confirm"); } else { navigate("/my-bookings"); }` | ✅ | 2026-04-12 |
| TASK-004 | In `apps/frontend/src/hooks/useAuth.ts`, in the `useVerifyOtp` `onSuccess` callback (line 94 — after `checkAuth()`): apply the same `hasBookingIntent` check and redirect logic as TASK-003. This covers the OTP verification path for both sign-up and sign-in. | ✅ | 2026-04-12 |
| TASK-005 | In `apps/frontend/src/services/auth.service.ts`, in `googleSignIn()` (lines 123–142): before redirecting to `${API_BASE_URL}/auth/google`, if `useAuthStore.getState().hasBookingIntent` is `true`, append a query param `?returnTo=booking` to the OAuth initiation URL so the backend OAuth callback can pass it back. This is a best-effort enhancement — the full Google OAuth round-trip redirect is handled server-side and is lower priority. Mark as optional if OAuth callback URL is not configurable. | | |

---

### Implementation Phase 3 — Case 2: Authenticated → Review → Complete Profile → Back to Review

- GOAL-003: After the user fills their profile on `/profile` and saves it, if a booking intent is active, redirect them back to `/booking/review-confirm` automatically.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | In `apps/frontend/src/components/booking/KycSelectionCard.tsx`, in the "Complete Profile" button handler (line 152 — currently `navigate("/profile")`): before navigating, call `useAuthStore.getState().setBookingIntent()`. This marks that the user left the review page to complete their profile. | ✅ | 2026-04-12 |
| TASK-007 | In `apps/frontend/src/pages/ProfilePage.tsx`, in the `onSuccess` handler of `userService.updateProfile()` (line 121 — currently only shows a toast): add: `const { hasBookingIntent, clearBookingIntent } = useAuthStore.getState(); if (hasBookingIntent) { clearBookingIntent(); navigate("/booking/review-confirm"); }` — import `useNavigate` if not already present. The toast should still fire before the redirect. | ✅ | 2026-04-12 |

---

### Implementation Phase 4 — Case 3: Review → Inline KYC Upload → Back to Review

- GOAL-004: Embed the KYC upload UI inline inside `KycSelectionCard` on the Review page so the user never navigates away. After uploading, the panel collapses and the document list refreshes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | In `apps/frontend/src/components/booking/KycSelectionCard.tsx`: add a local state variable `showInlineKycUpload: boolean` (default `false`). When the "Complete KYC Verification" button is clicked (line 229 — currently `navigate("/verification/kyc")`), instead of navigating away, set `showInlineKycUpload = true`. | ✅ | 2026-04-12 |
| TASK-009 | Create a new component `apps/frontend/src/components/booking/InlineKycUpload.tsx`. This component renders the KYC document type selector and file upload form — reuse the logic from `apps/frontend/src/pages/verification/KycVerificationPage.tsx` (lines 57–168: fetch existing docs, document type select, file input, upload via `kycService.uploadDocument()`). Props: `onUploadSuccess: () => void` (callback) and `onCancel: () => void`. On successful upload: call `onUploadSuccess()`. On cancel or back: call `onCancel()`. No internal `navigate()` calls. | ✅ | 2026-04-12 |
| TASK-010 | In `apps/frontend/src/components/booking/KycSelectionCard.tsx`: when `showInlineKycUpload` is `true`, render `<InlineKycUpload>` in place of (or below) the "Complete KYC Verification" button. Pass `onUploadSuccess` as: `() => { setShowInlineKycUpload(false); fetchDocuments(); }` — where `fetchDocuments` is the existing function that re-fetches KYC docs and updates the list. Pass `onCancel` as: `() => setShowInlineKycUpload(false)`. | ✅ | 2026-04-12 |
| TASK-011 | In `apps/frontend/src/components/booking/KycSelectionCard.tsx`: expose the existing document-fetch function (currently called in `useEffect` on mount) as a named function so `onUploadSuccess` can call it to refresh the document list without a full page reload. Verify it already updates the `documents` state that drives the document selector UI. | ✅ | 2026-04-12 |

---

### Implementation Phase 5 — Cleanup & Edge Cases

- GOAL-005: Handle edge cases and ensure no stale intent state causes incorrect redirects.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | In `apps/frontend/src/pages/booking/ReviewConfirmPage.tsx`: on component mount, call `useAuthStore.getState().clearBookingIntent()`. This ensures that if the user lands on the review page by any means (direct nav, back button, etc.), stale intent is always cleared so subsequent unrelated sign-ins go to `/my-bookings` correctly. | ✅ | 2026-04-12 |
| TASK-013 | In `apps/frontend/src/pages/VehicleDetailsPage.tsx`: verify that `clearVehicleSelection()` (line 159) is called before repopulating store state on each "Book Vehicle" click — this already exists and ensures no stale vehicle state leaks into a new booking attempt. No change needed; document as verified. | ✅ | 2026-04-12 |

---

## 3. Alternatives

- **ALT-001**: Use a `?returnTo=<url>` query parameter on the sign-in page instead of the auth store. Rejected — query params are user-visible, can be tampered with, and are lost after OAuth redirects. The auth store (combined with the already-persisted vehicle rental sessionStorage) is cleaner.
- **ALT-002**: Navigate to `/verification/kyc?returnTo=/booking/review-confirm` and handle the return inside `KycVerificationPage`. Rejected — requires modifying the standalone KYC page and adds fragile query-param parsing. Inline embedding is more cohesive and matches the PRD request to "pass the KYC upload UI in that is present in the vehicle page".
- **ALT-003**: Persist `hasBookingIntent` to sessionStorage so it survives a page refresh. Rejected — the vehicle rental store already handles sessionStorage persistence. If the user refreshes mid-sign-in, the vehicle state is still there; the intent flag can be re-derived by checking if vehicle rental state is populated.

---

## 4. Dependencies

- **DEP-001**: `useAuthStore` (`apps/frontend/src/store/auth.store.ts`) — must be extended with `hasBookingIntent`, `setBookingIntent`, `clearBookingIntent` in Phase 1 before any other phase is implemented.
- **DEP-002**: `useVehicleRentalStore` (`apps/frontend/src/store/vehicleRental.store.ts`) — already persists to sessionStorage; no changes required but TASK-002 depends on it being populated before the unauthenticated redirect.
- **DEP-003**: `kycService.uploadDocument()` — already used in `KycVerificationPage.tsx`; must be imported in the new `InlineKycUpload` component (TASK-009).
- **DEP-004**: Phase 2 (TASK-003, TASK-004) depends on Phase 1 (TASK-001) completing first.
- **DEP-005**: Phase 3 (TASK-006, TASK-007) depends on Phase 1 (TASK-001) completing first.
- **DEP-006**: Phase 4 (TASK-009, TASK-010, TASK-011) depends on TASK-008.
- **DEP-007**: Phase 5 (TASK-012) is independent but should be done alongside Phase 2–4.

---

## 5. Files

- **FILE-001**: `apps/frontend/src/store/auth.store.ts` — add `hasBookingIntent`, `setBookingIntent`, `clearBookingIntent` (Phase 1)
- **FILE-002**: `apps/frontend/src/pages/VehicleDetailsPage.tsx` — add unauthenticated guard + intent setter in `handleBookVehicle` (Phase 2)
- **FILE-003**: `apps/frontend/src/hooks/useAuth.ts` — update `useSignIn` and `useVerifyOtp` redirect logic (Phase 2)
- **FILE-004**: `apps/frontend/src/services/auth.service.ts` — optional Google OAuth `returnTo` enhancement (Phase 2, TASK-005)
- **FILE-005**: `apps/frontend/src/components/booking/KycSelectionCard.tsx` — add intent setter on "Complete Profile" click; add inline KYC panel toggle (Phase 3 + Phase 4)
- **FILE-006**: `apps/frontend/src/pages/ProfilePage.tsx` — add post-save redirect when intent is active (Phase 3)
- **FILE-007**: `apps/frontend/src/components/booking/InlineKycUpload.tsx` — new component, KYC upload UI without navigation (Phase 4)
- **FILE-008**: `apps/frontend/src/pages/booking/ReviewConfirmPage.tsx` — clear intent on mount (Phase 5)

---

## 6. Testing

- **TEST-001**: Unauthenticated user visits `/vehicles/:id`, selects dates, clicks "Book Vehicle" → lands on `/auth/sign-in`. Vehicle rental store state is present in sessionStorage. After sign-in (password), user lands on `/booking/review-confirm` with vehicle pre-filled. Verify `/my-bookings` is NOT visited.
- **TEST-002**: Same as TEST-001 but via OTP sign-up flow — after OTP verification, user lands on `/booking/review-confirm`.
- **TEST-003**: Authenticated user with no profile visits `/booking/review-confirm` → `KycSelectionCard` shows "Complete Your Profile First" → clicks "Complete Profile" → lands on `/profile`. Fills form, saves → automatically redirected to `/booking/review-confirm`. Verify `KycSelectionCard` no longer shows "Complete Profile" (profile now exists).
- **TEST-004**: Authenticated user with profile but no KYC visits `/booking/review-confirm` → `KycSelectionCard` shows "Complete KYC Verification" → clicks it → inline KYC upload panel appears (no navigation away). Uploads document → panel closes, document list refreshes, uploaded doc appears selectable. Verify `/verification/kyc` is NOT visited.
- **TEST-005**: Authenticated user completes a normal sign-in with no booking intent → lands on `/my-bookings`. Verify `hasBookingIntent` does not interfere with standard login flow.
- **TEST-006**: User lands on `/booking/review-confirm` directly (not via booking intent flow) → `clearBookingIntent()` fires on mount. Then user signs out and signs back in → lands on `/my-bookings` (not review). Confirms stale intent is cleared.
- **TEST-007**: Direct navigation to `/verification/kyc` still works as a standalone page — not broken by Phase 4 changes.

---

## 7. Risks & Assumptions

- **RISK-001**: If the user's sessionStorage is cleared between "Book Vehicle" click and post-login redirect (e.g., browser privacy mode, tab close/reopen), the vehicle rental store will be empty and the review page will show no vehicle selected. Mitigation: `ReviewConfirmPage` already redirects away if `!hasVehicleSelected()`. In this edge case, the user lands on review, sees empty state, and must restart — acceptable behaviour, not a regression.
- **RISK-002**: Google OAuth (TASK-005) involves a server-side round-trip where `hasBookingIntent` in the client store is lost. The `returnTo` query-param approach on the OAuth URL is a partial mitigation but requires backend support. Mark TASK-005 as optional until backend OAuth callback supports `returnTo`.
- **RISK-003**: The `InlineKycUpload` component (TASK-009) replicates logic from `KycVerificationPage`. If `kycService.uploadDocument()` API changes, both places need updating. Mitigation: extract the shared upload logic into a custom hook `useKycUpload` if duplication becomes a maintenance concern post-MVP.
- **ASSUMPTION-001**: The vehicle rental store's sessionStorage persistence key `"vehicle-rental-dates"` survives the sign-in redirect (same tab, same origin). This is true for standard browser behaviour.
- **ASSUMPTION-002**: `KycSelectionCard`'s document-fetch function can be called imperatively after upload to refresh the list — this is true based on current implementation where it is a plain async function inside the component.
- **ASSUMPTION-003**: `hasBookingIntent` does not need to encode the specific vehicle ID or URL — the vehicle rental store in sessionStorage already holds all vehicle context. The flag is purely a boolean signal.

---

## 8. Related Specifications / Further Reading

- `apps/frontend/src/store/vehicleRental.store.ts` — existing session-persisted vehicle rental state (the model for intent persistence)
- `apps/frontend/src/store/auth.store.ts` — auth store to be extended in Phase 1
- `apps/frontend/src/hooks/useAuth.ts` — sign-in and OTP hooks where redirect logic lives
- `apps/frontend/src/components/booking/KycSelectionCard.tsx` — central component for Cases 2 and 3
- `apps/frontend/src/pages/verification/KycVerificationPage.tsx` — source for KYC upload logic to be reused in `InlineKycUpload`
