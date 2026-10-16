import {
  PAYMENT_PROOF_MAX_PHOTOS,
  counterProofList,
  withCounterProofAt,
  type CounterProof,
} from "@/lib/counterPayment";
import type { PaymentProofRole } from "@/services/paymentProof.service";
import { PaymentProofField } from "./PaymentProofField";

interface PaymentProofSlotsProps {
  role: PaymentProofRole;
  proof: CounterProof | null;
  extraProofs?: CounterProof[];
  onChange: (next: { proof: CounterProof | null; extraProofs: CounterProof[] }) => void;
  /** Server error about a screenshot, shown at `errorPosition` (1–3; default the first). */
  error?: string | null;
  errorPosition?: number | null;
  /** Helper under screenshot 1 */
  helper?: string;
  disabled?: boolean;
  idPrefix: string;
}

/**
 * UPI payment screenshots (Oct 2026): screenshot 1 is required; 2 and 3 are
 * optional for a customer who paid in several UPI transactions. The next slot
 * appears once the one before it holds a photo; removing one moves the later
 * ones up.
 */
export function PaymentProofSlots({
  role,
  proof,
  extraProofs,
  onChange,
  error,
  errorPosition,
  helper,
  disabled,
  idPrefix,
}: PaymentProofSlotsProps) {
  const list = counterProofList({ proof, extraProofs });
  const shown = Math.min(PAYMENT_PROOF_MAX_PHOTOS, list.length + 1);
  const errorAt = errorPosition && errorPosition >= 1 && errorPosition <= shown ? errorPosition : 1;

  return (
    <div className="space-y-3">
      {Array.from({ length: shown }, (_, i) => (
        <PaymentProofField
          key={i}
          id={i === 0 ? `${idPrefix}-proof` : `${idPrefix}-proof-${i + 1}`}
          role={role}
          value={list[i] ?? null}
          onChange={(next) => onChange(withCounterProofAt({ proof, extraProofs }, i, next))}
          error={errorAt === i + 1 ? error : null}
          required={i === 0}
          label={`Payment screenshot ${i + 1}`}
          helper={
            i === 0
              ? helper
              : "If the customer paid in more than one UPI transaction, photograph this one too."
          }
          disabled={disabled}
        />
      ))}
    </div>
  );
}
