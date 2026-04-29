import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";

/**
 * GET /employee/booking/:bookingId/scan
 *
 * Lightweight endpoint called immediately after an employee scans a booking QR code.
 * Returns only the fields needed to decide which UI route to open.
 */
export const ScanBooking = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { publicId: bookingId },
    select: {
      publicId: true,
      status: true,
      branchId: true,
      items: {
        take: 1,
        select: {
          vehicle: { select: { make: true, model: true, regNo: true } },
        },
      },
      customer: {
        select: { user: { select: { name: true } } },
      },
    },
  });

  if (!booking) {
    return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
  }

  const vehicle = booking.items[0]?.vehicle;

  return res.status(StatusCode.OK).json({
    data: {
      publicId:     booking.publicId,
      status:       booking.status,
      customerName: booking.customer.user.name,
      vehicleName:  vehicle ? `${vehicle.make} ${vehicle.model}` : null,
      regNo:        vehicle?.regNo ?? null,
    },
  });
};
