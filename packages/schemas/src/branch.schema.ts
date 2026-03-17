import { z } from "zod";

export const createBranchSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  address: z.string().min(1, "Address is required"),
  phone: z.string().optional(),
  managerName: z.string().min(1, "Manager name is required"),
  managerEmail: z.string().email("Invalid manager email"),
});

export const gstRuleSchema = z.object({
  gstNumber: z.string().min(1, "GST Number is required"),
  cgstRate: z.number().min(0, "CGST Rate must be positive"),
  sgstRate: z.number().min(0, "SGST Rate must be positive"),
  igstRate: z
    .number()
    .min(0, "IGST Rate must be positive")
    .optional()
    .default(0),
});

export const editBranchSchema = createBranchSchema.partial();
