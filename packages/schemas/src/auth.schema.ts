import z from "zod";

export const emailAuthSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(
      /[^a-zA-Z0-9]/,
      "Password must contain at least one special character",
    ),
});

export const emailAuthSchemaSignin = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z.string().min(1, "Password must be at least 1 characters long"),
});

export const otpSchema = z.object({
  otp: z
    .string()
    .min(6, "OTP must be exactly 6 digits")
    .max(6, "OTP must be exactly 6 digits")
    .regex(/^\d+$/, "OTP must only contain numbers"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
});

// Account deletion (Google Play "Data deletion" policy requirement).
// `password` is only required for PASSWORD-provider accounts — Google-linked
// accounts have no passwordHash, so the typed confirmation is the sole gate.
export const deleteAccountSchema = z.object({
  confirmText: z.literal("DELETE", {
    errorMap: () => ({ message: 'Type DELETE exactly to confirm' }),
  }),
  password: z.string().min(1, "Password is required").optional(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  otp: z
    .string()
    .min(6, "OTP must be exactly 6 digits")
    .max(6, "OTP must be exactly 6 digits")
    .regex(/^\d+$/, "OTP must only contain numbers"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(
      /[^a-zA-Z0-9]/,
      "Password must contain at least one special character",
    ),
});
