import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, DepositMethod, AuditCategory } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import { calculatePricingForVehicleFromRecord } from "../../utils/pricing/calcPricingInd.js";
import { calculateMultiDayTotalPrice } from "../../utils/pricing/calcMultiDayPrice.js";
import { getDiscountForDays } from "../../utils/pricing/getDiscountForDays.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import { createID } from "../../utils/nanoID.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import { auditService } from "../../services/audit/audit.service.js";

export const BookingController = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const { date } = req.query;

    let dateFilter: any = {};
    let cacheKeySuffix = "";

    if (date) {
      const parsedDateDt = TimezoneService.parseISO(date as string);
      if (parsedDateDt.isValid) {
        const startOfDayDt = TimezoneService.startOfDay(parsedDateDt);
        const endOfDayDt = TimezoneService.endOfDay(parsedDateDt);

        dateFilter = {
          gte: TimezoneService.toPrisma(startOfDayDt),
          lte: TimezoneService.toPrisma(endOfDayDt),
        };
        cacheKeySuffix = `date:${parsedDateDt.toFormat("yyyy-MM-dd")}`;
      }
    }

    // Default behavior: Upcoming bookings from today if no valid date is provided
    if (Object.keys(dateFilter).length === 0) {
      const nowDt = TimezoneService.getCurrentTime();
      const startOfDayDt = TimezoneService.startOfDay(nowDt);

      dateFilter = {
        gte: TimezoneService.toPrisma(startOfDayDt),
      };
      cacheKeySuffix = `upcoming:${nowDt.toFormat("yyyy-MM-dd")}`;
    }

    const cacheKey = `bookings:${branchId}:${cacheKeySuffix}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.status(StatusCode.OK).json({
        message: "Bookings fetched successfully",
        data: JSON.parse(cachedData),
      });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        branchId: branchId,
        startAt: dateFilter,
        status: BookingStatus.CONFIRMED,
      },
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaidDuring: true,
        customer: {
          select: {
            user: {
              select: {
                publicId: true,
                name: true,
                phone: true, // Assuming phone is on User, otherwise check Schema
              },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                status: true,
                images: {
                  where: {
                    isThumbnail: true,
                  },
                  take: 1,
                  select: {
                    file: {
                      select: {
                        url: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        startAt: "asc",
      },
    });

    if (bookings.length === 0) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "No Upcoming Bookings Found",
      });
    }
    await redis.setex(cacheKey, 60, JSON.stringify(bookings));

    return res.status(StatusCode.OK).json({
      message: "Upcoming bookings fetched successfully",
      data: bookings,
    });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error While Fetching Bookings",
    });
  }
};

export const createEmployeeBooking = async (req: Request, res: Response) => {
  try {
    const {
      vehicles,
      customer_public_id,
      customer_kyc_id,
      start,
      end,
      payment_type,
    } = req.body;
    if (
      !Array.isArray(vehicles) ||
      !customer_public_id ||
      !customer_kyc_id ||
      !start ||
      !end ||
      !["CASH", "ONLINE"].includes(payment_type)
    ) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid request payload" });
    }

    const staff = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });

    if (!staff) {
      return res
        .status(StatusCode.FORBIDDEN)
        .json({ message: "Invalid staff user" });
    }

    // Verify Customer
    const customer = await prisma.user.findUnique({
      where: { publicId: customer_public_id },
      include: { customerProfile: true },
    });
    if (!customer || !customer.customerProfile) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Customer not found" });
    }

    const kycRecord = await prisma.customerKyc.findUnique({
      where: { publicId: customer_kyc_id },
      select: { fileId: true },
    });
    if (!kycRecord || !kycRecord.fileId) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid KYC ID or Document missing" });
    }

    const startDateDt = TimezoneService.parseISO(start);
    const endDateDt = TimezoneService.parseISO(end);
    if (!startDateDt.isValid || !endDateDt.isValid)
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid dates" });
    const startDate = TimezoneService.toPrisma(startDateDt);
    const endDate = TimezoneService.toPrisma(endDateDt);
    const vehiclesData = await prisma.vehicle.findMany({
      where: { publicId: { in: vehicles } },
      include: {
        category: true,
        branch: { include: { pricingSetting: true } },
        images: {
          include: { file: true },
          take: 1,
        },
      },
    });

    if (vehiclesData.length !== vehicles.length)
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Some vehicles not found" });

    // GST Rule Fetching
    const branchId = vehiclesData[0]?.branchId;
    let cgstRate = 0;
    let sgstRate = 0;

    if (branchId) {
      const gstRule = await prisma.gSTRule.findUnique({
        where: { branchId },
      });
      if (gstRule) {
        cgstRate = Number(gstRule.cgstRate);
        sgstRate = Number(gstRule.sgstRate);
      }
    }
    const totalTaxRate = cgstRate + sgstRate;

    const items: any[] = [];
    let grandBaseTotal = 0;
    let grandDiscountTotal = 0;
    let grandTaxTotal = 0;
    let grandCGSTTotal = 0;
    let grandSGSTTotal = 0;
    let grandDeposit = 0;
    let grandFinalTotal = 0;

    for (const v of vehiclesData) {
      const availability = await checkVehicleAvailability(
        v.id,
        startDate,
        endDate,
      );
      if (!availability)
        return res
          .status(StatusCode.CONFLICT)
          .json({ message: `Vehicle ${v.make} ${v.model} unavailable` });

      const pricing = await calculatePricingForVehicleFromRecord(v);
      const multi = calculateMultiDayTotalPrice(
        startDate,
        endDate,
        pricing.daily,
      );
      const days = multi.days;
      const discountPercent =
        (await getDiscountForDays(v.branchId, v.categoryId, days)) || 0;
      const baseTotal = multi.total;
      const discountedTotal = Number(
        (baseTotal * (1 - discountPercent)).toFixed(2),
      );
      const discountAmount = Number((baseTotal - discountedTotal).toFixed(2));
      const deposit = (await getDepositAmount(v.branchId, v.categoryId)) || 0;

      // Calculate Tax
      const taxAmount = Number(
        (discountedTotal * (totalTaxRate / 100)).toFixed(2),
      );
      const cgstAmount = Number(
        (discountedTotal * (cgstRate / 100)).toFixed(2),
      );
      const sgstAmount = Number(
        (discountedTotal * (sgstRate / 100)).toFixed(2),
      );

      const finalTotal = Number(
        (discountedTotal + taxAmount + deposit).toFixed(2),
      );

      items.push({
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        category: v.category?.name,
        image: v.images[0]?.file?.url,
        regNo: v.regNo,
        payment_type,
        days,
        baseTotal,
        discountAmount,
        discountPercent,
        deposit,
        taxAmount,
        cgstAmount,
        sgstAmount,
        taxRate: totalTaxRate,
        finalTotal,
      });

      grandBaseTotal += baseTotal;
      grandDiscountTotal += discountAmount;
      grandTaxTotal += taxAmount;
      grandCGSTTotal += cgstAmount;
      grandSGSTTotal += sgstAmount;
      grandDeposit += deposit;
      grandFinalTotal += finalTotal;
    }

    grandBaseTotal = Number(grandBaseTotal.toFixed(2));
    grandDiscountTotal = Number(grandDiscountTotal.toFixed(2));
    grandTaxTotal = Number(grandTaxTotal.toFixed(2));
    grandCGSTTotal = Number(grandCGSTTotal.toFixed(2));
    grandSGSTTotal = Number(grandSGSTTotal.toFixed(2));
    grandDeposit = Number(grandDeposit.toFixed(2));
    grandFinalTotal = Number(grandFinalTotal.toFixed(2));

    let transactionId = null;
    let paymentURL = null;

    if (payment_type === "ONLINE") {
      const frontendUrl = process.env.REDIRECT_URL_PAY;
      const employeeRedirectBase = `${frontendUrl}/employee/booking/status`;

      try {
        const paymentDetails = await initiatePhonePePayment(
          grandFinalTotal,
          employeeRedirectBase,
        );
        if (!paymentDetails || !paymentDetails.merchantTransactionId) {
          throw new Error("Invalid payment details received from gateway");
        }
        transactionId = paymentDetails.merchantTransactionId;
        paymentURL = paymentDetails.instrumentResponse.redirectInfo.url;
      } catch (error: any) {
        console.error("Error initiating employee booking payment:", error);
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          message: error.message || "Failed to initiate payment gateway",
        });
      }
    } else {
      transactionId = `CASH_${createID()}`;
    }

    // Freeze branch charge config snapshot for this booking (immutable after creation)
    const frozenChargeConfig = await chargeConfigService.freezeChargeConfig(
      vehiclesData[0]!.branchId,
    );

    const booking = await prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          publicId: createID(),
          customerId: customer.customerProfile!.id,
          kycFileId: kycRecord.fileId!,
          branchId: vehiclesData[0]!.branchId,
          startAt: startDate,
          endAt: endDate,
          days: items[0]!.days,
          status: BookingStatus.HOLD,
          paymentStatus: "CREATED",
          depositMethod:
            payment_type === "CASH"
              ? DepositMethod.CASH
              : DepositMethod.ONLINE_RAZORPAY,
          totalBase: grandBaseTotal,
          totalDiscount: grandDiscountTotal,
          totalDeposit: grandDeposit,
          totalTax: grandTaxTotal,
          totalFinal: grandFinalTotal,
          transactionId,
          frozenChargeConfig: frozenChargeConfig as any,
          pricingSnapshot: {
            items,
            totals: {
              grandBaseTotal,
              grandDiscountTotal,
              grandDeposit,
              grandTaxTotal,
              grandCGSTTotal,
              grandSGSTTotal,
              taxRate: totalTaxRate,
              grandFinalTotal,
            },
          },
          createdById: staff.id,
        },
      });

      await tx.bookingItem.createMany({
        data: items.map((i) => ({
          bookingId: newBooking.id,
          vehicleId: i.vehicleId,
          days: i.days,
          baseTotal: i.baseTotal,
          discountAmount: i.discountAmount,
          discountPercent: i.discountPercent,
          deposit: i.deposit,
          taxAmount: i.taxAmount,
          cgstAmount: i.cgstAmount,
          sgstAmount: i.sgstAmount,
          taxRate: i.taxRate,
          finalTotal: i.finalTotal,
        })),
      });

      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.CREATED,
        entityType: StaffEntityType.BOOKING,
        entityRef: newBooking.publicId,
        description: `Booking ${newBooking.publicId} created`,
      }, tx);

      await auditService.log({
        actorId: staff.id,
        actorName: staff.name,
        actorRole: staff.role,
        actorBranchId: staff.branchId ?? undefined,
        action: "BOOKING_CREATED",
        category: AuditCategory.BOOKING,
        description: `Booking created for customer ${customer.name} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
        entity: "Booking",
        entityId: newBooking.publicId,
        entityLabel: newBooking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        after: { status: newBooking.status, totalFinal: grandFinalTotal, vehicles },
      }, tx);

      return newBooking;
    });

    const snapshot = booking.pricingSnapshot as any;

    // Invalidate public vehicle cache
    let cursor = "0";
    do {
      const reply = await redis.scan(
        cursor,
        "MATCH",
        "public:vehicles:*",
        "COUNT",
        100,
      );
      cursor = reply[0];
      const keys = reply[1];
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } while (cursor !== "0");

    return res.status(StatusCode.OK).json({
      message: "Booking Created Successfully",
      data: {
        bookingId: booking.publicId,
        paymentURL,
        status: booking.status,
        startDate: booking.startAt,
        endDate: booking.endAt,
        transactionId: booking.transactionId,
        totals: snapshot?.totals,
        items: snapshot?.items,
      },
    });
  } catch (error) {
    console.error("Create Employee Booking Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Error" });
  }
};

export const GetBookingDetails = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: {
        publicId: true,
        startAt: true,
        endAt: true,
        status: true,
        totalFinal: true,
        requiresManagerConfirmation: true,
        isAdvancePayment: true,
        advanceAmount: true,
        advancePaidAt: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaymentMode: true,
        remainingPaidDuring: true,
        customer: {
          select: {
            user: {
              select: {
                publicId: true,
                name: true,
                phone: true, // Assuming phone is on User, otherwise check Schema
              },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                status: true,
                odo: true,
                images: {
                  where: {
                    isThumbnail: true,
                  },
                  take: 1,
                  select: {
                    file: {
                      select: {
                        url: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    return res.status(StatusCode.OK).json({
      message: "Booking details fetched successfully",
      data: booking,
    });
  } catch (error) {
    console.error("Error fetching booking details:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({
        message: "Internal Server Error While Fetching Booking Details",
      });
  }
};

export const DebugBookings = async (req: Request, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "PICKED_UP", "HOLD"] },
    },
    include: {
      items: {
        include: {
          vehicle: true,
        },
      },
    },
  });

  const start = TimezoneService.toPrisma(
    TimezoneService.parseISO("2026-02-14"),
  );
  const end = TimezoneService.toPrisma(
    TimezoneService.endOfDay(TimezoneService.parseISO("2026-02-15")),
  );

  const result = bookings.map((b) => ({
    id: b.publicId,
    start: b.startAt,
    end: b.endAt,
    status: b.status,
    vehicles: b.items.map(
      (i) => `${i.vehicle.make} ${i.vehicle.model} (${i.vehicle.publicId})`,
    ),
    overlapCheck: {
      startLteSearchEnd: b.startAt <= end,
      endGteSearchStart: b.endAt >= start,
      overlaps: b.startAt <= end && b.endAt >= start,
    },
  }));

  return res.json({
    searchRange: { start, end },
    bookings: result,
  });
};
