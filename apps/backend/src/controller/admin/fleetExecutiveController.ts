import { Request, Response } from 'express';
import { StatusCode } from '../../types/statusCode.js';
import { prisma } from '@repo/database/client';
import { exportFleetExecutiveToExcel } from '../../utils/exportToExcel.js';
import { exportFleetExecutiveToCSV } from '../../utils/exportToCSV.js';

/**
 * Fleet Executive Report Controller
 * GET /api/dashboard/reports/fleet-executive
 * 
 * High-level executive dashboard with KPIs and performance metrics
 * 
 * Query Parameters:
 * - startDate: string (required) - Format: YYYY-MM-DD
 * - endDate: string (required) - Format: YYYY-MM-DD
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetFleetExecutiveReport = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, export: exportFormat } = req.query;

        if (!startDate || !endDate) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: 'Start date and end date are required',
            });
        }

        const start = new Date(startDate as string);
        const end = new Date(endDate as string);

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        // ========================================================================
        // Fetch comprehensive fleet data
        // ========================================================================

        const [
            totalVehicles,
            activeBookings,
            completedBookings,
            totalRevenue,
            branches,
            categories,
            damageReports,
            maintenanceRecords,
        ] = await Promise.all([
            // Total vehicles
            prisma.vehicle.count({
                where: { deletedAt: null },
            }),

            // Active bookings in period
            prisma.booking.count({
                where: {
                    status: {
                        in: ['HOLD', 'CONFIRMED', 'PICKED_UP'],
                    },
                    startAt: {
                        lte: end,
                    },
                    endAt: {
                        gte: start,
                    },
                    deletedAt: null,
                },
            }),

            // Completed bookings in period
            prisma.booking.findMany({
                where: {
                    status: 'RETURNED',
                    endAt: {
                        gte: start,
                        lte: end,
                    },
                    deletedAt: null,
                },
                include: {
                    invoice: true,
                },
            }),

            // Total revenue
            prisma.payment.aggregate({
                where: {
                    createdAt: {
                        gte: start,
                        lte: end,
                    },
                },
                _sum: {
                    amount: true,
                },
            }),

            // Branch details with vehicle counts
            prisma.branch.findMany({
                where: {
                    deletedAt: null,
                },
                include: {
                    _count: {
                        select: {
                            vehicles: {
                                where: {
                                    deletedAt: null,
                                },
                            },
                        },
                    },
                },
            }),

            // Category details with vehicle counts
            prisma.vehicleCategory.findMany({
                include: {
                    _count: {
                        select: {
                            vehicles: {
                                where: {
                                    deletedAt: null,
                                },
                            },
                        },
                    },
                },
            }),

            // Damage reports in period
            prisma.damageReport.count({
                where: {
                    createdAt: {
                        gte: start,
                        lte: end,
                    },
                },
            }),

            // Maintenance records in period
            prisma.vehicleMaintenanceRecord.count({
                where: {
                    servicedAt: {
                        gte: start,
                        lte: end,
                    },
                },
            }),
        ]);

        // ========================================================================
        // Calculate KPIs
        // ========================================================================

        const totalBookings = completedBookings.length;
        const totalRevenueAmount = Number(totalRevenue._sum.amount || 0);

        const averageBookingValue = totalBookings > 0 ? totalRevenueAmount / totalBookings : 0;

        // Fleet utilization (active bookings / total vehicles)
        const fleetUtilization = totalVehicles > 0 ? (activeBookings / totalVehicles) * 100 : 0;

        // Revenue per vehicle
        const revenuePerVehicle = totalVehicles > 0 ? totalRevenueAmount / totalVehicles : 0;

        // ========================================================================
        // Branch performance
        // ========================================================================

        const branchPerformance = await Promise.all(
            branches.map(async (branch) => {
                const [branchRevenue, branchBookings, branchActiveVehicles] = await Promise.all([
                    prisma.payment.aggregate({
                        where: {
                            createdAt: {
                                gte: start,
                                lte: end,
                            },
                            invoice: {
                                booking: {
                                    items: {
                                        some: {
                                            vehicle: {
                                                branchId: branch.id,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        _sum: {
                            amount: true,
                        },
                    }),
                    prisma.booking.count({
                        where: {
                            status: 'RETURNED',
                            endAt: {
                                gte: start,
                                lte: end,
                            },
                            items: {
                                some: {
                                    vehicle: {
                                        branchId: branch.id,
                                    },
                                },
                            },
                            deletedAt: null,
                        },
                    }),
                    prisma.vehicle.count({
                        where: {
                            branchId: branch.id,
                            status: {
                                in: ['AVAILABLE', 'OUT_FOR_RENTAL'],
                            },
                            deletedAt: null,
                        },
                    }),
                ]);

                return {
                    branchId: branch.publicId,
                    branchName: branch.name,
                    totalVehicles: branch._count.vehicles,
                    activeVehicles: branchActiveVehicles,
                    totalBookings: branchBookings,
                    totalRevenue: Number(branchRevenue._sum.amount ?? 0),
                    averageBookingValue: branchBookings > 0 ? Number(branchRevenue._sum.amount ?? 0) / branchBookings : 0,
                    utilization: branch._count.vehicles > 0 ? (branchActiveVehicles / branch._count.vehicles) * 100 : 0,
                };
            })
        );

        // ========================================================================
        // Category performance
        // ========================================================================

        const categoryPerformance = await Promise.all(
            categories.map(async (category) => {
                const [categoryRevenue, categoryBookings] = await Promise.all([
                    prisma.payment.aggregate({
                        where: {
                            createdAt: {
                                gte: start,
                                lte: end,
                            },
                            invoice: {
                                booking: {
                                    items: {
                                        some: {
                                            vehicle: {
                                                categoryId: category.id,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        _sum: {
                            amount: true,
                        },
                    }),
                    prisma.booking.count({
                        where: {
                            status: 'RETURNED',
                            endAt: {
                                gte: start,
                                lte: end,
                            },
                            items: {
                                some: {
                                    vehicle: {
                                        categoryId: category.id,
                                    },
                                },
                            },
                            deletedAt: null,
                        },
                    }),
                ]);

                return {
                    categoryName: category.name,
                    totalVehicles: category._count.vehicles,
                    totalBookings: categoryBookings,
                    totalRevenue: Number(categoryRevenue._sum.amount ?? 0),
                    averageBookingValue: categoryBookings > 0 ? Number(categoryRevenue._sum.amount ?? 0) / categoryBookings : 0,
                };
            })
        );

        // ========================================================================
        // Operational metrics
        // ========================================================================

        const operationalMetrics = {
            damageReports,
            maintenanceRecords,
            damageReportRate: totalBookings > 0 ? (damageReports / totalBookings) * 100 : 0,
            maintenanceRate: totalVehicles > 0 ? (maintenanceRecords / totalVehicles) * 100 : 0,
        };

        // ========================================================================
        // Build response
        // ========================================================================

        const reportData = {
            metadata: {
                generatedAt: new Date().toISOString(),
                dateRange: {
                    startDate: start.toISOString().split('T')[0],
                    endDate: end.toISOString().split('T')[0],
                },
            },
            kpis: {
                totalVehicles,
                activeBookings,
                totalBookings,
                totalRevenue: totalRevenueAmount,
                averageBookingValue,
                fleetUtilization,
                revenuePerVehicle,
            },
            branchPerformance: branchPerformance.sort((a, b) => b.totalRevenue - a.totalRevenue),
            categoryPerformance: categoryPerformance.sort((a, b) => b.totalRevenue - a.totalRevenue),
            operationalMetrics,
        };

        // ========================================================================
        // Handle export if requested
        // ========================================================================

        if (exportFormat === 'xlsx') {
            const filename = `fleet-executive-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}`;
            return await exportFleetExecutiveToExcel(res, reportData, filename);
        }

        if (exportFormat === 'csv') {
            const filename = `fleet-executive-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}`;
            return exportFleetExecutiveToCSV(res, reportData, filename);
        }

        // Return JSON response
        return res.status(StatusCode.OK).json({
            message: 'Fleet executive report generated successfully',
            data: reportData,
        });

    } catch (error) {
        console.error('Get Fleet Executive Report Error:', error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: 'Failed to generate fleet executive report',
        });
    }
};
