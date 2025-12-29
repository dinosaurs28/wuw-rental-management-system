import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";

export const GetBookingKyc = async (req: Request, res: Response) => {
    const { bookingId } = req.params;
    const branchId = req.branch_Id;

    try {
        const booking = await prisma.booking.findFirst({
            where: {
                publicId: bookingId,
                branchId: branchId
            },
            select: {
                id: true,
                customer: {
                    select: {
                        id: true,
                        publicId: true,
                        user: {
                            select: {
                                name: true
                            }
                        }
                    }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found or access denied"
            });
        }
        const kycDocs = await prisma.customerKyc.findMany({
            where: {
                customerId: booking.customer.id
            },
            select: {
                publicId: true,
                type: true,
                status: true,
                file: {
                    select: {
                        url: true,
                        mime: true
                    }
                }
            }
        });

        if (kycDocs.length === 0) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "No KYC documents found for this customer",
                customerName: booking.customer.user.name
            });
        }

        return res.status(StatusCode.OK).json({
            message: "KYC Documents fetched successfully",
            customerName: booking.customer.user.name,
            kyc: kycDocs
        });

    } catch (error) {
        console.error("Error fetching KYC:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching KYC"
        });
    }
}

export const VerifyKyc = async (req: Request, res: Response) => {
    const { kycId } = req.params;
    const { status } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(StatusCode.BAD_REQUEST).json({
            message: "Invalid status. Allowed values: APPROVED, REJECTED"
        });
    }

    try {
        const kyc = await prisma.customerKyc.findUnique({
            where: { publicId: kycId }
        });

        if (!kyc) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "KYC Document not found"
            });
        }

        const updatedKyc = await prisma.customerKyc.update({
            where: { publicId: kycId },
            data: {
                status: status
            }
        });

        return res.status(StatusCode.OK).json({
            message: "KYC Status Updated Successfully",
            data: {
                id: updatedKyc.publicId,
                status: updatedKyc.status
            }
        });

    } catch (error) {
        console.error("Error updating KYC status:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}
