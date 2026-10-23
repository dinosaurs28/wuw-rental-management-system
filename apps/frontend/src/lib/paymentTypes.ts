// The six payment types of the Branch Manager Financials view (Oct 2026).
// The backend decides which type(s) a payment is (apps/backend/src/services/financials/payment-type.ts:
// a drop payment is split over its late fee / extras / damage lines), so the frontend only labels.

export type ClientPaymentType =
  | "RENT"
  | "SECURITY_DEPOSIT"
  | "EXTENSION_FEE"
  | "LATE_FEE"
  | "EXTRA_CHARGES"
  | "DAMAGES";

export const PAYMENT_TYPE_ORDER: ClientPaymentType[] = [
  "RENT",
  "SECURITY_DEPOSIT",
  "EXTENSION_FEE",
  "LATE_FEE",
  "EXTRA_CHARGES",
  "DAMAGES",
];

export const PAYMENT_TYPE_LABELS: Record<ClientPaymentType, string> = {
  RENT: "Rent",
  SECURITY_DEPOSIT: "Security deposit",
  EXTENSION_FEE: "Extension fee",
  LATE_FEE: "Late fee",
  EXTRA_CHARGES: "Extra charges",
  DAMAGES: "Damages",
};

export interface PaymentAllocation {
  type: ClientPaymentType;
  amount: number;
  cash: number;
  online: number;
}

/** "Late fee + Extra charges" for a payment split over several types. */
export const formatPaymentTypes = (allocs: readonly Pick<PaymentAllocation, "type">[]): string =>
  [...new Set(allocs.map((a) => a.type))]
    .sort((a, b) => PAYMENT_TYPE_ORDER.indexOf(a) - PAYMENT_TYPE_ORDER.indexOf(b))
    .map((t) => PAYMENT_TYPE_LABELS[t])
    .join(" + ");

export type PaymentModeKey = "CASH" | "UPI" | "GATEWAY";

export const PAYMENT_MODE_LABELS: Record<PaymentModeKey, string> = {
  CASH: "Cash",
  UPI: "UPI",
  GATEWAY: "Online (gateway)",
};
