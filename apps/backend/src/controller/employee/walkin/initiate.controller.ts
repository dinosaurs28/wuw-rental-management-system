import { Request, Response } from "express";
import { prisma, Role, AuthProvider } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode";
import { initiateWalkinSchema } from "@repo/schemas"; // Ensure this is exported
import { createID } from "../../../utils/nanoID";
import { hashpassword } from "../../../utils/PasswordCrypt/password";
import { sendOTP } from "../../../services/otp/otpservice";
import { rateLimit } from "../../../utils/rateLimiter";

export const InitiateWalkin = async (req: Request, res: Response) => {
    try {
        // Validate input
        const validation = initiateWalkinSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Validation Error",
                errors: validation.error.flatten()
            });
        }

        const { phone } = validation.data;

        // Ensure EmployeeCheck middleware has run (req.public_Id should be present)
        if (!req.public_Id) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: Employee session missing"
            });
        }

        // Check if user exists
        let user = await prisma.user.findFirst({
            where: { phone: phone }
        });
        if (user) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "User already exists with this phone number"
            });
        }
        // Create user if not exists
        if (!user) {
            // Check if phone is used by another user (unique constraint might catch this, but phone is default("") so multiple empty allowed, but we are querying by specific phone)
            // Actually, allow creating logic.
            // Note: phone is not unique in schema `phone String @default("")`, so we findFirst. 
            // Ideally should be unique but schema says otherwise for now.
            // Wait, schema says `phone String @default("")`. It's not unique.
            // But for this flow we want to identify unique user by phone. 
            // If multiple users have same phone, this might be issue. 
            // Assuming we take the first one or create new.

            // Create a temporary user or real user?
            // "make an entry in the db in user"
            user = await prisma.user.create({
                data: {
                    publicId: createID(),
                    name: "Walk-in Customer", // Placeholder
                    email: `walkin_${createID()}@temp.com`, // Placeholder, must be unique
                    phone: phone,
                    role: Role.CUSTOMER,
                    authProvider: AuthProvider.PASSWORD,
                    passwordHash: , // No password yet
                }
            });
        }
        // Rate limit OTP
        const allowed1 = await rateLimit(`walkin_otp_send_1min:${user.id}`, 1, 60);
        const allowed2 = await rateLimit(`walkin_otp_send_hour:${user.id}`, 5, 3600);

        if (!allowed1 || !allowed2) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Too many OTP requests. Please try again later."
            });
        }
        // Invalidate old OTPs
        await prisma.emailVerificationOtp.deleteMany({
            where: { userId: user.id }
        });

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        const otpHash = await hashpassword(String(otp));

        // Store OTP
        // Schema: EmailVerificationOtp has `phone` field.
        await prisma.emailVerificationOtp.create({
            data: {
                userId: user.id,
                phone: phone,
                otpHash: otpHash,
                expiresAt: new Date(Date.now() + 1000 * 60 * 5) // 5 minutes
            }
        });
        console.log(`Walkin Initiate Route->[Walkin] OTP for ${phone}: ${otp}`);
        // Send SMS Later Dev Test RemoveDEV
        // const smsResponse = await sendOTP({
        //     mobile: phone,
        //     otp: otp
        // });
        // if (!smsResponse.success) {
        //     // Rollback? Or just fail.
        //     return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
        //         message: "Failed to send OTP SMS"
        //     });
        // }
        return res.status(StatusCode.OK).json({
            message: "OTP sent successfully",
            otp: otp,
            customer_public_id: user.publicId
        });
    } catch (e: any) {
        console.error("Error in InitiateWalkin:", e);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};
