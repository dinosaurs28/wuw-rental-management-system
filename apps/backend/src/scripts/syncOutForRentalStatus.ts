/**
 * One-off data fix (Oct 2026): every vehicle out on a rental shows OUT_FOR_RENTAL.
 *
 * Pickup sets the vehicle OUT_FOR_RENTAL and the drop sets it back. Older code
 * could still move a car that was out: the vehicle form saved AVAILABLE /
 * MAINTENANCE / INACTIVE over it, and booking confirmation wrote AVAILABLE to
 * the booking's car even while that car was out on another rental. Those cars
 * are listed as free and the branch manager's vehicle edit refuses to move
 * them (VEHICLE_ON_RENTAL), so this puts them back on OUT_FOR_RENTAL.
 *
 * Touches non-deleted vehicles held by a PICKED_UP booking whose status is not
 * OUT_FOR_RENTAL. MANAGER_REPORTED cars are listed but left as they are — a
 * manager review is pending on them. Idempotent; listing caches expire on their
 * own (30–120 s). Run once per environment after deploying:
 *
 *   DATABASE_URL=… npx tsx src/scripts/syncOutForRentalStatus.ts           # dry run: list only
 *   DATABASE_URL=… npx tsx src/scripts/syncOutForRentalStatus.ts --apply   # set OUT_FOR_RENTAL
 */
import { prisma, BookingStatus, VehicleStatus } from "@repo/database/client";

const apply = process.argv.includes("--apply");

async function main() {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      deletedAt: null,
      status: { not: VehicleStatus.OUT_FOR_RENTAL },
      bookingItems: { some: { booking: { status: BookingStatus.PICKED_UP } } },
    },
    select: {
      id: true,
      regNo: true,
      status: true,
      branch: { select: { name: true } },
      bookingItems: {
        where: { booking: { status: BookingStatus.PICKED_UP } },
        select: { booking: { select: { publicId: true, requiresManagerConfirmation: true } } },
      },
    },
    orderBy: { regNo: "asc" },
  });
  console.log(`Vehicles out on a rental but not OUT_FOR_RENTAL: ${vehicles.length}`);

  const toFix: number[] = [];
  for (const v of vehicles) {
    const bookings = v.bookingItems
      .map((i) => `${i.booking.publicId}${i.booking.requiresManagerConfirmation ? " (return awaiting manager)" : ""}`)
      .join(", ");
    const skip = v.status === VehicleStatus.MANAGER_REPORTED;
    console.log(
      `  ${v.regNo}  ${v.branch.name}  ${v.status}  booking ${bookings}` +
        (skip ? "  — MANAGER_REPORTED, left as it is" : ""),
    );
    if (!skip) toFix.push(v.id);
  }

  if (!apply) {
    console.log(`Dry run — pass --apply to set ${toFix.length} vehicle(s) to OUT_FOR_RENTAL.`);
    return;
  }
  const { count } = await prisma.vehicle.updateMany({
    // Re-checked at write time: a drop between the read and here leaves that car alone
    where: {
      id: { in: toFix },
      status: { notIn: [VehicleStatus.OUT_FOR_RENTAL, VehicleStatus.MANAGER_REPORTED] },
      bookingItems: { some: { booking: { status: BookingStatus.PICKED_UP } } },
    },
    data: { status: VehicleStatus.OUT_FOR_RENTAL },
  });
  console.log(`Set ${count} vehicle(s) to OUT_FOR_RENTAL.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
