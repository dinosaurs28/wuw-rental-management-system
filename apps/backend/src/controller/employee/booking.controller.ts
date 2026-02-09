import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, DepositMethod } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { checkVehicleAvailability } from "../../utils/availability/checkAvailability.js";
import { calculatePricingForVehicleFromRecord } from "../../utils/pricing/calcPricingInd.js";
import { calculateMultiDayTotalPrice } from "../../utils/pricing/calcMultiDayPrice.js";
import { getDiscountForDays } from "../../utils/pricing/getDiscountForDays.js";
import { getDepositAmount } from "../../utils/pricing/getDepositAmount.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import { createID } from "../../utils/nanoID.js";

export const BookingController = async (req: Request, res: Response) => {
    try {
        const branchId = req.branch_Id;
        const { date } = req.query;

        let dateFilter: any = {};
        let cacheKeySuffix = "";

        if (date) {
            const parsedDate = new Date(date as string);
            if (!isNaN(parsedDate.getTime())) {
                const startOfDay = new Date(parsedDate);
                startOfDay.setHours(0, 0, 0, 0);

                const endOfDay = new Date(parsedDate);
                endOfDay.setHours(23, 59, 59, 999);

                dateFilter = {
                    gte: startOfDay,
                    lte: endOfDay
                };
                cacheKeySuffix = `date:${startOfDay.toISOString().split('T')[0]}`;
            }
        }

        // Default behavior: Upcoming bookings from today if no valid date is provided
        if (Object.keys(dateFilter).length === 0) {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            dateFilter = {
                gte: now
            };
            cacheKeySuffix = `upcoming:${now.toISOString().split('T')[0]}`;
        }

        const cacheKey = `bookings:${branchId}:${cacheKeySuffix}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Bookings fetched successfully",
                data: JSON.parse(cachedData)
            });
        }

        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId,
                startAt: dateFilter,
                status: BookingStatus.CONFIRMED
            },
            select: {
                publicId: true,
                startAt: true,
                endAt: true,
                status: true,
                totalFinal: true,
                customer: {
                    select: {
                        user: {
                            select: {
                                publicId: true,
                                name: true,
                                phone: true // Assuming phone is on User, otherwise check Schema
                            }
                        }
                    }
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
                                        isThumbnail: true
                                    },
                                    take: 1,
                                    select: {
                                        file: {
                                            select: {
                                                url: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                startAt: 'asc'
            }
        });

        if (bookings.length === 0) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "No Upcoming Bookings Found"
            })
        }
        await redis.setex(cacheKey, 60, JSON.stringify(bookings));

        return res.status(StatusCode.OK).json({
            message: "Upcoming bookings fetched successfully",
            data: bookings
        });

    } catch (error) {
        console.error("Error fetching bookings:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error While Fetching Bookings"
        });
    }
}

export const createEmployeeBooking = async (req: Request, res: Response) => {
    try {
        const { vehicles, customer_public_id, customer_kyc_id, start, end, payment_type } = req.body;
        if (!Array.isArray(vehicles) || !customer_public_id || !customer_kyc_id || !start || !end || !['CASH', 'ONLINE'].includes(payment_type)) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid request payload" });
        }

        const staff = await prisma.user.findUnique({
            where: { publicId: req.public_Id },
            select: { id: true }
        });

        if (!staff) {
            return res.status(StatusCode.FORBIDDEN).json({ message: "Invalid staff user" });
        }

        // Verify Customer
        const customer = await prisma.user.findUnique({
            where: { publicId: customer_public_id },
            include: { customerProfile: true }
        });
        if (!customer || !customer.customerProfile) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Customer not found" });
        }

        const kycRecord = await prisma.customerKyc.findUnique({
            where: { publicId: customer_kyc_id },
            select: { fileId: true }
        });
        if (!kycRecord || !kycRecord.fileId) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid KYC ID or Document missing" });
        }

        const startDate = new Date(start);
        const endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid dates" });
        const vehiclesData = await prisma.vehicle.findMany({
            where: { publicId: { in: vehicles } },
            include: {
                category: true,
                branch: { include: { pricingSetting: true } },
                pricingOverride: true
            }
        });

        if (vehiclesData.length !== vehicles.length) return res.status(StatusCode.NOT_FOUND).json({ message: "Some vehicles not found" });

        const items: any[] = [];
        let grandBaseTotal = 0;
        let grandDiscountTotal = 0;
        let grandDeposit = 0;
        let grandFinalTotal = 0;

        for (const v of vehiclesData) {
            const availability = await checkVehicleAvailability(v.id, startDate, endDate);
            if (!availability) return res.status(StatusCode.CONFLICT).json({ message: `Vehicle ${v.make} ${v.model} unavailable` });

            const pricing = await calculatePricingForVehicleFromRecord(v);
            const multi = calculateMultiDayTotalPrice(startDate, endDate, pricing.daily);
            const days = multi.days;
            const discountPercent = (await getDiscountForDays(v.branchId, v.categoryId, days)) || 0;
            const baseTotal = multi.total;
            const discountedTotal = Number((baseTotal * (1 - discountPercent)).toFixed(2));
            const discountAmount = Number((baseTotal - discountedTotal).toFixed(2));
            const deposit = (await getDepositAmount(v.branchId, v.categoryId)) || 0;
            const finalTotal = Number((discountedTotal + deposit).toFixed(2));

            items.push({
                vehicleId: v.id,
                days,
                baseTotal,
                discountAmount,
                discountPercent,
                deposit,
                finalTotal
            });

            grandBaseTotal += baseTotal;
            grandDiscountTotal += discountAmount;
            grandDeposit += deposit;
            grandFinalTotal += finalTotal;
        }

        let transactionId = null;
        let paymentURL = null;

        if (payment_type === "ONLINE") {
            // Construct Employee Specific Redirect URL
            // Default assumes: .../booking/status
            // We want: .../employee/booking/status
            const defaultRedirectBase = process.env.REDIRECT_URL_PAY;
            let employeeRedirectBase = defaultRedirectBase;

            if (defaultRedirectBase && defaultRedirectBase.includes('/booking/status')) {
                employeeRedirectBase = defaultRedirectBase.replace('/booking/status', '/employee/booking/status');
            } else if (defaultRedirectBase) {
                // Fallback if structure is different, just append /employee if it was root, but safer to assume standard structure or log warning
                // If default is just domain, this logic might be fragile. 
                // Let's assume standard ENV structure: https://app.com/booking/status
                // If we can't safely replace, use default (Employee will get redirected to customer login, but better than broken link)
                // Or better, just hardcode the path structure if we know the domain.
                // Ideally, we should have a separate ENV, but replacing segment is good enough for now.
            }

            const paymentDetails = await initiatePhonePePayment(grandFinalTotal, employeeRedirectBase);
            transactionId = paymentDetails.merchantTransactionId;
            paymentURL = paymentDetails.instrumentResponse.redirectInfo.url;
        } else {
            transactionId = `CASH_${createID()}`;
        }

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
                    status: BookingStatus.CONFIRMED,
                    paymentStatus: payment_type === "CASH" ? "SUCCESS" : "CREATED",
                    depositMethod: payment_type === "CASH" ? DepositMethod.CASH : DepositMethod.ONLINE_RAZORPAY,
                    totalBase: grandBaseTotal,
                    totalDiscount: grandDiscountTotal,
                    totalDeposit: grandDeposit,
                    totalFinal: grandFinalTotal,
                    transactionId,
                    pricingSnapshot: { items, totals: { grandBaseTotal, grandFinalTotal } },
                    createdById: staff.id
                }
            });

            await tx.bookingItem.createMany({
                data: items.map(i => ({ ...i, bookingId: newBooking.id }))
            });

            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: staff.id,
                    action: "CREATED_BOOKING",
                    entity: "BOOKING",
                    entityId: newBooking.publicId
                }
            });

            return newBooking;
        });

        return res.status(StatusCode.OK).json({
            message: "Booking Created Successfully",
            data: {
                bookingId: booking.publicId,
                paymentURL,
                status: booking.status
            }
        });

    } catch (error) {
        console.error("Create Employee Booking Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Error" });
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
                customer: {
                    select: {
                        user: {
                            select: {
                                publicId: true,
                                name: true,
                                phone: true // Assuming phone is on User, otherwise check Schema
                            }
                        }
                    }
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
                                        isThumbnail: true
                                    },
                                    take: 1,
                                    select: {
                                        file: {
                                            select: {
                                                url: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
        }

        return res.status(StatusCode.OK).json({
            message: "Booking details fetched successfully",
            data: booking
        });
    } catch (error) {
        console.error("Error fetching booking details:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error While Fetching Booking Details" });
    }
}