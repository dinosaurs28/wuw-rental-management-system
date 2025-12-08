import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode"
import { Request, Response } from "express"
import { rateLimit } from "../../utils/rateLimiter";
import { comparehash, hashpassword } from "../../utils/PasswordCrypt/password";
import { sendOTPEmail } from "../../services/email/emailservice";
import { otpSchema } from "@repo/schemas";
import { jwtsign } from "../../utils/token/tokensign.utlis";
export const generateemailotp = async (req: Request, res: Response) => {
    try {
        const publicId = req.cookies.verifySession;
        if (!publicId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "The Public ID is Missing"
            })
        }
        const response = await prisma.user.findUnique({
            where: {
                publicId: publicId
            }
        })
        if (!response) {
            return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
                message: "The Public Id is Either Invalid Or Please Sign Up"
            })
        }
        const allowed1 = await rateLimit(`otp_send_1min:${response.id}`, 1, 60);
        const allowed2 = await rateLimit(`otp_send_hour:${response.id}`, 5, 3600);
        await prisma.emailVerificationOtp.deleteMany({
            where: { userId: response.id }
        });
        if (!allowed1 || !allowed2) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Too many OTP requests. Please try again later."
            });
        }
        const otp = Math.floor(100000 + Math.random() * 900000);

        await prisma.emailVerificationOtp.create({
            data: {
                email: response.email,
                userId: response.id,
                otpHash: await hashpassword(String(otp)),
                expiresAt: new Date(Date.now() + 1000 * 60 * 5)
            }
        });
        // temp fix due domain not available 
        console.log("the otp is",otp)
        return res.status(StatusCode.OK).json(
            { message: "OTP sent successfully." });
    } catch (e: any) {
        console.log("Internal Error Occured While Generating the Otp", e)
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal error While Generating the Otp"
        })
    }
}

export const emailverify = async (req: Request, res: Response) => {
    try {
        const parsedopt = otpSchema.safeParse(req.body)
        const publicId = req.cookies.verifySession
        if (!parsedopt.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: parsedopt.error.flatten()
            })
        }
        if (!publicId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "The Public ID is Missing"
            })
        }
        const user = await prisma.user.findUnique({
            where: {
                publicId: publicId
            }
        })
        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "User does not exist."
            })
        }
        const allowed = await rateLimit(`otp_verify:${user.id}`, 5, 3600);
        if (!allowed) {
            return res.status(StatusCode.BAD_REQUEST).json({ message: "Too many attempts." });
        }
        const response = await prisma.emailVerificationOtp.findUnique({
            where: {
                userId: user.id
            }
        })
        if (!response) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "The Public Id is Either Invalid Or Please Sign Up"
            })
        }
        if (response.expiresAt < new Date()) {
            return res.status(400).json({ message: "OTP expired." });
        }
        const comaprehashotp = await comparehash(String(parsedopt.data.otp), response.otpHash)
        if (!comaprehashotp) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Incorrect Otp! Please try Again"
            })
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date() }
        });
        await prisma.emailVerificationOtp.deleteMany({
            where: {
                userId: user.id
            }
        })
        const token = await jwtsign({ sub: user.publicId, role: user.role, verified: true, provider: user.authProvider })
        return res.status(StatusCode.OK).cookie("accessToken", token, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
        }).clearCookie("verifySession").json({
            message: "OTP validated successfully"
        })
    } catch (e: any) {
        console.log("Internal Error Occured While Verifying the Otp", e)
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal error While Verifying the Otp"
        })
    }
}