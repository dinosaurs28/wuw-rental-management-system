import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, DamageReportStatus, VehicleStatus, PaymentStatus, InvoiceStatus, DepositMethod, VehicleReturnDisposition } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID";
import { closeDamageReportSchema } from "@repo/schemas";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils";

export const GetDamageReports = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { date } = req.query;

    let dateFilter: any = {};
    let dateKey: string | undefined = 'all';

    if (date) {
        const targetDate = new Date(date as string);
        if (!isNaN(targetDate.getTime())) {
            const startOfDay = new Date(targetDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(targetDate);
            endOfDay.setHours(23, 59, 59, 999);

            dateFilter = {
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            };
            dateKey = targetDate.toISOString().split('T')[0] as string;
        }
    }

    try {
        const cacheKey = `branch:${branchId}:damage_reports:${dateKey}:${page}:${limit}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Damage reports fetched successfully (cached)",
                data: JSON.parse(cachedData)
            });
        }

        const whereCondition = {
            booking: {
                branchId: branchId
            },
            damageCharges: {
                gt: 0
            },
            ...dateFilter
        };

        const totalCount = await prisma.invoice.count({
            where: whereCondition
        });

        const reports = await prisma.invoice.findMany({
            where: whereCondition,
            select: {
                id: true,
                publicId: true,
                damageCharges: true,
                total: true,
                createdAt: true,
                booking: {
                    select: {
                        publicId: true,
                        customer: {
                            select: {
                                user: {
                                    select: {
                                        name: true,
                                        email: true
                                    }
                                }
                            }
                        },
                        items: {
                            select: {
                                vehicle: {
                                    select: {
                                        make: true,
                                        model: true,
                                        regNo: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit,
            skip: skip
        });

        const responseData = {
            reports,
            pagination: {
                total: totalCount,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        await redis.setex(cacheKey, 60, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json({
            message: "Damage reports fetched successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Damage Reports Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching damage reports"
        });
    }
}



export const GetDamageReportList = async (req: Request, res: Response) => {
    try {
        const branchId = req.branch_Id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const search = parseInt(req.query.search as string);
        const skip = (page - 1) * limit;

        const whereCondition: any = {
            booking: {
                branchId: branchId
            }
        };

        if (search) {
            whereCondition.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                {
                    vehicle: {
                        regNo: { contains: search, mode: 'insensitive' }
                    }
                }
            ];
        }

        const reports = await prisma.damageReport.findMany({
            where: whereCondition,
            select: {
                publicId: true,
                status: true,
                createdAt: true,
                vehicle: {
                    select: {
                        regNo: true,
                        make: true,
                        model: true,
                        images: {
                            where: { isThumbnail: true },
                            select: {
                                file: {
                                    select: { url: true }
                                }
                            },
                            take: 1
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit,
            skip: skip
        });

        const totalCount = await prisma.damageReport.count({
            where: whereCondition
        });

        const responseData = {
            reports: reports.map(r => ({
                ...r,
                vehicle: {
                    ...r.vehicle,
                    image: r.vehicle.images[0]?.file.url || null
                }
            })),
            pagination: {
                total: totalCount,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        return res.status(StatusCode.OK).json({
            message: "Damage reports fetched successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Error fetching damage report list:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}

export const GetMinimalDamageReport = async (req: Request, res: Response) => {
    try {
        const { damageReportId } = req.params;
        const branchId = req.branch_Id;

        if (!damageReportId) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Damage Report ID is required" });
        }

        const report = await prisma.damageReport.findUnique({
            where: { publicId: damageReportId },
            select: {
                publicId: true,
                status: true,
                estimatedCost: true,
                notes: true,
                createdAt: true,
                booking: {
                    select: {
                        publicId: true,
                        totalDeposit: true,
                        branchId: true,
                    }
                },
                vehicle: {
                    select: {
                        regNo: true,
                        make: true,
                        model: true,
                        status: true
                    }
                },
                photos: {
                    where: {
                        type: "DAMAGE"
                    },
                    select: {
                        file: {
                            select: {
                                url: true
                            }
                        }
                    }
                }
            }
        });

        if (!report) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Damage Report not found" });
        }

        // Access Rule: Manager.branchId must match booking.branchId
        if (report.booking.branchId !== branchId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Access Denied: This report belongs to another branch"
            });
        }

        // Transform response to match strict format
        const responseData = {
            damageReportId: report.publicId,
            status: report.status,
            booking: {
                bookingId: report.booking.publicId,
                deposit: Number(report.booking.totalDeposit)
            },
            vehicle: {
                regNo: report.vehicle.regNo,
                make: report.vehicle.make,
                model: report.vehicle.model,
                currentStatus: report.vehicle.status
            },
            damageDetails: report.notes, // JSON object as is
            images: report.photos.map(p => ({ url: p.file.url })),
            financialHint: {
                deposit: Number(report.booking.totalDeposit),
                estimatedCost: Number(report.estimatedCost)
            }
        };

        return res.status(StatusCode.OK).json(responseData);

    } catch (error) {
        console.error("Error fetching minimal damage report:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}

export const CloseDamageReport = async (req: Request, res: Response) => {
    try {
        const validation = closeDamageReportSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid inputs",
                errors: validation.error.errors
            });
        }

        const { disposition, finalCost, paymentMethod } = validation.data;
        const damageReportPublicId = req.params.damageReportId;
        const managerId = req.public_Id;
        const branchId = req.branch_Id;

        // 1. Fetch Report & Related Entities
        const damageReport = await prisma.damageReport.findUnique({
            where: { publicId: damageReportPublicId },
            include: {
                booking: {
                    include: {
                        deposit: true,
                        invoice: true
                    }
                },
                vehicle: true
            }
        });

        if (!damageReport) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Damage Report not found" });
        }

        const booking = damageReport.booking;

        // 2. Validations
        if (booking.branchId !== branchId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Access Denied: Booking belongs to a different branch"
            });
        }

        if (damageReport.status !== "PENDING" as DamageReportStatus && damageReport.status !== "APPROVED" as DamageReportStatus) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: `Cannot close report. Current status: ${damageReport.status}`
            });
        }

        // 3. Financial Calculation
        const depositAmount = Number(booking.totalDeposit);
        const fineAmount = finalCost;
        const balance = depositAmount - fineAmount; // Positive = Refund, Negative = Due

        const managerUser = await prisma.user.findUnique({
            where: { publicId: managerId },
            select: { id: true }
        });

        if (!managerUser) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Manager not found" });

        // 5. Transaction
        let paymentUrl: string | null = null;
        let isFullySettled = false;

        await prisma.$transaction(async (tx) => {
            // Update Report first
            await tx.damageReport.update({
                where: { id: damageReport.id },
                data: {
                    finalCost: fineAmount,
                    disposition: disposition as VehicleReturnDisposition,
                    approvedById: managerUser.id,
                    status: "APPROVED" as DamageReportStatus
                }
            });

            if (balance >= 0) {
                // Refund or Exact Match
                if (balance > 0 && booking.deposit) {
                    await tx.deposit.update({
                        where: { id: booking.deposit.id },
                        data: {
                            isRefunded: true,
                            refundedAt: new Date(),
                            refundMethod: "CASH",
                        }
                    });
                }
                isFullySettled = true;
            } else {
                // Due Amount
                const dueAmount = Math.abs(balance);

                if (!paymentMethod) {
                    throw new Error("Payment method required for due amount");
                }

                if (paymentMethod === "CASH") {
                    if (booking.invoice) {
                        await tx.payment.create({
                            data: {
                                publicId: createID(),
                                invoiceId: booking.invoice.id,
                                method: DepositMethod.CASH,
                                amount: dueAmount,
                                status: PaymentStatus.SUCCESS
                            }
                        });
                        isFullySettled = true;
                    }
                } else if (paymentMethod === "ONLINE_RAZORPAY") {
                    if (booking.invoice) {
                        await tx.payment.create({
                            data: {
                                publicId: createID(),
                                invoiceId: booking.invoice.id,
                                method: DepositMethod.ONLINE_RAZORPAY,
                                amount: dueAmount,
                                status: PaymentStatus.CREATED
                            }
                        });

                        const responseIdx = await initiatePhonePePayment(dueAmount);
                        paymentUrl = responseIdx?.instrumentResponse?.redirectInfo?.url;
                    }
                    isFullySettled = false;
                }
            }

            // 6. Finalize if Settled
            if (isFullySettled) {
                if (booking.invoice) {
                    await tx.invoice.update({
                        where: { id: booking.invoice.id },
                        data: {
                            status: InvoiceStatus.PAID,
                            damageCharges: fineAmount,
                            total: { increment: fineAmount }
                        }
                    });
                }

                await tx.booking.update({
                    where: { id: booking.id },
                    data: {
                        status: BookingStatus.RETURNED,
                        totalFinal: { increment: fineAmount }
                    }
                });

                let nextVehicleStatus: VehicleStatus = VehicleStatus.AVAILABLE;
                if (disposition === 'MAINTENANCE') nextVehicleStatus = VehicleStatus.MAINTENANCE;
                if (disposition === 'DAMAGED') nextVehicleStatus = VehicleStatus.INACTIVE;

                await tx.vehicle.update({
                    where: { id: damageReport.vehicleId },
                    data: { status: nextVehicleStatus }
                });
            }

            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: managerUser.id,
                    action: "BOOKING_CLOSED_WITH_DAMAGE",
                    entity: "DamageReport",
                    entityId: damageReport.publicId
                }
            });
        });

        if (isFullySettled) {
            return res.status(StatusCode.OK).json({
                message: "Damage Report Closed & Booking Settled",
                refunded: balance > 0,
                settled: true
            });
        } else {
            return res.status(StatusCode.OK).json({
                message: "Payment Required to Settle Booking",
                paymentUrl: paymentUrl,
                settled: false
            });
        }

    } catch (error: any) {
        console.error("Error closing damage report:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: error.message || "Internal Server Error"
        });
    }
}
