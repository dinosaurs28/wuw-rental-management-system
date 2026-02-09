import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, PaymentStatus, VehicleStatus, DepositMethod, InvoiceStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import jwt from "jsonwebtoken";

interface CashPaymentPayload {
    finalPrice: number;
}

export const checkPaymentForCash = async (req: Request, res: Response) => {
    try {
        const { encryptedFinalPrice, transactionId } = req.body;

        if (!encryptedFinalPrice) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Encrypted final price is missing",
            });
        }

        if (!transactionId) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Transaction ID is missing",
            });
        }

        // Verify the JWT token
        let decodedPayload: CashPaymentPayload;
        try {
            decodedPayload = jwt.verify(
                encryptedFinalPrice,
                process.env.JWT_SECERT!
            ) as CashPaymentPayload;
        } catch (jwtError) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Price was tampered. Please retry booking again.",
            });
        }

        const booking = await prisma.booking.findUnique({
            where: { transactionId },
            include: {
                items: {
                    include: { vehicle: true },
                },
            },
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found for this transactionId",
            });
        }

        // Verify the price matches the booking total
        if (decodedPayload.finalPrice !== booking.totalFinal.toNumber()) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Price was tampered. Please retry booking again.",
            });
        }

        // Check if booking is already confirmed
        if (booking.paymentStatus === PaymentStatus.SUCCESS) {
            return res.status(StatusCode.OK).json({
                status: "Success",
                message: "Booking already confirmed",
                redirectURL: "FRONTEND_SUCCESS_URL",
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.CONFIRMED,
                    paymentStatus: PaymentStatus.SUCCESS,
                    holdExpiresAt: null,
                    depositMethod: DepositMethod.CASH,
                },
            });

            await tx.vehicle.updateMany({
                where: {
                    id: { in: booking.items.map((i) => i.vehicleId) },
                },
                data: {
                    status: VehicleStatus.AVAILABLE,
                },
            });

            if (booking.totalDeposit.gt(0)) {
                await tx.deposit.create({
                    data: {
                        publicId: createID(),
                        bookingId: booking.id,
                        amount: booking.totalDeposit,
                        method: DepositMethod.CASH,
                    },
                });
            }

            const invoice = await tx.invoice.create({
                data: {
                    publicId: createID(),
                    bookingId: booking.id,
                    subtotal: booking.totalBase,
                    discount: booking.totalDiscount,
                    tax: 0,
                    damageCharges: 0,
                    total: booking.totalFinal,
                    status: InvoiceStatus.PAID,
                },
            });

            await tx.invoiceItem.createMany({
                data: booking.items.map((item) => ({
                    publicId: createID(),
                    invoiceId: invoice.id,
                    label: `${item.vehicle.make} ${item.vehicle.model}`,
                    amount: item.finalTotal,
                })),
            });

            await tx.payment.create({
                data: {
                    publicId: createID(),
                    invoiceId: invoice.id,
                    method: DepositMethod.CASH,
                    status: PaymentStatus.SUCCESS,
                    amount: booking.totalFinal,
                },
            });

            // Clear Redis holds
            for (const item of booking.items) {
                await redis.del(`vehicle_holds:${item.vehicle.publicId}`);
            }
            await redis.del(`hold:${booking.publicId}`);

            await tx.auditLog.create({
                data: {
                    publicId: createID(),
                    userId: booking.createdById,
                    action: "BOOKING_CONFIRMED",
                    entity: "Booking",
                    entityId: booking.publicId,
                    after: {
                        status: "CONFIRMED",
                        paymentStatus: "SUCCESS",
                        paymentMethod: "CASH",
                    },
                },
            });
        });

        return res.status(StatusCode.OK).json({
            status: "Success",
            message: "Cash payment confirmed successfully",
            redirectURL: "FRONTEND_SUCCESS_URL",
        });
    } catch (error) {
        console.error("Error checking cash payment:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal error while processing cash payment",
        });
    }
};