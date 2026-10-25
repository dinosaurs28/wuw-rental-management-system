import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DL_PHOTOS_REQUIRED,
  DL_PHOTOS_REQUIRED_MESSAGE,
  describeDlPhotoSides,
  dlPhotosState,
  hasDlPhotosOnFile,
} from "@repo/schemas";
import { bookingDlKycFileId, DlPhotosRequiredError } from "./dl-photos.service.js";

const doc = (side: string, status = "PENDING", type = "DL", fileId = 1) => ({ type, side, status, fileId });

test("both DL sides on file (PENDING or APPROVED) pass", () => {
  assert.equal(hasDlPhotosOnFile([doc("FRONT"), doc("BACK")]), true);
  assert.equal(hasDlPhotosOnFile([doc("FRONT", "APPROVED"), doc("BACK", "APPROVED")]), true);
  assert.equal(hasDlPhotosOnFile([doc("FRONT", "APPROVED"), doc("BACK", "PENDING")]), true);
});

test("a missing side fails and is named", () => {
  assert.equal(hasDlPhotosOnFile([]), false);
  assert.equal(hasDlPhotosOnFile(null), false);
  assert.deepEqual(dlPhotosState([doc("FRONT")]).missingSides, ["BACK"]);
  assert.deepEqual(dlPhotosState([doc("BACK")]).missingSides, ["FRONT"]);
  assert.deepEqual(dlPhotosState([]).missingSides, ["FRONT", "BACK"]);
});

test("a REJECTED side doesn't count and is reported as rejected", () => {
  const s = dlPhotosState([doc("FRONT", "REJECTED"), doc("BACK", "APPROVED")]);
  assert.equal(s.ok, false);
  assert.deepEqual(s.missingSides, ["FRONT"]);
  assert.deepEqual(s.rejectedSides, ["FRONT"]);
  assert.equal(s.back?.side, "BACK");
});

test("other document types never count as DL photos", () => {
  assert.equal(hasDlPhotosOnFile([doc("FRONT", "APPROVED", "AADHAAR"), doc("BACK", "APPROVED", "AADHAAR")]), false);
  assert.equal(hasDlPhotosOnFile([doc("FRONT", "APPROVED", "AADHAAR"), doc("BACK"), doc("FRONT")]), true);
});

test("describeDlPhotoSides", () => {
  assert.equal(describeDlPhotoSides(["FRONT", "BACK"]), "front and back");
  assert.equal(describeDlPhotoSides(["BACK"]), "back");
});

test("DlPhotosRequiredError answers 422 DL_PHOTOS_REQUIRED with the customer message", () => {
  const aadhaarOk = { ok: true, missingSides: [], rejectedSides: [] };
  const dlBack = { ok: false, missingSides: ["BACK" as const], rejectedSides: [] };
  const e = new DlPhotosRequiredError("customer", dlBack, aadhaarOk);
  assert.equal(e.status, 422);
  // The old fields keep their values; the Aadhaar check (Oct 25 2026) only adds fields.
  assert.deepEqual(e.toJSON(), {
    success: false,
    code: DL_PHOTOS_REQUIRED,
    message: DL_PHOTOS_REQUIRED_MESSAGE,
    missingSides: ["BACK"],
    rejectedSides: [],
    missingDocuments: ["DL"],
    dlPhotos: dlBack,
    aadhaarPhotos: aadhaarOk,
  });
  assert.equal(DL_PHOTOS_REQUIRED_MESSAGE, "Upload both sides of your driving licence to book.");
  assert.notEqual(
    new DlPhotosRequiredError("staff", { ok: false, missingSides: ["FRONT"], rejectedSides: [] }, aadhaarOk).message,
    DL_PHOTOS_REQUIRED_MESSAGE,
  );
});

test("the booking keeps the named DL photo, else the DL front", () => {
  const onFile = { frontFileId: 10, backFileId: 11, fileIds: [10, 11] };
  assert.equal(bookingDlKycFileId(onFile, null), 10);
  assert.equal(bookingDlKycFileId(onFile, 11), 11);
  // An Aadhaar (or any non-DL) file named by an older build → the DL front
  assert.equal(bookingDlKycFileId(onFile, 99), 10);
});
