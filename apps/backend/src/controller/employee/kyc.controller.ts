import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

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
                },
                kycFile: {
                    select: {
                        publicId: true,
                        url: true,
                        mime: true
                    }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found"
            });
        }
        if (!booking.kycFile) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "No KYC document linked to this booking"
            });
        }

        const kycRecord = await prisma.customerKyc.findFirst({
            where: {
                file: {
                    publicId: booking.kycFile.publicId
                },
                customerId: booking.customer.id
            },
            select: {
                type: true,
                status: true
            }
        });

        const kycDocs = [{
            publicId: booking.kycFile.publicId,
            type: kycRecord?.type || "UNKNOWN",
            status: kycRecord?.status || "UNKNOWN",
            file: {
                url: booking.kycFile.url,
                mime: booking.kycFile.mime
            }
        }];

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
        const actingUserPublicId = req.public_Id;
        const actingUser = await prisma.user.findUnique({
            where: { publicId: actingUserPublicId },
            select: { id: true }
        });

        if (!actingUser) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: User not found"
            });
        }

        const kyc = await prisma.customerKyc.findUnique({
            where: { publicId: kycId }
        });

        if (!kyc) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "KYC Document not found"
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.customerKyc.update({
                where: { publicId: kycId },
                data: { status: status }
            });

            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: actingUser.id,
                    action: `KYC_${status}`,
                    entity: "CustomerKyc",
                    entityId: kyc.publicId,
                }
            });

            return updated;
        });

        return res.status(StatusCode.OK).json({
            message: "KYC Status Updated Successfully",
            data: {
                id: result.publicId,
                status: result.status
            }
        });

    } catch (error) {
        console.error("Error updating KYC status:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
}
