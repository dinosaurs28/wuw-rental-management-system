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

/**
 * Clearing credit records the money as a PaymentTransaction (#11):
 *  - CASH
 *  - UPI (ONLINE is the older name for it): a photo of the customer's payment
 *    screen (`proof_file_id`, from POST /branchManager/payment/proof) or the
 *    12-digit UTR in `transactionRef`
 *  - SPLIT: `cashAmount` + `onlineAmount` (must add up to the sections cleared)
 *    with the UPI part backed like UPI above
 */
export const clearCreditSchema = z
  .object({
    sectionKeys: z.array(z.string().min(1)).min(1, "At least one section must be selected"),
    paymentMethod: z.enum(["CASH", "ONLINE", "UPI", "SPLIT"]),
    transactionRef: z.string().optional(),
    proof_file_id: z.string().trim().min(1).max(64).optional(),
    cashAmount: z.number().min(0).optional(),
    onlineAmount: z.number().min(0).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (data) =>
      data.paymentMethod === "CASH" ||
      !!data.proof_file_id ||
      (!!data.transactionRef && data.transactionRef.trim().length > 0),
    {
      message: "Add a photo of the customer's UPI payment-success screen (or the 12-digit UTR)",
      path: ["proof_file_id"],
    }
  )
  .refine(
    (data) =>
      data.paymentMethod !== "SPLIT" ||
      ((data.cashAmount ?? 0) > 0 && (data.onlineAmount ?? 0) > 0),
    { message: "Enter both the cash and the UPI part of a split payment", path: ["cashAmount"] }
  );

export type SearchCustomersInput = z.infer<typeof searchCustomersSchema>;
export type GetCustomerEntriesInput = z.infer<typeof getCustomerEntriesSchema>;
export type AddCreditInput = z.infer<typeof addCreditSchema>;
export type ClearCreditInput = z.infer<typeof clearCreditSchema>;
