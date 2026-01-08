import { z } from "zod";

export const updateProfileSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
    dob: z.string().optional(),
    gender: z.string().optional(),
    addressLine1: z.string().min(1, "Address Line 1 is required"),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State is required"),
    country: z.string().min(1, "Country is required"),
    zipCode: z.string().min(1, "Zip Code is required"),
    alternatePhone: z.string().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
