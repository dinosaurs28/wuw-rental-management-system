import z from "zod";
import { optionalAadhaarNumberSchema, optionalDrivingLicenceNumberSchema } from "./identity.js";
import { customerAgeSchema } from "./user.schema.js";

/** Email for staff walk-in forms: optional, but must be valid when filled in. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "Invalid email address")
  .optional();

export const initiateWalkinSchema = z.object({
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number must be at most 15 digits")
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format"),
});

export const verifyWalkinOtpSchema = z.object({
  customer_public_id: z.string().min(1, "Customer Public ID is required"),
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d+$/, "OTP must only contain numbers"),
});

export const completeWalkinProfileSchema = z.object({
  customer_public_id: z.string().min(1, "Customer Public ID is required"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  // Optional for walk-ins (#1): blank keeps the stored email (or placeholder).
  email: optionalEmailSchema,
  // Optional since Oct 2026 (the DL number is taken at pickup); validated when filled in.
  drivingLicenceNumber: optionalDrivingLicenceNumberSchema,
  aadhaarNumber: optionalAadhaarNumberSchema,
  // Replaces the date of birth on the form (Oct 2026). The server still
  // accepts a body without it (old staff builds).
  age: customerAgeSchema,
  alternatePhone: z.string().optional(),
  // Old staff builds only; new forms send `age`.
  dob: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      const birthDate = new Date(val);
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      return birthDate <= eighteenYearsAgo;
    }, "User must be at least 18 years old"),
  addressLine1: z.string().min(1, "Address Line 1 is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  country: z.string().min(1, "Country is required"),
  zipCode: z.string().min(1, "Zip Code is required"),
  gender: z.string().optional(),
});
