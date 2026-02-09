import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import { completeWalkinProfileSchema } from "@repo/schemas";
import { hashpassword } from "../../../utils/PasswordCrypt/password.js";
import { createID } from "../../../utils/nanoID.js";

export const CompleteWalkinProfile = async (req: Request, res: Response) => {
    try {
        const validation = completeWalkinProfileSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Validation Error",
                errors: validation.error.flatten()
            });
        }

        const { customer_public_id, name, email, addressLine1,dob,alternatePhone,city, state, zipCode, country, gender } = validation.data;

        // Ensure Employee Check
        if (!req.public_Id) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: Employee session missing"
            });
        }

        const user = await prisma.user.findUnique({
            where: { publicId: customer_public_id },
            include: { customerProfile: true }
        });

        if (!user) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "User not found"
            });
        }

        // Check if verified (OTP step done)
        if (!user.emailVerifiedAt) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "User verification pending. Please complete OTP verification first."
            });
        }

        // Generate Random Password
        const randomPassword = Math.random().toString(36).slice(-8); // 8 char random string
        const passwordHash = await hashpassword(randomPassword);

        // Update User
        await prisma.user.update({
            where: { id: user.id },
            data: {
                name: name,
                email: email, // If email is changed/provided
                passwordHash: passwordHash,
                // Create or update customer profile
                customerProfile: {
                    upsert: {
                        create: {
                            publicId: createID(),
                            addressLine1: addressLine1 || "",
                            alternatePhone: alternatePhone || "",
                            country: country || "",
                            dob: dob || "",
                            city: city || "",
                            state: state || "",
                            zipCode: zipCode || "",
                            isProfileCompleted: true // Basic details done
                        },
                        update: {
                            addressLine1: addressLine1 || "",
                            city: city || "",
                            state: state || "",
                            zipCode: zipCode || "",
                            isProfileCompleted: true
                        }
                    }
                }
            }
        });

        // We might want to return the password to the employee to share? Or email it?
        // User request: "password would be random generate on the backend side with hash. later the user will reset the password."
        // Doesn't explicitly say "return it". But employee might need it? 
        // Security risk to return it. Maybe user uses phone OTP mainly?
        // If "later user will reset", maybe they use "Forgot Password" flow via phone/email?
        // I won't return it unless asked.

        return res.status(StatusCode.OK).json({
            message: "Profile completed successfully"
        });

    } catch (e: any) {
        console.error("Error in CompleteWalkinProfile:", e);
        // Handle unique constraint error (e.g. duplicate email)
        if (e.code === 'P2002') {
            return res.status(StatusCode.CONFLICT).json({
                message: "Email already exists"
            });
        }
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};
