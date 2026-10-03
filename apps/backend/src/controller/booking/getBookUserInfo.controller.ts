import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { customerPaymentSummary } from "../../services/payment/payment-flow.service.js";
import { rentalGstSplitView, rentInclGstView } from "../../services/invoice-totals.service.js";

export const getUserBookings = async (req: Request, res: Response) => {
  try {
    const userPublicId = req.public_Id;
    console.log(`[getUserBookings] userPublicId=${userPublicId}`);

    if (!userPublicId) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized",
      });
    }
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: {
        customerProfile: {
          select: { id: true },
        },
      },
    });

    console.log(`[getUserBookings] customerProfile=${JSON.stringify(user?.customerProfile)}`);

    if (!user?.customerProfile) {
      console.error(`[getUserBookings] NO CUSTOMER PROFILE for userPublicId=${userPublicId}`);
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Customer profile not found",
      });
    }

    const customerId = user.customerProfile.id;

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    if (!Number.isInteger(page) || !Number.isInteger(limit)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Pagination parameters (page, limit) must be valid numbers",
      });
    }
    const skip = (page - 1) * limit;

    const bookings = await prisma.booking.findMany({
      where: {
        customerId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
      include: {
        items: {
          include: {
            vehicle: {
              select: {
                publicId: true,
                make: true,
                model: true,
                images: {
                  where: { isThumbnail: true },
                  include: { file: true },
                  take: 1,
                },
              },
            },
          },
        },
        // Money put on credit at the counter (#11) is still owed, not paid
        creditEntry: { select: { pendingAmount: true } },
      },
    });

    const totalCount = await prisma.booking.count({
      where: {
        customerId,
        deletedAt: null,
      },
    });

    console.log(`[getUserBookings] customerId=${customerId} found ${bookings.length} bookings (totalCount=${totalCount})`);
    bookings.forEach(b => console.log(`  booking publicId=${b.publicId} status=${b.status} paymentStatus=${b.paymentStatus}`));

    const data = bookings.map((booking) => {
      const payment = customerPaymentSummary(booking, booking.creditEntry?.pendingAmount ?? 0);
      return {
      id: booking.id,
      bookingId: booking.publicId,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      startAt: booking.startAt,
      endAt: booking.endAt,
      days: booking.days,
      total: booking.totalFinal,
      // Partial payment: what was paid and what is still due (at pickup / at drop)
      isAdvancePayment: booking.isAdvancePayment,
      advanceAmount: Number(booking.advanceAmount),
      remainingBalance: booking.remainingPaidAt ? 0 : Number(booking.remainingBalance),
      amountPaid: payment.paid,
      paid: payment.paid,
      balanceDue: payment.balanceDue,
      balanceDueAt: payment.balanceDueAt,
      dueAtPickup: payment.dueAtPickup,
      dueAtDrop: payment.dueAtDrop,
      // Part of balanceDue on credit (#11) — the branch collects it against the collateral
      balanceOnCredit: payment.balanceOnCredit,
      couponCode: booking.couponCode,
      totalBase: Number(booking.totalBase),
      totalDiscount: Number(booking.totalDiscount),
      totalTax: Number(booking.totalTax),
      // CGST / SGST of totalTax (null when the booking stored no split or rate)
      ...rentalGstSplitView(booking),
      // The rent GST-inclusive (item 17): rentWithoutGst + totalTax = rentAfterDiscountInclGst
      ...rentInclGstView(booking),
      createdAt: booking.createdAt,
      vehicles: booking.items.map((item) => ({
        publicId: item.vehicle.publicId,
        make: item.vehicle.make,
        model: item.vehicle.model,
        thumbnail: item.vehicle.images[0]?.file.url || null,
        finalTotal: item.finalTotal,
      })),
      };
    });

    return res.status(StatusCode.OK).json({
      message: "Bookings fetched successfully",
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      data,
    });
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal server error while fetching bookings",
    });
  }
};
