---
goal: Convert KYC document upload from single image to front + back images per section
version: 1.0
date_created: 2026-05-28
last_updated: 2026-05-28
owner: manish076
status: 'Planned'
tags: [feature, migration, kyc, upload]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Currently, each KYC document type (DL, AADHAAR, PAN) accepts exactly one image per customer enforced by the unique constraint `[customerId, type]` on the `CustomerKyc` table. This plan converts the system to accept two images per document type — one for the **front side** and one for the **back side** — across the database schema, backend controllers, frontend web app, and mobile app.

---

## 1. Requirements & Constraints

- **REQ-001**: Each KYC document type must accept exactly two images: FRONT and BACK.
- **REQ-002**: Existing uploaded documents must not be deleted during migration; they are treated as FRONT side.
- **REQ-003**: The `side` field must be present in all upload API requests (`FRONT` | `BACK`).
- **REQ-004**: The unique constraint must change from `[customerId, type]` to `[customerId, type, side]`.
- **REQ-005**: The employee walk-in upload and the customer self-upload flows must both support front/back.
- **REQ-006**: The mobile employee KYC upload page must show separate upload slots for FRONT and BACK per document type.
- **REQ-007**: The KYC status (PENDING/APPROVED/REJECTED) is tracked per side independently.
- **CON-001**: No breaking changes to the R2 bucket key naming for existing files; new files follow the same pattern.
- **CON-002**: The Prisma migration must preserve existing rows by backfilling `side = FRONT` on all current records.
- **CON-003**: No new npm packages are required.
- **GUD-001**: Frontend UI must clearly label each upload zone as "Front Side" and "Back Side".
- **GUD-002**: A document type is considered "complete" only when both FRONT and BACK are uploaded.
- **PAT-001**: Follow the existing controller/service/store pattern already established in the codebase.

---

## 2. Implementation Steps

### Implementation Phase 1 — Database Schema & Migration

- GOAL-001: Add `KycSide` enum and `side` field to `CustomerKyc`, update unique constraint, and generate migration with data backfill.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `packages/db/prisma/schema.prisma` add enum `KycSide { FRONT BACK }` after the `KycStatus` enum (around line 35). | | |
| TASK-002 | In `packages/db/prisma/schema.prisma` add field `side KycSide @default(FRONT)` to the `CustomerKyc` model (after the `type` field, around line 282). | | |
| TASK-003 | In `packages/db/prisma/schema.prisma` change `@@unique([customerId, type])` to `@@unique([customerId, type, side])` in the `CustomerKyc` model. | | |
| TASK-004 | Run `npx prisma migrate dev --name add_kyc_side` from `packages/db/`. The generated migration SQL must set `side = 'FRONT'` for all existing rows before adding the NOT NULL constraint (Prisma handles this via `@default(FRONT)` in shadow DB). Verify the generated SQL contains the backfill. | | |
| TASK-005 | Run `npx prisma generate` from `packages/db/` to regenerate the Prisma client with the new `KycSide` type. | | |

### Implementation Phase 2 — Backend: User KYC Controller

- GOAL-002: Update `apps/backend/src/controller/user/kyc.controller.ts` to accept and store the `side` parameter.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | In `UploadKycDocument` (line ~62): extract `side` from `req.body` and validate it is `"FRONT"` or `"BACK"` (return 400 if missing/invalid). | | |
| TASK-007 | In `UploadKycDocument` duplicate-check query: change `where: { customerId, type }` to `where: { customerId_type_side: { customerId, type, side } }` using the new Prisma unique compound. Return HTTP 409 if that side already exists. | | |
| TASK-008 | In `UploadKycDocument` `prisma.customerKyc.create(...)` call: add `side` to the data object so the record stores the correct side. | | |
| TASK-009 | In `GetKycDocuments` (line ~31): no query change needed; verify the returned records include the `side` field (Prisma will include it automatically after schema change). | | |

### Implementation Phase 3 — Backend: Walk-in KYC Controller

- GOAL-003: Update `apps/backend/src/controller/employee/walkin/kyc.controller.ts` to accept `side` and use it in the upsert logic.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `UploadWalkinKyc` (line ~15): extract `side` from `req.body` (alongside `kyc_type`). Validate it is `"FRONT"` or `"BACK"`; return 400 if invalid. | | |
| TASK-011 | In `UploadWalkinKyc` upsert block (lines ~96-124): change the `where` clause from `{ customerId_type: { customerId, type } }` to `{ customerId_type_side: { customerId, type, side } }`. Pass `side` in both `create` and `update` data payloads. | | |
| TASK-012 | In `UploadKycDialog` validation schema (`apps/frontend/src/components/booking/UploadKycDialog.tsx`, line ~44): add `side: z.enum(["FRONT", "BACK"])` to the Zod schema. Update the FormData append call to include `kyc_side` (or `side`) matching the backend field name. | | |

### Implementation Phase 4 — Frontend: Types, Service & Store

- GOAL-004: Propagate the `side` field through the frontend type system, service layer, and Zustand store.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | In `apps/frontend/src/services/kyc.service.ts`: add `side: "FRONT" \| "BACK"` to the `KycDocument` type. Update `uploadDocument(file, type, side)` signature to append `side` to the FormData. | | |
| TASK-014 | In `apps/frontend/src/store/kyc.store.ts`: add `side: "FRONT" \| "BACK"` to the `KycDocument` interface. Update `getDocumentByType(type, side)` to filter by both `type` and `side`. Update `hasRequiredDocuments()` to return `true` only when at least one type has both FRONT and BACK uploaded. | | |

### Implementation Phase 5 — Frontend: KYC Verification Page & Components

- GOAL-005: Update the web UI to display two upload zones per document type, clearly labeled "Front Side" and "Back Side".

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | In `apps/frontend/src/components/verification/DocumentTypeSelector.tsx`: change the "Uploaded" badge logic to show `"Front ✓"`, `"Back ✓"`, or `"Complete ✓"` based on which sides are uploaded for that type. A type is fully uploaded when both FRONT and BACK records exist. | | |
| TASK-016 | In `apps/frontend/src/components/verification/DocumentUploadZone.tsx`: add an optional `side?: "FRONT" \| "BACK"` prop. When provided, display a label `"Front Side"` or `"Back Side"` above the dropzone area. | | |
| TASK-017 | In `apps/frontend/src/pages/verification/KycVerificationPage.tsx`: when a document type is selected, render **two** `DocumentUploadZone` components side-by-side (or stacked on mobile) — one with `side="FRONT"` and one with `side="BACK"`. Pass the `side` value to `kycService.uploadDocument(file, type, side)`. | | |
| TASK-018 | In `apps/frontend/src/components/verification/UploadedDocumentsGrid.tsx`: add a `"Front"` / `"Back"` label badge on each document card using the `side` field from the document data. | | |

### Implementation Phase 6 — Frontend: Booking Flow Components

- GOAL-006: Update inline booking KYC upload and selection card to handle front/back.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | In `apps/frontend/src/components/booking/InlineKycUpload.tsx`: after document type is selected, show two upload zones (FRONT and BACK) similar to TASK-017. Pass `side` to the upload service call. | | |
| TASK-020 | In `apps/frontend/src/components/booking/KycSelectionCard.tsx`: update the document card display to show both front and back thumbnails when available. Adjust the "pending count" logic to count sides independently. | | |
| TASK-021 | In `apps/frontend/src/components/booking/UploadKycDialog.tsx`: add a `side` radio/toggle field (`Front Side` / `Back Side`) to the dialog form. Include `side` in the FormData sent to `POST /employee/walkin/kyc/upload`. | | |

### Implementation Phase 7 — Mobile App

- GOAL-007: Update `mobile/app/employee/walkin/kyc/[publicId].tsx` to show separate FRONT and BACK upload slots per document type.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | In `mobile/app/employee/walkin/kyc/[publicId].tsx`: for each document type entry in the list, render two upload rows — "Front Side" and "Back Side". Each row has its own camera/library picker and shows its own upload status. | | |
| TASK-023 | In the mobile upload FormData build: append `side` (`"FRONT"` or `"BACK"`) alongside `kyc_type` and `customer_public_id` before POSTing to `/employee/walkin/kyc/upload`. | | |
| TASK-024 | Update the document completion tracker counter: a type counts as complete only when both FRONT and BACK are uploaded. Max complete count changes from 4 to 8 (4 types × 2 sides). | | |

---

## 3. Alternatives

- **ALT-001**: Add a `backFileId` column to `CustomerKyc` (alongside existing `fileId` renamed to `frontFileId`). Rejected because it requires a column rename (data migration risk), makes the schema asymmetric, and complicates delete/status logic which currently operates on a single record.
- **ALT-002**: Store both images as a JSON array in a single `fileIds` column. Rejected because it breaks relational integrity, makes querying/filtering by side impossible at the DB level, and is inconsistent with the existing `FileObject` foreign-key pattern.
- **ALT-003**: Create a new `CustomerKycSide` join table linking `CustomerKyc` to `FileObject` with a side enum. Rejected as over-engineered; the simpler `side` field on the existing model achieves the same result.

---

## 4. Dependencies

- **DEP-001**: Prisma ORM — schema migration and client regeneration (`packages/db/`).
- **DEP-002**: Cloudflare R2 — no changes needed; existing upload logic reused as-is.
- **DEP-003**: Sharp image processor (`apps/backend/src/utils/image-processor.ts`) — no changes needed.
- **DEP-004**: React-dropzone — already installed in frontend; no new package needed.
- **DEP-005**: Zod — already used in `UploadKycDialog`; extend existing schema only.

---

## 5. Files

- **FILE-001**: `packages/db/prisma/schema.prisma` — add `KycSide` enum, `side` field, update unique constraint.
- **FILE-002**: `packages/db/prisma/migrations/<timestamp>_add_kyc_side/migration.sql` — generated migration file.
- **FILE-003**: `apps/backend/src/controller/user/kyc.controller.ts` — accept `side` in upload, update conflict check.
- **FILE-004**: `apps/backend/src/controller/employee/walkin/kyc.controller.ts` — accept `side`, update upsert where clause.
- **FILE-005**: `apps/frontend/src/services/kyc.service.ts` — add `side` to type and `uploadDocument` signature.
- **FILE-006**: `apps/frontend/src/store/kyc.store.ts` — add `side` to `KycDocument`, update helpers.
- **FILE-007**: `apps/frontend/src/pages/verification/KycVerificationPage.tsx` — render two upload zones per type.
- **FILE-008**: `apps/frontend/src/components/verification/DocumentTypeSelector.tsx` — update badge logic.
- **FILE-009**: `apps/frontend/src/components/verification/DocumentUploadZone.tsx` — add `side` prop and label.
- **FILE-010**: `apps/frontend/src/components/verification/UploadedDocumentsGrid.tsx` — show Front/Back badge on cards.
- **FILE-011**: `apps/frontend/src/components/booking/InlineKycUpload.tsx` — two upload zones per type.
- **FILE-012**: `apps/frontend/src/components/booking/KycSelectionCard.tsx` — show both side thumbnails.
- **FILE-013**: `apps/frontend/src/components/booking/UploadKycDialog.tsx` — add side toggle to dialog form.
- **FILE-014**: `mobile/app/employee/walkin/kyc/[publicId].tsx` — FRONT/BACK rows per document type.

---

## 6. Testing

- **TEST-001**: After migration, verify all existing `CustomerKyc` rows have `side = 'FRONT'` using a direct DB query.
- **TEST-002**: POST to `POST /user/kyc` with `type=DL, side=FRONT` — expect 201. POST again with same type and side — expect 409. POST with `side=BACK` — expect 201.
- **TEST-003**: POST to `POST /employee/walkin/kyc/upload` with `kyc_type=AADHAAR, side=FRONT` — expect success. Re-upload same type+side — expect the existing record to be updated (upsert) and status reset to PENDING.
- **TEST-004**: `GET /user/kyc` — verify each returned document includes a `side` field with value `"FRONT"` or `"BACK"`.
- **TEST-005**: On the KYC Verification web page, select "Driver's License" — verify two dropzones appear labeled "Front Side" and "Back Side". Upload a file to each. Verify both appear in the uploaded documents grid with correct labels.
- **TEST-006**: In the DocumentTypeSelector, verify: no uploads → no badge; one side uploaded → partial badge; both sides uploaded → "Complete" badge.
- **TEST-007**: On the mobile employee KYC page, verify each document type shows two rows (Front Side, Back Side) each with its own upload button and status indicator.
- **TEST-008**: Delete a FRONT document via `DELETE /user/kyc` — verify only the FRONT record is deleted; the BACK record remains untouched.

---

## 7. Risks & Assumptions

- **RISK-001**: The Prisma migration with `@default(FRONT)` may not auto-backfill in all Postgres versions. Mitigation: manually verify the generated SQL contains `ALTER COLUMN side SET DEFAULT 'FRONT'` before applying to production.
- **RISK-002**: Existing customers who have already uploaded a document will see it as "Front Side only" — the Back Side will appear as a missing upload slot. This is expected and by design.
- **RISK-003**: The `hasRequiredDocuments()` store helper is used in the booking flow to gate progression. Changing it to require both sides could block existing customers mid-booking. Mitigation: keep the booking gate as "at least one complete document type (both sides)" but do not retroactively invalidate existing approved single-side documents.
- **ASSUMPTION-001**: All three document types (DL, AADHAAR, PAN) require both front and back. STUDENT_ID follows the same pattern.
- **ASSUMPTION-002**: The KYC approval/rejection workflow remains per-side — each side can be independently approved or rejected by staff.
- **ASSUMPTION-003**: No changes are needed to the booking KYC verification (`apps/backend/src/controller/employee/kyc.controller.ts`) since it reads from `CustomerKyc` which now returns side-aware records automatically.

---

## 8. Related Specifications / Further Reading

- Current schema: `packages/db/prisma/schema.prisma` lines 277–293
- User KYC controller: `apps/backend/src/controller/user/kyc.controller.ts`
- Walk-in KYC controller: `apps/backend/src/controller/employee/walkin/kyc.controller.ts`
- Prisma docs on compound unique constraints: https://www.prisma.io/docs/orm/reference/prisma-schema-reference#unique-1
