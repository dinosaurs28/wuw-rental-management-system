import { z } from "zod";

/**
 * Fields a customer profile needs before any booking (customer self-serve or
 * staff counter). The backend reports the empty ones as `missingFields`.
 *
 * Oct 2026 (client batch): the Driving Licence number, Aadhaar number and
 * date of birth are no longer asked for when a customer completes their
 * profile — an age is. "age" is met by a stored age, a stored date of birth
 * (customers from before the change), or both identity numbers (a profile
 * completed under the earlier rules, or sent by an old app build that can't
 * send an age). Staff still record the DL number at pickup.
 */
export const CUSTOMER_PROFILE_REQUIRED_FIELDS = [
    "name",
    "phone",
    "addressLine1",
    "city",
    "state",
    "zipCode",
    "country",
    "age",
] as const;

export type CustomerProfileField = (typeof CUSTOMER_PROFILE_REQUIRED_FIELDS)[number];

export const CUSTOMER_PROFILE_FIELD_LABELS: Record<CustomerProfileField, string> = {
    name: "name",
    phone: "phone number",
    addressLine1: "address",
    city: "city",
    state: "state",
    zipCode: "PIN code",
    country: "country",
    age: "age",
};

// ── Age (replaces the date of birth on the profile form) ─────────────────────

export const MIN_CUSTOMER_AGE = 18;
export const MAX_CUSTOMER_AGE = 99;
export const AGE_REQUIRED_MESSAGE = "Age is required";
export const AGE_INVALID_MESSAGE = "Enter your age in years";
export const AGE_UNDER_MIN_MESSAGE = "You must be 18 or older to rent.";
export const AGE_OVER_MAX_MESSAGE = "Enter a valid age";

/** Age as typed (number or numeric string) → a whole number of years, 18–99. */
export const customerAgeSchema = z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v.trim()) : v),
    z
        .number({ required_error: AGE_REQUIRED_MESSAGE, invalid_type_error: AGE_INVALID_MESSAGE })
        .int(AGE_INVALID_MESSAGE)
        .min(MIN_CUSTOMER_AGE, AGE_UNDER_MIN_MESSAGE)
        .max(MAX_CUSTOMER_AGE, AGE_OVER_MAX_MESSAGE),
);

/** null when fine, else the message — for forms that don't use zod. */
export function customerAgeError(value: unknown): string | null {
    const r = customerAgeSchema.safeParse(value);
    return r.success ? null : (r.error.errors[0]?.message ?? AGE_INVALID_MESSAGE);
}

/**
 * Whole years from a stored date of birth ("YYYY-MM-DD" or any Date-parsable
 * string) to `now`; null when missing, unparsable or in the future.
 */
export function ageFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
    const raw = String(dob ?? "").trim();
    if (!raw) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    const birth = m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
    let y: number, mo: number, d: number;
    if (birth) {
        ({ y, mo, d } = birth);
    } else {
        const parsed = new Date(raw);
        if (isNaN(parsed.getTime())) return null;
        y = parsed.getFullYear();
        mo = parsed.getMonth() + 1;
        d = parsed.getDate();
    }
    let age = now.getFullYear() - y;
    const nm = now.getMonth() + 1;
    if (nm < mo || (nm === mo && now.getDate() < d)) age -= 1;
    return Number.isFinite(age) && age >= 0 && age < 150 ? age : null;
}

/** The age to show staff: the stored age, else one derived from the date of birth. */
export function effectiveCustomerAge(
    customer: { age?: number | null; dob?: string | null } | null | undefined,
    now: Date = new Date(),
): number | null {
    if (!customer) return null;
    if (typeof customer.age === "number" && Number.isFinite(customer.age)) return customer.age;
    return ageFromDob(customer.dob, now);
}

/**
 * Is the profile's "age" requirement met: a stored age, a date of birth, or —
 * for profiles completed under the earlier rules / old app builds — both the
 * Driving Licence and Aadhaar numbers.
 */
export function hasCustomerAgeRequirement(source: {
    age?: number | null;
    dob?: string | null;
    drivingLicenceNumber?: string | null;
    aadhaarNumber?: string | null;
}): boolean {
    if (effectiveCustomerAge(source) !== null) return true;
    return !!String(source.drivingLicenceNumber ?? "").trim() && !!String(source.aadhaarNumber ?? "").trim();
}

/** Customer profile form (web; mobile mirrors it). No DL / Aadhaar / date of birth. */
export const updateProfileSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits"),
    age: customerAgeSchema,
    addressLine1: z.string().min(1, "Address Line 1 is required"),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State is required"),
    country: z.string().min(1, "Country is required"),
    zipCode: z.string().min(1, "Zip Code is required"),
    alternatePhone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits").optional().or(z.literal("")),
});

/** Date of birth as old app builds send it ("" allowed); must be 18+ when given. */
export const legacyDobSchema = z.string().refine((val) => {
    if (!val) return true;
    const birthDate = new Date(val);
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    return birthDate <= eighteenYearsAgo;
}, "User must be at least 18 years old");

export const createEmployeeSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Please enter a valid email address"),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(10, "Phone number must be at most 10 digits"),
    password: z.string().min(8, "Password must be at least 4 characters long"),
});

export const updateEmployeeSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Please enter a valid email address"),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
