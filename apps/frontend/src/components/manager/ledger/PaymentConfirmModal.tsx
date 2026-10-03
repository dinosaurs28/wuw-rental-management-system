import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  counterFieldErrors,
  counterPaymentErrorField,
  counterPaymentProblem,
  emptyCounterPayment,
  type CounterPaymentValue,
} from "@/lib/counterPayment";
import { CounterPaymentFields } from "@/components/payment/counter/CounterPaymentFields";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Cash, UPI (photo of the customer's payment screen) or Split (#3 / #11). */
  onConfirm: (payment: CounterPaymentValue) => void;
  loading: boolean;
  totalAmount: number;
  /** The last clearance attempt's error — shown at its field or below. */
  error?: unknown;
  /** Staff changed the payment — clear an error that referred to the old input. */
  onEdit?: () => void;
}

export function PaymentConfirmModal({ open, onClose, ...formProps }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {/* Mounted only while open, so each opening starts with a fresh form */}
        <PaymentConfirmForm onClose={onClose} {...formProps} />
      </DialogContent>
    </Dialog>
  );
}

function PaymentConfirmForm({
  onClose,
  onConfirm,
  loading,
  totalAmount,
  error,
  onEdit,
}: Omit<Props, "open">) {
  const [payment, setPayment] = useState<CounterPaymentValue>(() => emptyCounterPayment());

  const problem = counterPaymentProblem(payment, totalAmount);
  const generalError = !!error && !counterPaymentErrorField(error);

  function handleConfirm() {
    if (problem) return;
    onConfirm(payment);
  }

  function formatAmount(val: number) {
    return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Confirm Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 text-center">
            <p className="text-xs text-orange-600 mb-0.5">Amount to clear</p>
            <p className="text-2xl font-bold text-orange-700">{formatAmount(totalAmount)}</p>
          </div>

          {/* Clearing records the payment, so a credit can't be cleared on credit */}
          <CounterPaymentFields
            idPrefix="clear-credit"
            value={payment}
            onChange={setPayment}
            amount={totalAmount}
            proofRole="manager"
            methods={["CASH", "UPI", "SPLIT"]}
            errors={counterFieldErrors(error)}
            onEdit={onEdit}
            disabled={loading}
            cashNote={
              <p className="text-xs text-zinc-500">
                Recorded on your open cash shift, if you have one.
              </p>
            }
          />

          {generalError && (
            <p className="text-sm text-destructive">{apiErrorMessage(error, "Failed to clear credit")}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!!problem || loading}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirm & Clear
          </Button>
        </DialogFooter>
    </>
  );
}
