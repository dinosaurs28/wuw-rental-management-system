import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conflictWhere,
  dlInUseCustomerMessage,
  duplicateTypeClass,
  findDlConflict,
  sharedTypeClass,
  typeClassNoun,
  DlInUseError,
  type DlCheckInput,
} from "./dl-in-use.service.js";

// Client TODO 5 (Nov 1 2026): one car + one scooter per driving licence.
type Cls = "FOUR_WHEELER" | "TWO_WHEELER" | "OTHER";
const CAR: Cls = "FOUR_WHEELER";
const SCOOTER: Cls = "TWO_WHEELER";
const OTHER: Cls = "OTHER";
const DL = "KA0120200001234";
const H = 3600000;
const NOW = new Date("2026-11-05T04:30:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * H);

interface Row {
  id: number;
  publicId: string;
  status: "HOLD" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED";
  startAt: Date;
  endAt: Date;
  holdExpiresAt?: Date | null;
  dl: string;
  classes: Cls[];
}

// ── A tiny evaluator for the Prisma filter conflictWhere builds ──────────────
function matchCond(r: Row, c: any): boolean {
  if (c.status !== undefined && r.status !== c.status) return false;
  if (c.startAt?.lt && !(r.startAt < c.startAt.lt)) return false;
  if (c.endAt?.gt && !(r.endAt > c.endAt.gt)) return false;
  if (c.holdExpiresAt?.gt && !(r.holdExpiresAt && r.holdExpiresAt > c.holdExpiresAt.gt)) return false;
  return true;
}
function matches(r: Row, w: any): boolean {
  if (w.customer?.drivingLicenceNumber !== r.dl) return false;
  if (w.id?.not !== undefined && r.id === w.id.not) return false;
  const inClasses: Cls[] | undefined = w.items?.some?.vehicle?.category?.typeClass?.in;
  if (inClasses && !r.classes.some((c) => inClasses.includes(c))) return false;
  return (w.OR as any[]).some((c) => matchCond(r, c));
}
function fakeDb(rows: Row[]) {
  return {
    customer: { findUnique: async () => ({ drivingLicenceNumber: DL }) },
    bookingItem: {
      findMany: async ({ where }: any) =>
        (rows.find((r) => r.id === where.bookingId)?.classes ?? []).map((c) => ({
          vehicle: { category: { typeClass: c } },
        })),
    },
    vehicle: { findMany: async () => [] },
    vehicleCategory: { findMany: async () => [] },
    booking: {
      findMany: async ({ where }: any) =>
        rows
          .filter((r) => matches(r, where))
          .map((r) => ({
            publicId: r.publicId,
            status: r.status,
            startAt: r.startAt,
            endAt: r.endAt,
            customer: { user: { name: "Asha" } },
            items: r.classes.map((c, i) => ({
              vehicle: { make: c === CAR ? "Maruti" : "Honda", model: `M${i}`, regNo: `KA01${i}`, category: { typeClass: c } },
            })),
          })),
    },
  } as any;
}

let nextId = 1;
const row = (status: Row["status"], classes: Cls[], startH: number, endH: number, extra: Partial<Row> = {}): Row => ({
  id: nextId++,
  publicId: `bk${nextId}`,
  status,
  startAt: at(startH),
  endAt: at(endH),
  holdExpiresAt: status === "HOLD" ? at(1) : null,
  dl: DL,
  classes,
  ...extra,
});

const create = (classes: Cls[] | undefined, startH = 24, endH = 48): DlCheckInput => ({
  dlNumber: DL,
  mode: "create",
  window: { startAt: at(startH), endAt: at(endH) },
  typeClasses: classes as any,
  now: NOW,
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
test("nouns: car / scooter / other", () => {
  assert.equal(typeClassNoun(CAR as any), "car");
  assert.equal(typeClassNoun(SCOOTER as any), "scooter");
  assert.equal(typeClassNoun(OTHER as any), "vehicle of this type");
});

test("sharedTypeClass: the table", () => {
  assert.equal(sharedTypeClass([SCOOTER] as any, [CAR] as any), null, "car out, scooter booked → allow");
  assert.equal(sharedTypeClass([CAR] as any, [SCOOTER] as any), null, "scooter out, car booked → allow");
  assert.equal(sharedTypeClass([CAR] as any, [CAR] as any), CAR, "car + car → block");
  assert.equal(sharedTypeClass([SCOOTER] as any, [SCOOTER] as any), SCOOTER, "scooter + scooter → block");
  assert.equal(sharedTypeClass([OTHER] as any, [OTHER] as any), OTHER, "other + other → block");
  assert.equal(sharedTypeClass([OTHER] as any, [CAR, SCOOTER] as any), null, "other never blocks car/scooter");
  assert.equal(sharedTypeClass([CAR] as any, [OTHER] as any), null);
  assert.equal(sharedTypeClass(null, [SCOOTER] as any), SCOOTER, "no class known → every class blocks");
  assert.equal(sharedTypeClass([SCOOTER] as any, [CAR, SCOOTER] as any), SCOOTER, "car+scooter booking blocks a scooter");
});

test("duplicateTypeClass: two of a class in one booking", () => {
  assert.equal(duplicateTypeClass([CAR, SCOOTER] as any), null);
  assert.equal(duplicateTypeClass([CAR, CAR] as any), CAR);
  assert.equal(duplicateTypeClass([SCOOTER, CAR, SCOOTER] as any), SCOOTER);
  assert.equal(duplicateTypeClass([OTHER, OTHER] as any), OTHER);
  assert.equal(duplicateTypeClass([]), null);
});

test("conflictWhere filters on the requested classes only when known", () => {
  const w = conflictWhere(DL, create([CAR, CAR]), NOW, [CAR, CAR] as any) as any;
  assert.deepEqual(w.items.some.vehicle.category.typeClass.in, [CAR]);
  const legacy = conflictWhere(DL, create(undefined), NOW, null) as any;
  assert.equal(legacy.items, undefined);
});

test("customer messages", () => {
  assert.equal(dlInUseCustomerMessage("OVERLAP", "create", CAR as any), "This licence already has a car on rent for these dates.");
  assert.equal(dlInUseCustomerMessage("OVERLAP", "extend", SCOOTER as any), "This licence already has a scooter on rent for these dates.");
  assert.equal(dlInUseCustomerMessage("VEHICLE_OUT", "reschedule", CAR as any), "This licence already has a car on rent for these dates.");
  assert.match(dlInUseCustomerMessage("VEHICLE_OUT", "create", SCOOTER as any), /already has a scooter on rent that hasn't been returned/);
  assert.match(dlInUseCustomerMessage("SAME_BOOKING", "create", CAR as any), /only one car/);
});

// ── findDlConflict end to end (fake DB) ──────────────────────────────────────
test("the table — existing car / scooter out, new car / scooter", async () => {
  const carOut = row("PICKED_UP", [CAR], -24, 30);
  const scooterOut = row("PICKED_UP", [SCOOTER], -24, 30);
  assert.equal(await findDlConflict(create([SCOOTER]), fakeDb([carOut])), null, "car + scooter → allow");
  assert.equal(await findDlConflict(create([CAR]), fakeDb([scooterOut])), null, "scooter + car → allow");
  const cc = await findDlConflict(create([CAR]), fakeDb([carOut]));
  assert.ok(cc instanceof DlInUseError, "car + car → block");
  assert.equal(cc!.kind, "VEHICLE_OUT");
  assert.equal(cc!.typeClass, CAR);
  assert.equal(cc!.status, 409);
  assert.equal(cc!.code, "DL_IN_USE");
  const ss = await findDlConflict(create([SCOOTER]), fakeDb([scooterOut]));
  assert.ok(ss, "scooter + scooter → block");
  assert.equal(ss!.typeClass, SCOOTER);
  assert.equal(ss!.toJSON("customer").message, ss!.customerMessage());
  assert.equal((ss!.toJSON("customer") as any).conflictingBooking, undefined);
  assert.match(ss!.message, /scooter on rent/);
});

test("CONFIRMED and live HOLD block the same class, expired HOLD / cancelled don't", async () => {
  const confirmedCar = row("CONFIRMED", [CAR], 30, 60);
  assert.equal((await findDlConflict(create([CAR]), fakeDb([confirmedCar])))?.kind, "OVERLAP");
  assert.equal(await findDlConflict(create([SCOOTER]), fakeDb([confirmedCar])), null);
  const liveHold = row("HOLD", [SCOOTER], 30, 60);
  assert.equal((await findDlConflict(create([SCOOTER]), fakeDb([liveHold])))?.kind, "OVERLAP");
  const deadHold = row("HOLD", [SCOOTER], 30, 60, { holdExpiresAt: at(-1) });
  assert.equal(await findDlConflict(create([SCOOTER]), fakeDb([deadHold])), null);
  const cancelled = row("CANCELLED", [CAR], 30, 60);
  const returned = row("RETURNED", [CAR], 30, 60);
  assert.equal(await findDlConflict(create([CAR]), fakeDb([cancelled, returned])), null);
});

test("OTHER is its own class", async () => {
  const otherOut = row("CONFIRMED", [OTHER], 30, 60);
  assert.ok(await findDlConflict(create([OTHER]), fakeDb([otherOut])));
  assert.equal(await findDlConflict(create([CAR]), fakeDb([otherOut])), null);
  assert.equal(await findDlConflict(create([SCOOTER]), fakeDb([otherOut])), null);
});

test("overlap edges: touching / non-overlapping windows pass, an out vehicle blocks any create", async () => {
  const confirmedCar = row("CONFIRMED", [CAR], 0, 24);
  assert.equal(await findDlConflict(create([CAR], 24, 48), fakeDb([confirmedCar])), null, "back to back");
  assert.equal(await findDlConflict(create([CAR], 72, 96), fakeDb([confirmedCar])), null, "later dates");
  assert.ok(await findDlConflict(create([CAR], 23, 48), fakeDb([confirmedCar])), "one hour overlap");
  const carOutDueSoon = row("PICKED_UP", [CAR], -24, 2);
  assert.ok(await findDlConflict(create([CAR], 72, 96), fakeDb([carOutDueSoon])), "out car blocks a later car (create)");
  assert.equal(await findDlConflict(create([SCOOTER], 72, 96), fakeDb([carOutDueSoon])), null);
});

test("multi-vehicle: two of a class in one booking is refused, car + scooter allowed", async () => {
  const two = await findDlConflict(create([CAR, CAR]), fakeDb([]));
  assert.equal(two?.kind, "SAME_BOOKING");
  assert.equal(two?.conflictingBooking, null);
  assert.equal((two!.toJSON("staff") as any).conflictingBooking, undefined);
  assert.equal(await findDlConflict(create([CAR, SCOOTER]), fakeDb([])), null);
  // car + scooter booking vs an existing scooter → blocked on the scooter
  const scooterOut = row("PICKED_UP", [SCOOTER], -24, 30);
  const c = await findDlConflict(create([CAR, SCOOTER]), fakeDb([scooterOut]));
  assert.equal(c?.typeClass, SCOOTER);
  // an existing car + scooter booking blocks a car, names its car
  const both = row("CONFIRMED", [SCOOTER, CAR], 30, 60);
  const c2 = await findDlConflict(create([CAR]), fakeDb([both]));
  assert.equal(c2?.typeClass, CAR);
  assert.equal(c2?.conflictingBooking?.vehicle?.make, "Maruti");
});

test("extend / reschedule use their own booking's class and skip themselves", async () => {
  const myCar = row("PICKED_UP", [CAR], -24, 24);
  const otherCar = row("CONFIRMED", [CAR], 30, 60);
  const otherScooter = row("CONFIRMED", [SCOOTER], 30, 60);
  const ext = (rows: Row[], endH: number, mode: "extend" | "reschedule" = "extend") =>
    findDlConflict(
      { dlNumber: DL, mode, window: { startAt: at(24), endAt: at(endH) }, excludeBookingId: myCar.id, now: NOW },
      fakeDb([myCar, ...rows]),
    );
  assert.equal(await ext([otherCar], 28), null, "extension short of the other car");
  assert.equal((await ext([otherCar], 36))?.kind, "OVERLAP", "extension into the other car");
  assert.equal(await ext([otherScooter], 36), null, "extension into a scooter booking");
  assert.equal((await ext([otherCar], 36, "reschedule"))?.kind, "OVERLAP");
  assert.equal(await ext([otherScooter], 36, "reschedule"), null);
});

test("an overdue out vehicle of the same class blocks an extension that starts now", async () => {
  const mine = row("CONFIRMED", [SCOOTER], -10, -2);
  const overdueScooter = row("PICKED_UP", [SCOOTER], -48, -24);
  const overdueCar = row("PICKED_UP", [CAR], -48, -24);
  const input: DlCheckInput = {
    dlNumber: DL,
    mode: "extend",
    window: { startAt: at(-2), endAt: at(10) },
    excludeBookingId: mine.id,
    now: NOW,
  };
  assert.equal((await findDlConflict(input, fakeDb([mine, overdueScooter])))?.kind, "VEHICLE_OUT");
  assert.equal(await findDlConflict(input, fakeDb([mine, overdueCar])), null);
});

test("no class known (legacy caller) keeps the old any-vehicle rule; no DL skips", async () => {
  const scooterOut = row("PICKED_UP", [SCOOTER], -24, 30);
  assert.ok(await findDlConflict(create(undefined), fakeDb([scooterOut])));
  assert.ok(await findDlConflict(create([] as any), fakeDb([scooterOut])), "empty list = omitted");
  assert.equal(await findDlConflict({ ...create([CAR]), dlNumber: "  " }, fakeDb([row("PICKED_UP", [CAR], -1, 1)])), null);
});
