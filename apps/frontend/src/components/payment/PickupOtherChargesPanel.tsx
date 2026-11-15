/**
 * Other charges on the pickup bill (client, Nov 15 2026) — staff add a reason +
 * ₹ amount (several, each removable) that the customer pays with the pickup;
 * no GST, like the drop's other charges. Every add / remove sends the WHOLE set
 * (PUT …/pickup-session/other-charges), which replaces what the bill has, so a
 * double click or a retry never adds a charge twice. Hidden on servers that
 * don't return session.otherCharges.
 */
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/counterErrors";
import { paymentSessionService, type PaymentSession } from "@/services/paymentSession.service";

const LABEL_MAX = 120;
const MAX_LINES = 20;
const AMOUNT_MAX = 500000;

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Digits and one dot with up to 2 decimals. */
const cleanAmount = (text: string) => {
  const digits = text.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = digits.split(".");
  return rest.length === 0 ? whole : `${whole}.${rest.join("").slice(0, 2)}`;
};

function inputError(label: string, amount: string, count: number): string | null {
  if (count >= MAX_LINES) return `Add at most ${MAX_LINES} other charges.`;
  const l = label.trim();
  if (!l) return "Say what the charge is for.";
  if (l.length > LABEL_MAX) return `Keep the reason under ${LABEL_MAX} characters.`;
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return "Enter the amount in ₹ (up to 2 decimals).";
  const n = Number(amount);
  if (!(n > 0)) return "The amount must be more than ₹0.";
  if (n > AMOUNT_MAX) return `The amount can't be more than ₹${AMOUNT_MAX}.`;
  return null;
}

export function PickupOtherChargesPanel({
  bookingPublicId,
  session,
  onUpdated,
}: {
  bookingPublicId: string;
  session: PaymentSession;
  onUpdated: (session: PaymentSession) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.otherCharges === undefined) return null;
  const current = session.otherCharges.map((c) => ({ label: c.label, amount: Number(c.amount) }));

  const save = async (next: { label: string; amount: number }[], onOk?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await paymentSessionService.setPickupSessionOtherCharges(bookingPublicId, next);
      onUpdated(updated);
      onOk?.();
    } catch (err) {
      const message = apiErrorMessage(err, "Could not save the other charges.");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const problem = inputError(label, amount, current.length);
    if (problem) {
      setError(problem);
      return;
    }
    const line = { label: label.trim().replace(/\s+/g, " "), amount: Math.round(Number(amount) * 100) / 100 };
    void save([...current, line], () => {
      setLabel("");
      setAmount("");
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Other charges</p>
          <p className="text-xs text-muted-foreground">Added to what the customer pays now. No GST.</p>
        </div>
        {current.length > 0 && (
          <span className="text-sm font-semibold">{inr(Number(session.otherChargesTotal ?? 0))}</span>
        )}
      </div>
      {current.length > 0 && (
        <ul className="divide-y rounded-md border">
          {session.otherCharges.map((c, i) => (
            <li key={c.publicId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{c.label}</span>
              <span className="font-medium">{inr(Number(c.amount))}</span>
              <button
                type="button"
                className="text-red-600 hover:text-red-700 disabled:opacity-50"
                onClick={() => void save(current.filter((_, j) => j !== i))}
                disabled={busy}
                aria-label={`Remove ${c.label}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="pickup-charge-label" className="text-xs">Reason</Label>
          <Input
            id="pickup-charge-label"
            value={label}
            maxLength={LABEL_MAX}
            placeholder="e.g. Child seat, doorstep delivery"
            onChange={(e) => { setLabel(e.target.value); setError(null); }}
            disabled={busy}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pickup-charge-amount" className="text-xs">Amount (₹)</Label>
          <Input
            id="pickup-charge-amount"
            inputMode="decimal"
            value={amount}
            placeholder="e.g. 250"
            onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            disabled={busy}
          />
        </div>
        <Button type="button" variant="outline" onClick={add} disabled={busy || !label.trim() || !amount}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Add</>}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
