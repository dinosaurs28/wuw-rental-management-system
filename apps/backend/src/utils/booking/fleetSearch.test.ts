/**
 * Pure checks of the Fleet tab search: the registration number, or every word
 * in "make model" / the registration number — case-insensitive and partial,
 * spaces and hyphens ignored in the registration number. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLEET_QUERY_MAX, parseFleetQuery, vehicleMatchesFleetQuery } from "./fleetSearch.js";

const swift = { make: "Maruti", model: "Swift Dzire", regNo: "KA-20 MA 1234" };

test("blank or missing q is no search", () => {
  for (const raw of [undefined, null, "", "   ", 5, ["swift"]]) assert.equal(parseFleetQuery(raw), null);
});

test("q is trimmed, spaces collapsed, lower-cased and capped", () => {
  assert.deepEqual(parseFleetQuery("  Swift   DZIRE "), { text: "swift dzire", reg: "SWIFTDZIRE" });
  assert.equal(parseFleetQuery("x".repeat(100))!.text.length, FLEET_QUERY_MAX);
});

test("matches make, model and 'make model', case-insensitive and partial", () => {
  for (const raw of ["maruti", "MAR", "swift", "dzire", "Maruti Swift", "ruti swi", "maruti dzire", "SWIFT ka20"]) {
    assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery(raw)!), true, raw);
  }
  for (const raw of ["innova", "maruti innova", "swift ka19"]) {
    assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery(raw)!), false, raw);
  }
});

test("matches the registration number ignoring spaces, hyphens and case", () => {
  for (const raw of ["KA20MA1234", "ka-20-ma-1234", "ka 20 ma", "ma1234", "1234", "20 MA 12"]) {
    assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery(raw)!), true, raw);
  }
  assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery("KA19")!), false);
  assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery("5678")!), false);
});

test("punctuation-only q matches nothing by registration", () => {
  assert.equal(vehicleMatchesFleetQuery(swift, parseFleetQuery("--")!), false);
});
