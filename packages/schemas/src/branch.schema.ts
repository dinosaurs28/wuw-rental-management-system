import { z } from "zod";

export const createBranchSchema = z.object({
    name: z.string().min(1, "Branch name is required"),
    address: z.string().min(1, "Address is required"),
    phone: z.string().optional(),
    managerName: z.string().min(1, "Manager name is required"),
    managerEmail: z.string().email("Invalid manager email"),
    managerPassword: z.string().min(6, "Password must be at least 6 characters")
});
