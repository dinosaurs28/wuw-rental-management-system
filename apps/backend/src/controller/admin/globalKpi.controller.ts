import { prisma, VehicleStatus, BookingStatus } from '@repo/database/client';
import { Request, Response } from 'express';
import { startOfMonth, subMonths, endOfMonth, parseISO, isValid, differenceInDays, subDays, endOfDay } from 'date-fns';

export const getGlobalKpiStats = async (req: Request, res: Response) => {
    try {
        const { branchId, categoryId, startDate, endDate } = req.query;

        // --- Filter Setup ---

        // --- Filter Setup ---

        // 1. Branch Filter
        // Frontend sends publicId (string), so we must filter via relation
        const branchFilter = branchId && branchId !== 'all'
            ? { branch: { publicId: String(branchId) } }
            : {};

        // 2. Category Filter (for vehicles/bookings)
        // Note: Booking doesn't directly store categoryId. 
        // Skipping category filter implementation for now as per requirements.
        // Note: Booking doesn't directly store categoryId, usually inferred from vehicle or booking items.
        // Assuming simple Vehicle links for now or skipping category filter for bookings if too complex to join.
        // Prisma Schema: Booking -> BookingItem -> Vehicle -> Category
        // For simplicity, we might apply category filter mainly to "Utilization" (Vehicle based) 
        // and "Revenue" (if we can join).
        // Let's focus on Branch and Date first as per typical requirements, add Category if easy.
        // Booking -> Vehicle relation isn't direct in schema? 
        // Schema: Booking -> BookingItem -> Vehicle. 
        // But also Booking has NO direct vehicleId.
        // So filtering Revenue by Category requires joining BookingItems. 
        // This is expensive. Let's stick to Branch and Date for Revenue/Bookings, 
        // and add Category filter only for Fleet Utilization if requested.
        // User asked for "Filter Option" generic.
        // Let's start with Branch and Date.

        // 3. Date Range
        const now = new Date();
        let currentPeriodStart: Date;
        let currentPeriodEnd: Date;

        if (startDate && endDate && isValid(parseISO(String(startDate))) && isValid(parseISO(String(endDate)))) {
            currentPeriodStart = parseISO(String(startDate));
            currentPeriodEnd = parseISO(String(endDate));
            // Adjust end date to end of day if it looks like a simple date string
            if (String(endDate).length <= 10) {
                currentPeriodEnd = endOfDay(currentPeriodEnd);
            }
        } else {
            // Default: Current Month
            currentPeriodStart = startOfMonth(now);
            currentPeriodEnd = endOfMonth(now);
        }

        // Calculate Previous Period for Trends
        const daysDiff = differenceInDays(currentPeriodEnd, currentPeriodStart) + 1;
        const previousPeriodEnd = subDays(currentPeriodStart, 1);
        const previousPeriodStart = subDays(previousPeriodEnd, daysDiff - 1);


        // --- Metrics ---

        // 1. Total Fleet Utilization Rate
        // Filter: Branch only (Snapshot)
        // Active vehicles: NOT INACTIVE and NOT MANAGER_REPORTED and NOT DELETED
        const vehicleWhere = {
            ...branchFilter,
            deletedAt: null,
            status: { notIn: ['INACTIVE', 'MANAGER_REPORTED'] as VehicleStatus[] }
        };

        const totalActiveVehicles = await prisma.vehicle.count({ where: vehicleWhere });

        const rentedVehicles = await prisma.vehicle.count({
            where: {
                ...vehicleWhere,
                status: 'OUT_FOR_RENTAL'
            }
        });

        // Trend: Compare against snapshot from 'daysDiff' ago? 
        // Or simpler: compare to "Bookings active at start of previous period"?
        // Let's stick to the previous approximation:
        // Compare current utilization vs utilization at (now - daysDiff)
        const pastDate = subDays(now, daysDiff || 30);
        const rentedVehiclesLastPeriod = await prisma.booking.count({
            where: {
                ...branchFilter,
                status: { in: ['PICKED_UP', 'RETURNED'] as BookingStatus[] },
                startAt: { lte: pastDate },
                endAt: { gte: pastDate },
                deletedAt: null
            }
        });

        const fleetUtilizationCurrent = totalActiveVehicles > 0 ? (rentedVehicles / totalActiveVehicles) * 100 : 0;
        const fleetUtilizationLast = totalActiveVehicles > 0 ? (rentedVehiclesLastPeriod / totalActiveVehicles) * 100 : 0;
        const fleetUtilizationTrend = fleetUtilizationCurrent - fleetUtilizationLast;


        // 2. Revenue (Selected Period)
        // Sum of totalFinal
        // Filter: Branch, Date Range
        const revenueWhere = {
            ...branchFilter,
            status: { in: ['CONFIRMED', 'PICKED_UP', 'RETURNED'] as BookingStatus[] },
            deletedAt: null
        };

        const revenueThisPeriodAgg = await prisma.booking.aggregate({
            _sum: { totalFinal: true },
            where: {
                ...revenueWhere,
                createdAt: { gte: currentPeriodStart, lte: currentPeriodEnd }
            }
        });
        const revenueThisPeriod = Number(revenueThisPeriodAgg._sum?.totalFinal || 0);

        const revenueLastPeriodAgg = await prisma.booking.aggregate({
            _sum: { totalFinal: true },
            where: {
                ...revenueWhere,
                createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
            }
        });
        const revenueLastPeriod = Number(revenueLastPeriodAgg._sum?.totalFinal || 0);

        const revenueTrend = revenueLastPeriod > 0
            ? ((revenueThisPeriod - revenueLastPeriod) / revenueLastPeriod) * 100
            : (revenueThisPeriod > 0 ? 100 : 0);


        // 3. Active Bookings
        // Snapshot: Currently PICKED_UP
        // Filter: Branch
        const activeBookingsCount = await prisma.booking.count({
            where: {
                ...branchFilter,
                status: 'PICKED_UP',
                deletedAt: null
            }
        });

        // Trend: Active bookings same time previous period
        const activeBookingsLastCount = await prisma.booking.count({
            where: {
                ...branchFilter,
                status: { in: ['PICKED_UP', 'RETURNED'] as BookingStatus[] }, // approximate
                startAt: { lte: pastDate },
                endAt: { gte: pastDate },
                deletedAt: null
            }
        });
        const activeBookingsTrend = activeBookingsLastCount > 0
            ? ((activeBookingsCount - activeBookingsLastCount) / activeBookingsLastCount) * 100
            : (activeBookingsCount > 0 ? 100 : 0);


        // 4. Pending Revenue
        // Snapshot: Currently CONFIRMED
        // Filter: Branch
        const pendingRevenueAgg = await prisma.booking.aggregate({
            _sum: { totalFinal: true },
            where: {
                ...branchFilter,
                status: 'CONFIRMED',
                deletedAt: null
            }
        });
        const pendingRevenueCount = await prisma.booking.count({
            where: {
                ...branchFilter,
                status: 'CONFIRMED',
                deletedAt: null
            }
        });
        const pendingRevenueAmount = Number(pendingRevenueAgg._sum?.totalFinal || 0);


        // 5. Total Customers
        // Filter: Branch (via User relation)
        // If filtering by date range, does "Total Customers" mean "New Customers in Range"?
        // Usually "Total Customers" is a lifetime metric. 
        // "Growth" is new customers in current period.
        // Let's keep Total as "Lifetime" specific to branch, and user Growth based on date range.

        const customerWhere = {
            deletedAt: null,
            ...(branchId && branchId !== 'all' ? {
                user: { branch: { publicId: String(branchId) } }
            } : {})
        };

        const totalCustomersCount = await prisma.customer.count({
            where: customerWhere
        });

        const newCustomersThisPeriod = await prisma.customer.count({
            where: {
                ...customerWhere,
                createdAt: { gte: currentPeriodStart, lte: currentPeriodEnd }
            }
        });

        // Growth: New customers in this period / Total customers at start of period
        const totalCustomersAtStart = totalCustomersCount - newCustomersThisPeriod;
        // Or strictly: New customers this period vs New customers last period (Velocity)
        // Let's do Growth Rate of customer base: (New / StartTotal) * 100
        const customerGrowthRate = totalCustomersAtStart > 0
            ? (newCustomersThisPeriod / totalCustomersAtStart) * 100
            : (newCustomersThisPeriod > 0 ? 100 : 0);


        // 6. Avg Booking Value
        // Filter: Branch, DateRange (use selected range instead of fixed 3 months)
        // If range is very short (e.g. 1 day), data might be noisy.
        // If defaults (current month), use that.

        const revenuePeriodAgg = await prisma.booking.aggregate({
            _sum: { totalFinal: true },
            where: {
                ...revenueWhere, // includes branch and valid status
                createdAt: { gte: currentPeriodStart, lte: currentPeriodEnd }
            }
        });
        const bookingsPeriodCount = await prisma.booking.count({
            where: {
                ...revenueWhere,
                createdAt: { gte: currentPeriodStart, lte: currentPeriodEnd }
            }
        });
        const totalRevenuePeriod = Number(revenuePeriodAgg._sum?.totalFinal || 0);
        const totalBookingsPeriod = bookingsPeriodCount;
        const avgBookingValue = totalBookingsPeriod > 0 ? totalRevenuePeriod / totalBookingsPeriod : 0;

        const revenuePrevAgg = await prisma.booking.aggregate({
            _sum: { totalFinal: true },
            where: {
                ...revenueWhere,
                createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
            }
        });
        const bookingsPrevCount = await prisma.booking.count({
            where: {
                ...revenueWhere,
                createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
            }
        });
        const totalRevenuePrev = Number(revenuePrevAgg._sum?.totalFinal || 0);
        const totalBookingsPrev = bookingsPrevCount;
        const avgBookingValuePrev = totalBookingsPrev > 0 ? totalRevenuePrev / totalBookingsPrev : 0;

        const avgBookingValueTrend = avgBookingValuePrev > 0
            ? ((avgBookingValue - avgBookingValuePrev) / avgBookingValuePrev) * 100
            : 0;


        // Debug Logging
        console.log(`[KPI] Range: ${currentPeriodStart.toISOString()} - ${currentPeriodEnd.toISOString()}`);
        console.log(`[KPI] Branch: ${branchId || 'all'}`);
        console.log(`[KPI] Rev: ${revenueThisPeriod}, Prev: ${revenueLastPeriod}`);

        return res.json({
            totalFleetUtilization: {
                current: Number(fleetUtilizationCurrent.toFixed(1)),
                trend: Number(fleetUtilizationTrend.toFixed(1))
            },
            revenueThisMonth: {
                current: revenueThisPeriod,
                previous: revenueLastPeriod,
                trend: Number(revenueTrend.toFixed(1))
            },
            activeBookings: {
                count: activeBookingsCount,
                trend: Number(activeBookingsTrend.toFixed(1))
            },
            pendingRevenue: {
                amount: pendingRevenueAmount,
                count: pendingRevenueCount
            },
            totalCustomers: {
                count: totalCustomersCount,
                growth: Number(customerGrowthRate.toFixed(1))
            },
            avgBookingValue: {
                amount: Math.round(avgBookingValue),
                trend: Number(avgBookingValueTrend.toFixed(1))
            }
        });

    } catch (error) {
        console.error('Error fetching global KPI stats:', error);
        return res.status(500).json({ message: 'Failed to fetch global KPI stats' });
    }
};
