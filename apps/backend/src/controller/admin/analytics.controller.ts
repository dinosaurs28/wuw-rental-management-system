import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus, PaymentStatus } from "@repo/database/client";

/**
 * Get Revenue Trends - Time-series revenue data
 * Query params: startDate, endDate, branchId (optional), granularity (daily|weekly|monthly)
 */
export const GetRevenueTrends = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId, categoryId, granularity = 'daily' } = req.query;

        // Date Filtering
        const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
        const end = endDate ? new Date(endDate as string) : new Date();

        // Branch Filtering
        const branchWhere = branchId ? { publicId: branchId as string } : {};
        const branches = await prisma.branch.findMany({
            where: branchWhere,
            select: { id: true, publicId: true, name: true }
        });

        // Get all bookings in the date range
        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId ? branches[0]?.id : undefined,
                OR: [
                    { status: BookingStatus.CONFIRMED },
                    { status: BookingStatus.PICKED_UP },
                    { status: BookingStatus.RETURNED },
                ],
                paymentStatus: PaymentStatus.SUCCESS,
                createdAt: {
                    gte: start,
                    lte: end
                },
                ...(categoryId && {
                    items: {
                        some: {
                            vehicle: {
                                category: {
                                    publicId: categoryId as string
                                }
                            }
                        }
                    }
                })
            },
            select: {
                createdAt: true,
                totalFinal: true,
                branchId: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        // Group by time period
        const groupedData = new Map<string, { revenue: number; count: number; branchId?: number }>();

        bookings.forEach(booking => {
            const date = new Date(booking.createdAt);
            let periodKey: string;

            switch (granularity) {
                case 'weekly': {
                    // ISO week number
                    const weekNumber = getWeekNumber(date);
                    periodKey = `${date.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
                    break;
                }
                case 'monthly': {
                    periodKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                    break;
                }
                case 'daily':
                default: {
                    periodKey = date.toISOString().split('T')[0]!;
                    break;
                }
            }

            const existing = groupedData.get(periodKey) || { revenue: 0, count: 0, branchId: booking.branchId };
            existing.revenue += Number(booking.totalFinal);
            existing.count += 1;
            groupedData.set(periodKey, existing);
        });

        // Convert to array and calculate averages
        const data = Array.from(groupedData.entries()).map(([period, stats]) => {
            const branch = branches.find(b => b.id === stats.branchId);
            return {
                period,
                totalRevenue: stats.revenue,
                bookingCount: stats.count,
                avgRevenuePerBooking: stats.count > 0 ? stats.revenue / stats.count : 0,
                branchId: branch?.publicId || undefined,
                branchName: branch?.name || undefined
            };
        });

        return res.status(StatusCode.OK).json({
            message: "Revenue trends retrieved successfully",
            dateRange: { start, end },
            granularity,
            data
        });

    } catch (error) {
        console.error("Get Revenue Trends Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};

/**
 * Get Revenue By Category - Category-wise revenue breakdown
 */
export const GetRevenueByCategory = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId } = req.query;

        const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate as string) : new Date();

        // Get branch filter
        const branchWhere = branchId ? { publicId: branchId as string } : {};
        const branches = await prisma.branch.findMany({
            where: branchWhere,
            select: { id: true }
        });

        const branchIds = branches.map(b => b.id);

        // Get all booking items with category information
        const bookingItems = await prisma.bookingItem.findMany({
            where: {
                booking: {
                    branchId: branchIds.length > 0 ? { in: branchIds } : undefined,
                    paymentStatus: PaymentStatus.SUCCESS,
                    createdAt: {
                        gte: start,
                        lte: end
                    }
                }
            },
            include: {
                vehicle: {
                    include: {
                        category: true
                    }
                }
            }
        });

        // Group by category
        const categoryMap = new Map<number, {
            categoryId: string;
            categoryName: string;
            totalRevenue: number;
            bookingCount: number;
            vehicleIds: Set<number>;
        }>();

        bookingItems.forEach(item => {
            const category = item.vehicle.category;
            const existing = categoryMap.get(category.id) || {
                categoryId: category.publicId,
                categoryName: category.name,
                totalRevenue: 0,
                bookingCount: 0,
                vehicleIds: new Set<number>()
            };

            existing.totalRevenue += Number(item.finalTotal);
            existing.bookingCount += 1;
            existing.vehicleIds.add(item.vehicleId);
            categoryMap.set(category.id, existing);
        });

        // Convert to array and calculate metrics
        const data = Array.from(categoryMap.values()).map(cat => {
            const vehicleCount = cat.vehicleIds.size;
            return {
                categoryId: cat.categoryId,
                categoryName: cat.categoryName,
                totalRevenue: cat.totalRevenue,
                bookingCount: cat.bookingCount,
                vehicleCount,
                avgRevenuePerVehicle: vehicleCount > 0 ? cat.totalRevenue / vehicleCount : 0
            };
        }).sort((a, b) => b.totalRevenue - a.totalRevenue); // Sort by revenue descending

        return res.status(StatusCode.OK).json({
            message: "Category revenue retrieved successfully",
            dateRange: { start, end },
            data
        });

    } catch (error) {
        console.error("Get Revenue By Category Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};

/**
 * Get Enhanced KPI Summary with trend comparison
 */
export const GetKPISummary = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId } = req.query;

        const end = endDate ? new Date(endDate as string) : new Date();
        const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Calculate previous period
        const periodLength = end.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - periodLength);
        const prevEnd = new Date(start.getTime() - 1);

        // Branch filter
        const branchWhere = branchId ? { publicId: branchId as string } : {};
        const branches = await prisma.branch.findMany({
            where: branchWhere,
            select: { id: true }
        });
        const branchIds = branches.map(b => b.id);

        // Current period metrics
        const currentBookings = await prisma.booking.aggregate({
            where: {
                branchId: branchIds.length > 0 ? { in: branchIds } : undefined,
                paymentStatus: PaymentStatus.SUCCESS,
                createdAt: { gte: start, lte: end }
            },
            _sum: { totalFinal: true },
            _count: true
        });

        // Previous period metrics
        const previousBookings = await prisma.booking.aggregate({
            where: {
                branchId: branchIds.length > 0 ? { in: branchIds } : undefined,
                paymentStatus: PaymentStatus.SUCCESS,
                createdAt: { gte: prevStart, lte: prevEnd }
            },
            _sum: { totalFinal: true },
            _count: true
        });

        const currentRevenue = Number(currentBookings._sum.totalFinal || 0);
        const previousRevenue = Number(previousBookings._sum.totalFinal || 0);
        const currentCount = currentBookings._count;
        const previousCount = previousBookings._count;

        // Calculate percentage changes
        const revenueChange = previousRevenue > 0
            ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
            : 0;
        const bookingChange = previousCount > 0
            ? ((currentCount - previousCount) / previousCount) * 100
            : 0;

        const avgBookingValue = currentCount > 0 ? currentRevenue / currentCount : 0;
        const prevAvgBookingValue = previousCount > 0 ? previousRevenue / previousCount : 0;
        const avgValueChange = prevAvgBookingValue > 0
            ? ((avgBookingValue - prevAvgBookingValue) / prevAvgBookingValue) * 100
            : 0;

        return res.status(StatusCode.OK).json({
            message: "KPI summary retrieved successfully",
            currentPeriod: { start, end },
            previousPeriod: { start: prevStart, end: prevEnd },
            data: {
                totalRevenue: currentRevenue,
                revenueChange,
                totalBookings: currentCount,
                bookingChange,
                avgBookingValue,
                avgBookingValueChange: avgValueChange
            }
        });

    } catch (error) {
        console.error("Get KPI Summary Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};

/**
 * Get Payment Method Breakdown - Revenue distribution by payment method
 */
export const GetPaymentMethodBreakdown = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId } = req.query;

        const end = endDate ? new Date(endDate as string) : new Date();
        const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Branch filter
        const branchWhere = branchId ? { publicId: branchId as string } : {};
        const branches = await prisma.branch.findMany({
            where: branchWhere,
            select: { id: true }
        });
        const branchIds = branches.map(b => b.id);

        // Get all payments grouped by method
        const payments = await prisma.payment.findMany({
            where: {
                invoice: {
                    booking: {
                        branchId: branchIds.length > 0 ? { in: branchIds } : undefined,
                        createdAt: { gte: start, lte: end }
                    }
                },
                status: PaymentStatus.SUCCESS
            },
            select: {
                amount: true,
                method: true
            }
        });

        // Group by payment method
        const methodMap = new Map<string, { totalRevenue: number; count: number }>();

        payments.forEach(payment => {
            const method = payment.method || 'unknown';
            const existing = methodMap.get(method) || { totalRevenue: 0, count: 0 };
            existing.totalRevenue += Number(payment.amount);
            existing.count += 1;
            methodMap.set(method, existing);
        });

        // Calculate total for percentage
        const totalRevenue = Array.from(methodMap.values()).reduce((sum, m) => sum + m.totalRevenue, 0);

        // Convert to array with metrics
        const data = Array.from(methodMap.entries()).map(([method, stats]) => ({
            paymentMethod: method,
            totalRevenue: stats.totalRevenue,
            transactionCount: stats.count,
            avgTransactionValue: stats.count > 0 ? stats.totalRevenue / stats.count : 0,
            percentageShare: totalRevenue > 0 ? (stats.totalRevenue / totalRevenue) * 100 : 0
        })).sort((a, b) => b.totalRevenue - a.totalRevenue);

        return res.status(StatusCode.OK).json({
            message: "Payment method breakdown retrieved successfully",
            dateRange: { start, end },
            data
        });

    } catch (error) {
        console.error("Get Payment Method Breakdown Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};

// Helper function to get ISO week number
function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
