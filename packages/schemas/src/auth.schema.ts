import z from "zod";
import { email } from "zod/v4";


export const emailAuthSchema=z.object({
name: z.string().min(1, "Name is required"),
    email: z.string().email({ message: "Please enter a valid email address" }),
    password: z.string()
        .min(6, "Password must be at least 6 characters long")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
})

