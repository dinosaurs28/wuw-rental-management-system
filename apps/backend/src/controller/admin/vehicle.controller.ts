import { Request, Response } from 'express';
import { StatusCode } from '../../types/statusCode.js';
import { prisma } from '@repo/database/client';

/**
 * Get All Vehicles (Admin)
 * GET /admin/dashboard/vehicles
 * 
 * Returns all vehicles across all branches for admin access
 */
export const GetAllVehicles = async (req: Request, res: Response) => {
    try {
        const vehicles = await prisma.vehicle.findMany({
            where: {
                deletedAt: null,
            },
            include: {
                category: {
                    select: {
                        name: true,
                    },
                },
                branch: {
                    select: {
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return res.status(StatusCode.OK).json({
            message: 'Vehicles fetched successfully',
            data: vehicles,
        });
    } catch (error) {
        console.error('Get All Vehicles Error:', error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: 'Failed to fetch vehicles',
        });
    }
};
