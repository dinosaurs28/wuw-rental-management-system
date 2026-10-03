import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiErrorMessage, counterErrorCode } from "@/lib/counterErrors";
import {
  counterFieldErrors,
  counterMethodTakesMoney,
  counterPaymentErrorField,
  counterPaymentProblem,
  emptyCounterPayment,
  formatRupees,
  remainingPaymentFields,
  type CounterPaymentValue,
} from "@/lib/counterPayment";
import { bookingService } from "@/services/booking.service";
import { usePaymentStore } from "@/store/payment.store";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import { CounterPaymentFields } from "./CounterPaymentFields";

interface LegacyRemainingPaymentCardProps {
  bookingPublicId: string;
  /** Pickup or drop counter — recorded as paid during PICKUP / RETURN. */
  context: "pickup" | "return";
  /** Booking.remainingBalance (2-dp string). */
  remainingBalance: string;
  /** Collected or put on credit — the parent refreshes the booking. */
  onSettled: () => void;
}

/**
 * Advance bookings at a branch without Unified Payments: the balance has to be
 * settled at the counter before the handover / return goes through (the server
 * answers 402 otherwise). Cash, UPI (photo), Split or Credit (#3, #11).
 */
export function LegacyRemainingPaymentCard({
  bookingPublicId,
  context,
  remainingBalance,
  onSettled,
}: LegacyRemainingPaymentCardProps) {
  const [payment, setPayment] = useState<CounterPaymentValue>(() => emptyCounterPayment());
  const { needsShift } = useActiveShift();
  const amount = parseFloat(remainingBalance) || 0;

  const mutation = useMutation({
    mutationFn: () =>
      bookingService.initiateRemainingPayment(bookingPublicId, context, remainingPaymentFields(payment, amount)),
    onSuccess: (res) => {
      toast.success(res.message || "Remaining balance settled.");
      onSettled();
    },
    onError: (err) => {
      if (counterErrorCode(err) === "SHIFT_REQUIRED") usePaymentStore.getState().setActiveShift(null);
    },
  });

  const error = mutation.error;
  const errorField = counterPaymentErrorField(error);
  const shiftRequired =
    counterMethodTakesMoney(payment.method) &&
    (needsShift || counterErrorCode(error) === "SHIFT_REQUIRED");
  const problem = counterPaymentProblem(payment, amount);

  return (
    <div className="rounded-lg border border-orange-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <Wallet className="h-4 w-4 text-orange-500" />
          Remaining rental balance
        </span>
        <span className="text-lg font-bold text-neutral-900">{formatRupees(amount)}</span>
      </div>
      <div className="space-y-4 px-4 py-4">
        <p className="text-xs text-neutral-500">
          The customer paid an advance online. Settle the rest before {context === "pickup" ? "handing over the vehicle" : "completing the return"}.
        </p>
        <CounterPaymentFields
          idPrefix={`remaining-${context}`}
          value={payment}
          onChange={setPayment}
          amount={amount}
          proofRole="staff"
          errors={counterFieldErrors(error)}
          onEdit={() => {
            if (mutation.error) mutation.reset();
          }}
          disabled={mutation.isPending}
          cashNote={
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              The branch manager confirms the cash from your shift.
            </p>
          }
        />
        {shiftRequired ? (
          <ShiftRequiredNotice onShiftOpened={() => mutation.reset()} />
        ) : (
          !!error &&
          !errorField && <p className="text-sm text-destructive">{apiErrorMessage(error, "Couldn't record the payment. Try again.")}</p>
        )}
        <Button
          type="button"
          className="w-full bg-orange-500 text-white hover:bg-orange-600"
          disabled={mutation.isPending || shiftRequired || !!problem}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {payment.method === "CREDIT"
            ? `Put ${formatRupees(amount)} on credit`
            : `Record ${formatRupees(amount)} (${payment.method === "SPLIT" ? "Split" : payment.method === "UPI" ? "UPI" : "Cash"})`}
        </Button>
        {problem && !shiftRequired && (payment.method !== "SPLIT" || payment.splitCash !== "") && (
          <p className="text-center text-xs text-muted-foreground">{problem}</p>
        )}
      </div>
    </div>
  );
}
