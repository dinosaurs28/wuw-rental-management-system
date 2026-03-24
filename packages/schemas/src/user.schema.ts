import { z } from "zod";

export const updateProfileSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits"),
    dob: z.string().refine((val) => {
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
    alternatePhone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits").optional().or(z.literal("")),
});

export const createEmployeeSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits"),
    password: z.string().min(8, "Password must be at least 4 characters long"),
});

export const updateEmployeeSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
