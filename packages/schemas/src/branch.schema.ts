import { z } from "zod";

export const createBranchSchema = z.object({
    name: z.string().min(1, "Branch name is required"),
    address: z.string().min(1, "Address is required"),
    phone: z.string().optional(),
    managerName: z.string().min(1, "Manager name is required"),
    managerEmail: z.string().email("Invalid manager email"),
    managerPassword: z.string().min(6, "Password must be at least 6 characters"),

});

export const gstRuleSchema = z.object({
    gstNumber: z.string().min(1, "GST Number is required"),
    cgstRate: z.number().min(0, "CGST Rate must be positive"),
    sgstRate: z.number().min(0, "SGST Rate must be positive"),
    igstRate: z.number().min(0, "IGST Rate must be positive").optional().default(0),
});


export const editBranchSchema = createBranchSchema.partial();

/** ISO weekdays, Monday first — the weekend-days picker's order and labels. */
export const ISO_WEEKDAYS = [
    { value: 1, short: "Mon" },
    { value: 2, short: "Tue" },
    { value: 3, short: "Wed" },
    { value: 4, short: "Thu" },
    { value: 5, short: "Fri" },
    { value: 6, short: "Sat" },
    { value: 7, short: "Sun" },
] as const;

/** Branch.weekendDays' default: Saturday + Sunday. */
export const DEFAULT_WEEKEND_DAYS = [6, 7] as const;

/**
 * The days a branch bills at the weekend rents (weekend-wise pricing): 0–7
 * distinct ISO weekdays (1 = Mon … 7 = Sun). Empty = no weekend rates.
 */
export const branchWeekendDaysSchema = z.object({
    weekendDays: z
        .array(z.number().int().min(1, "Pick days from Monday to Sunday").max(7, "Pick days from Monday to Sunday"))
        .max(7)
        .refine((days) => new Set(days).size === days.length, "Each day can be picked once"),
});
