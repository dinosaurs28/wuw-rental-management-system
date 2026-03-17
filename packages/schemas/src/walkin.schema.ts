import z from "zod";

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
  email: z.string().email("Invalid email address"),
  alternatePhone: z.string().optional(),
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
