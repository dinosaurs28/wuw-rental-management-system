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
 */
import { Request, Response } from "express";
import { prisma, BookingStatus } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { EMPTY_OPERATION_NOTES, loadOperationNotes } from "../../services/booking/operation-notes.service.js";

const MAX_LIMIT = 50;

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
    const notes = await loadOperationNotes(bookings.map((b) => b.id));

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
