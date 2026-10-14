/**
 * FASTag readings of a booking, as legs for fastag-usage.ts: the pickup car
 * from Booking.pickupFastagBalance, each mid-rental swap's returning-car and
 * replacement readings (VehicleSwap.oldVehicleFastagBalance /
 * newVehicleFastagBalance), and the balance at the drop.
 */
import Decimal from "decimal.js";
import { prisma, BookingStatus } from "@repo/database/client";
import type { TxClient } from "../payment/paymentSession.service.js";
import { pickedUpAtMarker } from "./km-allowance.service.js";
import type { FastagLeg } from "./fastag-usage.js";

const dec = (v: { toString(): string } | null | undefined): Decimal | null =>
  v == null ? null : new Decimal(v.toString());

/**
 * The booking's FASTag legs, oldest first; the last leg is the car handed back
 * at the drop and ends at `dropBalance` (null before the drop is read).
 * Swaps count as mid-rental by the same rule as getOdometerSegments.
 */
export async function getFastagLegs(
  bookingId: number,
  dropBalance: Decimal | number | null,
  tx?: TxClient,
): Promise<FastagLeg[]> {
  const db = tx ?? prisma;
  const [booking, swaps] = await Promise.all([
    db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        pickupFastagBalance: true,
        items: { take: 1, select: { vehicle: { select: { regNo: true, hasFastag: true } } } },
      },
    }),
    db.vehicleSwap.findMany({
      where: { bookingId },
      orderBy: { swappedAt: "asc" },
      select: {
        publicId: true,
        swappedAt: true,
        bookingStatusAtSwap: true,
        oldVehicleFastagBalance: true,
        newVehicleFastagBalance: true,
        originalVehicle: { select: { regNo: true, hasFastag: true } },
        newVehicle: { select: { regNo: true, hasFastag: true } },
      },
    }),
  ]);

  let pickedUpAt: Date | null | undefined;
  const midRental: typeof swaps = [];
  for (const swap of swaps) {
    if (swap.bookingStatusAtSwap === BookingStatus.PICKED_UP) {
      midRental.push(swap);
    } else if (swap.bookingStatusAtSwap == null) {
      if (pickedUpAt === undefined) pickedUpAt = await pickedUpAtMarker(bookingId, db);
      if (!pickedUpAt || swap.swappedAt >= pickedUpAt) midRental.push(swap);
    }
  }

  const drop = dropBalance == null ? null : new Decimal(dropBalance);
  const pickup = dec(booking.pickupFastagBalance);
  if (midRental.length === 0) {
    const vehicle = booking.items[0]?.vehicle;
    return [{
      regNo: vehicle?.regNo ?? null,
      hasFastag: vehicle?.hasFastag ?? false,
      startBalance: pickup,
      endBalance: drop,
      endedBySwapPublicId: null,
    }];
  }

  const legs: FastagLeg[] = [];
  let start = pickup;
  for (const [i, swap] of midRental.entries()) {
    legs.push({
      regNo: swap.originalVehicle.regNo,
      hasFastag: swap.originalVehicle.hasFastag,
      startBalance: start,
      endBalance: dec(swap.oldVehicleFastagBalance),
      endedBySwapPublicId: swap.publicId,
    });
    start = dec(swap.newVehicleFastagBalance);
    if (i === midRental.length - 1) {
      legs.push({
        regNo: swap.newVehicle.regNo,
        hasFastag: swap.newVehicle.hasFastag,
        startBalance: start,
        endBalance: drop,
        endedBySwapPublicId: null,
      });
    }
  }
  return legs;
}
