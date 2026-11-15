/**
 * A vehicle's rent history for the branch manager (Oct 20 2026): the rentals
 * the car went out on (picked up, out now or returned), newest first, with the
 * notes the Fleet Executive wrote at the pickup and at the drop and any
 * mid-rental swap notes ("It should be viewed … by branch manager when they
 * check for a vehicle's rent history").
 *
 *   GET /api/branchManager/dashboard/vehicle/:vehicleId/rent-history?page=1&limit=20
 *
 * Own branch's vehicles only. A rental the car left mid-way (swapped out) is
 * listed too, with the swap. Staff only: these notes are never sent to customers.
 *
 * Additive (Nov 14 2026): per rental, `pickupPhotos` / `dropPhotos` of THIS car
 * in the order taken (after a mid-rental swap: the old car keeps the pickup
 * photos, the replacement gets its swap photos and the drop photos), and
 * `damages` — this car's damage reports on the rental (drop damage included)
 * with amount, payment status and photos. See rent-history-media.ts.
 */
import { Request, Response } from "express";
import { prisma, BookingStatus, BookingPhotoType } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { EMPTY_OPERATION_NOTES, loadOperationNotes } from "../../services/booking/operation-notes.service.js";
import { isPrivateFile, resolveFileUrl } from "../../utils/file-url.js";
import { photoUrls } from "../../utils/photo-variant.js";
import { bookingPhotoOrderBy } from "../../utils/photo-order.js";
import { ensureDisplayVariants } from "../../services/photo-variant.service.js";
import { billedOnCompletedDrop, dropDamageBilling, dropDamageAmount } from "../../services/damage/drop-damage.service.js";
import {
  damageNoteView,
  damagePaymentStatus,
  vehicleMediaScope,
  type RentHistoryPhoto,
} from "../../services/vehicle-history/rent-history-media.js";

const MAX_LIMIT = 50;

const photoSelect = {
  id: true,
  publicId: true,
  captureLabel: true,
  createdAt: true,
  file: { select: { id: true, key: true, url: true, mime: true, displayKey: true } },
} as const;

export const GetVehicleRentHistory = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: String(req.params.vehicleId ?? "") },
      select: { id: true, publicId: true, make: true, model: true, regNo: true, branchId: true },
    });
    if (!vehicle || vehicle.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found or access denied" });
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20));

    // Own branch's rentals only — a car transferred from another branch must not
    // show that branch's customers
    const where = {
      deletedAt: null,
      branchId,
      status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED] },
      OR: [
        { items: { some: { vehicleId: vehicle.id } } },
        // Swapped out of this car mid-rental
        { vehicleSwaps: { some: { originalVehicleId: vehicle.id, bookingStatusAtSwap: BookingStatus.PICKED_UP } } },
      ],
    };
    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { startAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          publicId: true,
          status: true,
          startAt: true,
          endAt: true,
          returnedAt: true,
          startOdometer: true,
          endOdometer: true,
          totalKmDriven: true,
          customer: { select: { publicId: true, user: { select: { name: true, phone: true } } } },
          items: { select: { vehicleId: true } },
          vehicleSwaps: {
            where: { bookingStatusAtSwap: BookingStatus.PICKED_UP },
            orderBy: { swappedAt: "asc" },
            select: {
              id: true,
              swappedAt: true,
              originalVehicleId: true,
              newVehicleId: true,
              originalVehicle: { select: { regNo: true } },
              newVehicle: { select: { regNo: true } },
            },
          },
        },
      }),
    ]);
    const bookingIds = bookings.map((b) => b.id);
    const [notes, photoRows, damageRows] = await Promise.all([
      loadOperationNotes(bookingIds),
      bookingIds.length === 0
        ? Promise.resolve([])
        : prisma.bookingPhoto.findMany({
            where: {
              bookingId: { in: bookingIds },
              type: { in: [BookingPhotoType.PRE_DELIVERY, BookingPhotoType.SWAP_DELIVERY, BookingPhotoType.POST_RETURN] },
            },
            orderBy: bookingPhotoOrderBy(),
            select: { ...photoSelect, bookingId: true, type: true, swapId: true },
          }),
      bookingIds.length === 0
        ? Promise.resolve([])
        : prisma.damageReport.findMany({
            where: { bookingId: { in: bookingIds }, vehicleId: vehicle.id },
            orderBy: { createdAt: "asc" },
            select: {
              publicId: true,
              bookingId: true,
              severity: true,
              estimatedCost: true,
              finalCost: true,
              notes: true,
              chargeType: true,
              status: true,
              disposition: true,
              chargedAtDrop: true,
              createdAt: true,
              photos: {
                where: { type: BookingPhotoType.DAMAGE },
                orderBy: bookingPhotoOrderBy(),
                select: photoSelect,
              },
            },
          }),
    ]);

    // Which of each rental's photos show this car
    const scopes = new Map(
      bookings.map((b) => [
        b.id,
        vehicleMediaScope({
          vehicleId: vehicle.id,
          itemVehicleIds: b.items.map((i) => i.vehicleId),
          midSwaps: b.vehicleSwaps.map((s) => ({
            id: s.id,
            originalVehicleId: s.originalVehicleId,
            newVehicleId: s.newVehicleId,
            swappedAt: s.swappedAt,
          })),
          returned: b.status === BookingStatus.RETURNED,
        }),
      ]),
    );
    const keptPhotos = photoRows.filter((p) => {
      const scope = scopes.get(p.bookingId);
      if (!scope) return false;
      if (p.type === BookingPhotoType.PRE_DELIVERY) return scope.pickup;
      if (p.type === BookingPhotoType.POST_RETURN) return scope.drop;
      return p.swapId != null && scope.swapIds.includes(p.swapId);
    });

    const [displayKeys, billedOnDrop] = await Promise.all([
      // Thumbnails from the display copies confirmed in the bucket (else the original)
      ensureDisplayVariants(
        [...keptPhotos, ...damageRows.flatMap((d) => d.photos)].map((p) => p.file),
        { budgetMs: 1500 },
      ),
      billedOnCompletedDrop(
        damageRows.filter((d) => dropDamageBilling(d) === "DROP").map((d) => d.publicId),
      ),
    ]);
    const toPhoto = async (p: (typeof keptPhotos)[number] | (typeof damageRows)[number]["photos"][number]): Promise<RentHistoryPhoto> => {
      const urls = isPrivateFile(p.file)
        ? { url: await resolveFileUrl(p.file), displayUrl: "" }
        : photoUrls({ ...p.file, displayKey: displayKeys.get(p.file.id) ?? null });
      return {
        publicId: p.publicId,
        label: p.captureLabel ?? null,
        url: urls.url,
        displayUrl: urls.displayUrl || urls.url,
        takenAt: p.createdAt.toISOString(),
        mime: p.file.mime,
      };
    };

    const media = new Map<number, { pickupPhotos: RentHistoryPhoto[]; dropPhotos: RentHistoryPhoto[] }>();
    for (const b of bookings) {
      const scope = scopes.get(b.id)!;
      const mine = keptPhotos.filter((p) => p.bookingId === b.id);
      // Pickup photos first, then each swap that handed this car over (in time order)
      const handover = [
        ...mine.filter((p) => p.type === BookingPhotoType.PRE_DELIVERY),
        ...scope.swapIds.flatMap((id) => mine.filter((p) => p.type === BookingPhotoType.SWAP_DELIVERY && p.swapId === id)),
      ];
      media.set(b.id, {
        pickupPhotos: await Promise.all(handover.map(toPhoto)),
        dropPhotos: await Promise.all(mine.filter((p) => p.type === BookingPhotoType.POST_RETURN).map(toPhoto)),
      });
    }

    const damages = new Map<number, unknown[]>();
    for (const d of damageRows) {
      const billing = dropDamageBilling(d);
      // A company expense keeps its cost in estimatedCost (finalCost is set to 0 at review)
      const amount = billing === "COMPANY" ? Number(d.estimatedCost) : dropDamageAmount(d).toNumber();
      const list = damages.get(d.bookingId) ?? [];
      list.push({
        publicId: d.publicId,
        // DROP = recorded by staff at the drop; REPORT = a damage report on the rental
        source: billing ? "DROP" : "REPORT",
        severity: d.severity,
        amount,
        estimatedCost: Number(d.estimatedCost),
        chargeType: d.chargeType,
        status: d.status,
        disposition: d.disposition,
        billing,
        paymentStatus: damagePaymentStatus({
          billing,
          status: d.status,
          amount,
          billedOnCompletedDrop: billedOnDrop.has(d.publicId),
        }),
        notes: damageNoteView(d.notes),
        reportedAt: d.createdAt.toISOString(),
        photos: await Promise.all(d.photos.map(toPhoto)),
      });
      damages.set(d.bookingId, list);
    }

    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        vehicle: { publicId: vehicle.publicId, make: vehicle.make, model: vehicle.model, regNo: vehicle.regNo },
        rentals: bookings.map((b) => {
          const swappedOut = b.vehicleSwaps.find((s) => s.originalVehicleId === vehicle.id) ?? null;
          const swappedIn = b.vehicleSwaps.find((s) => s.newVehicleId === vehicle.id) ?? null;
          return {
            bookingPublicId: b.publicId,
            status: b.status,
            customer: {
              publicId: b.customer.publicId,
              name: b.customer.user.name,
              phone: b.customer.user.phone,
            },
            startAt: b.startAt.toISOString(),
            endAt: b.endAt.toISOString(),
            returnedAt: b.returnedAt?.toISOString() ?? null,
            startOdometer: b.startOdometer,
            endOdometer: b.endOdometer,
            totalKmDriven: b.totalKmDriven,
            // This car left the rental at a mid-rental swap (replaced by toRegNo)
            swappedOut: swappedOut ? { at: swappedOut.swappedAt.toISOString(), toRegNo: swappedOut.newVehicle.regNo } : null,
            // This car joined the rental at a mid-rental swap (replacing fromRegNo)
            swappedIn: swappedIn ? { at: swappedIn.swappedAt.toISOString(), fromRegNo: swappedIn.originalVehicle.regNo } : null,
            // Fleet notes: { pickup, drop, swaps }
            operationNotes: notes.get(b.id) ?? EMPTY_OPERATION_NOTES,
            // This car's photos on the rental, in the order taken (empty for older rentals)
            pickupPhotos: media.get(b.id)?.pickupPhotos ?? [],
            dropPhotos: media.get(b.id)?.dropPhotos ?? [],
            // This car's damage on the rental (drop damage and damage reports), oldest first
            damages: damages.get(b.id) ?? [],
          };
        }),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error) {
    console.error("GetVehicleRentHistory Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error fetching rent history" });
  }
};
