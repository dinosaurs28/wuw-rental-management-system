import { z } from "zod";

export const searchCustomersSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const getCustomerEntriesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const addCreditSectionSchema = z.object({
  sectionKey: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().positive(),
});

export const addCreditSchema = z.object({
  sections: z.array(addCreditSectionSchema).min(1, "At least one section is required"),
});

export const clearCreditSchema = z
  .object({
    sectionKeys: z.array(z.string().min(1)).min(1, "At least one section must be selected"),
    paymentMethod: z.enum(["CASH", "ONLINE"]),
    transactionRef: z.string().optional(),
  })
  .refine(
    (data) => data.paymentMethod !== "ONLINE" || (data.transactionRef && data.transactionRef.trim().length > 0),
    { message: "Transaction reference is required for online payments", path: ["transactionRef"] }
  );

export type SearchCustomersInput = z.infer<typeof searchCustomersSchema>;
export type GetCustomerEntriesInput = z.infer<typeof getCustomerEntriesSchema>;
export type AddCreditInput = z.infer<typeof addCreditSchema>;
export type ClearCreditInput = z.infer<typeof clearCreditSchema>;
