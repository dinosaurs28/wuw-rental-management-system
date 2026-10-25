import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AADHAAR_PHOTOS_REQUIRED,
  AADHAAR_PHOTOS_REQUIRED_MESSAGE,
  AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE,
  DL_PHOTOS_REQUIRED,
  DL_PHOTOS_REQUIRED_MESSAGE,
  DL_PHOTOS_REQUIRED_STAFF_MESSAGE,
  KYC_PHOTOS_REQUIRED_MESSAGE,
  KYC_PHOTOS_REQUIRED_STAFF_MESSAGE,
  aadhaarPhotosState,
  dlPhotosState,
  hasAadhaarPhotosOnFile,
  hasRequiredKycPhotosOnFile,
  kycPhotosRequiredCode,
  kycPhotosRequiredMessage,
  kycPhotosState,
  requiredKycPhotosState,
} from "@repo/schemas";
import { DlPhotosRequiredError } from "./dl-photos.service.js";

const doc = (type: string, side: string, status = "PENDING", fileId = 1) => ({ type, side, status, fileId });
const both = (type: string, status = "APPROVED") => [doc(type, "FRONT", status), doc(type, "BACK", status)];

test("Aadhaar: both sides (PENDING or APPROVED) are on file", () => {
  assert.equal(hasAadhaarPhotosOnFile(both("AADHAAR")), true);
  assert.equal(hasAadhaarPhotosOnFile(both("AADHAAR", "PENDING")), true);
  assert.equal(hasAadhaarPhotosOnFile([doc("AADHAAR", "FRONT", "APPROVED"), doc("AADHAAR", "BACK", "PENDING")]), true);
});

test("Aadhaar: a missing side fails and is named; a REJECTED side doesn't count", () => {
  assert.equal(hasAadhaarPhotosOnFile([]), false);
  assert.equal(hasAadhaarPhotosOnFile(undefined), false);
  assert.deepEqual(aadhaarPhotosState([doc("AADHAAR", "FRONT")]).missingSides, ["BACK"]);
  const s = aadhaarPhotosState([doc("AADHAAR", "FRONT"), doc("AADHAAR", "BACK", "REJECTED")]);
  assert.equal(s.ok, false);
  assert.deepEqual(s.missingSides, ["BACK"]);
  assert.deepEqual(s.rejectedSides, ["BACK"]);
  assert.equal(s.front?.type, "AADHAAR");
});

test("DL photos never count as Aadhaar photos and vice versa", () => {
  assert.equal(hasAadhaarPhotosOnFile(both("DL")), false);
  assert.equal(dlPhotosState(both("AADHAAR")).ok, false);
  assert.equal(kycPhotosState("AADHAAR", [...both("DL"), ...both("STUDENT_ID")]).ok, false);
});

test("required check: DL + Aadhaar, both sides each", () => {
  assert.equal(hasRequiredKycPhotosOnFile([...both("DL"), ...both("AADHAAR")]), true);
  assert.equal(hasRequiredKycPhotosOnFile(both("DL")), false);
  assert.equal(hasRequiredKycPhotosOnFile(both("AADHAAR")), false);
  assert.deepEqual(requiredKycPhotosState([]).missingTypes, ["DL", "AADHAAR"]);
  assert.deepEqual(requiredKycPhotosState(both("DL")).missingTypes, ["AADHAAR"]);
  assert.deepEqual(requiredKycPhotosState([...both("DL"), doc("AADHAAR", "FRONT")]).missingTypes, ["AADHAAR"]);
  assert.deepEqual(requiredKycPhotosState(both("AADHAAR")).missingTypes, ["DL"]);
  const r = requiredKycPhotosState([...both("DL"), doc("AADHAAR", "FRONT", "REJECTED"), doc("AADHAAR", "BACK")]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.aadhaar.rejectedSides, ["FRONT"]);
  assert.equal(r.dl.ok, true);
});

test("code: DL_PHOTOS_REQUIRED whenever the DL is missing, else AADHAAR_PHOTOS_REQUIRED", () => {
  assert.equal(kycPhotosRequiredCode(["DL"]), DL_PHOTOS_REQUIRED);
  assert.equal(kycPhotosRequiredCode(["DL", "AADHAAR"]), DL_PHOTOS_REQUIRED);
  assert.equal(kycPhotosRequiredCode(["AADHAAR"]), AADHAAR_PHOTOS_REQUIRED);
});

test("messages: one document names it, both name both (customer + staff)", () => {
  assert.equal(kycPhotosRequiredMessage(["DL"]), DL_PHOTOS_REQUIRED_MESSAGE);
  assert.equal(kycPhotosRequiredMessage(["DL"], "staff"), DL_PHOTOS_REQUIRED_STAFF_MESSAGE);
  assert.equal(kycPhotosRequiredMessage(["AADHAAR"]), "Upload both sides of your Aadhaar card to book.");
  assert.equal(
    kycPhotosRequiredMessage(["AADHAAR"], "staff"),
    "Capture both sides of the customer's Aadhaar before creating the booking.",
  );
  assert.equal(kycPhotosRequiredMessage(["DL", "AADHAAR"]), KYC_PHOTOS_REQUIRED_MESSAGE);
  assert.match(KYC_PHOTOS_REQUIRED_MESSAGE, /driving licence/);
  assert.match(KYC_PHOTOS_REQUIRED_MESSAGE, /Aadhaar/);
  assert.equal(kycPhotosRequiredMessage(["DL", "AADHAAR"], "staff"), KYC_PHOTOS_REQUIRED_STAFF_MESSAGE);
  assert.match(KYC_PHOTOS_REQUIRED_STAFF_MESSAGE, /driving licence and Aadhaar/);
});

test("DlPhotosRequiredError: only the Aadhaar missing → AADHAAR_PHOTOS_REQUIRED with its sides", () => {
  const dlOk = { ok: true, missingSides: [], rejectedSides: [] };
  const aadhaar = { ok: false, missingSides: ["BACK" as const], rejectedSides: ["BACK" as const] };
  const e = new DlPhotosRequiredError("customer", dlOk, aadhaar);
  assert.equal(e.status, 422);
  assert.deepEqual(e.toJSON(), {
    success: false,
    code: AADHAAR_PHOTOS_REQUIRED,
    message: AADHAAR_PHOTOS_REQUIRED_MESSAGE,
    missingSides: ["BACK"],
    rejectedSides: ["BACK"],
    missingDocuments: ["AADHAAR"],
    dlPhotos: dlOk,
    aadhaarPhotos: aadhaar,
  });
  assert.equal(new DlPhotosRequiredError("staff", dlOk, aadhaar).message, AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE);
});

test("DlPhotosRequiredError: both missing → DL_PHOTOS_REQUIRED (DL sides on top), message names both", () => {
  const dl = { ok: false, missingSides: ["FRONT" as const, "BACK" as const], rejectedSides: [] };
  const aadhaar = { ok: false, missingSides: ["FRONT" as const], rejectedSides: [] };
  const json = new DlPhotosRequiredError("customer", dl, aadhaar).toJSON();
  assert.equal(json.code, DL_PHOTOS_REQUIRED);
  assert.equal(json.message, KYC_PHOTOS_REQUIRED_MESSAGE);
  assert.deepEqual(json.missingSides, ["FRONT", "BACK"]);
  assert.deepEqual(json.missingDocuments, ["DL", "AADHAAR"]);
  assert.deepEqual(json.aadhaarPhotos, aadhaar);
});
