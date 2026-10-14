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
import { buildFastagLegs, type FastagLeg } from "./fastag-usage.js";

const dec = (v: { toString(): string } | null | undefined): Decimal | null =>
  v == null ? null : new Decimal(v.toString());

/**
 * The booking's FASTag legs, oldest first; the last leg is the car handed back
 * at the drop and ends at `dropBalance` (null before the drop is read).
 * Swaps count as mid-rental by the same rule as getOdometerSegments. A leg's car
 * counts as a FASTag car when marked so or when a balance was recorded for it
 * at pickup / a swap (countsAsFastagCar).
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

  return buildFastagLegs({
    pickupBalance: dec(booking.pickupFastagBalance),
    currentVehicle: booking.items[0]?.vehicle ?? null,
    midRentalSwaps: midRental.map((swap) => ({
      publicId: swap.publicId,
      originalVehicle: swap.originalVehicle,
      newVehicle: swap.newVehicle,
      oldVehicleFastagBalance: dec(swap.oldVehicleFastagBalance),
      newVehicleFastagBalance: dec(swap.newVehicleFastagBalance),
    })),
    dropBalance: dropBalance == null ? null : new Decimal(dropBalance),
  });
}
