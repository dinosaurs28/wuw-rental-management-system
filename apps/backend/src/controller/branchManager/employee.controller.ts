import { Request, Response } from "express";
import { prisma, Role, User } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode";
import { createEmployeeSchema, updateEmployeeSchema } from "@repo/schemas";
import { hashSync } from "bcrypt";
import crypto from "crypto";
import { createID } from "../../utils/nanoID";

export const SearchEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { search, page = "1", limit = "10" } = req.query;

    const pageNumber = parseInt(page as string) || 1;
    const pageSize = parseInt(limit as string) || 10;
    const skip = (pageNumber - 1) * pageSize;

    const whereClause: any = {
        branchId: branchId,
        role: Role.STAFF,
        deletedAt: null
    };

    if (search) {
        const searchTerm = search as string;
        whereClause.OR = [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm, mode: 'insensitive' } }
        ];
    }

    try {
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                select: {
                    id: false,
                    publicId: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                    createdAt: true
                },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.user.count({ where: whereClause })
        ]);

        return res.status(StatusCode.OK).json({
            data: users,
            meta: {
                total,
                page: pageNumber,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize)
            }
        });

    } catch (error) {
        console.error("SearchEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const GetEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { employeeId } = req.params;

    try {
        const user = await prisma.user.findFirst({
            where: {
                publicId: employeeId,
                branchId: branchId,
                role: Role.STAFF,
                deletedAt: null
            },
            select: {
                id: false,
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Employee not found" });
        }

        return res.status(StatusCode.OK).json({ data: user });

    } catch (error) {
        console.error("GetEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const CreateEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const validation = createEmployeeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid Inputs",
            error: validation.error
        });
    }

    const { name, phone } = validation.data;

    try {
        // Check if phone already exists in this branch/system? 
        // User schema has unique email. Phone is not unique in schema, but good to check.
        // We are using phone to generate email, so duplicate phone -> duplicate email.
        const email = `${phone}@staff.vrms.com`;

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: email },
                    { phone: phone } // Try to keep phone unique generally
                ]
            }
        });

        if (existingUser) {
            return res.status(StatusCode.CONFLICT).json({ message: "Employee with this phone already exists" });
        }

        // Generate password
        const password = crypto.randomBytes(8).toString('hex');
        const passwordHash = hashSync(password, 10);
        const publicId = createID();

        const newUser = await prisma.user.create({
            data: {
                publicId,
                name,
                email,
                phone,
                passwordHash,
                role: Role.STAFF,
                branchId: branchId,
                authProvider: 'PASSWORD',
                emailVerifiedAt: new Date() // Auto verify as requested
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                createdAt: true
            }
        });

        return res.status(StatusCode.CREATED).json({
            message: "Employee created successfully",
            data: newUser,
            generatedPassword: password
        });

    } catch (error) {
        console.error("CreateEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}

export const UpdateEmployee = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { employeeId } = req.params;

    const validation = updateEmployeeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid Inputs",
            error: validation.error
        });
    }

    const { name, phone } = validation.data;

    try {
        const user = await prisma.user.findFirst({
            where: {
                publicId: employeeId,
                branchId: branchId,
                role: Role.STAFF,
                deletedAt: null
            }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({ message: "Employee not found" });
        }

        // Check if phone is being changed and if it conflicts
        if (phone !== user.phone) {
            const existingPhone = await prisma.user.findFirst({
                where: {
                    phone: phone,
                    id: { not: user.id }
                }
            });
            if (existingPhone) {
                return res.status(StatusCode.CONFLICT).json({ message: "Phone number already in use" });
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                name,
                phone
            },
            select: {
                publicId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                updatedAt: true
            }
        });

        return res.status(StatusCode.OK).json({
            message: "Employee updated successfully",
            data: updatedUser
        });

    } catch (error) {
        console.error("UpdateEmployee Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
    }
}
