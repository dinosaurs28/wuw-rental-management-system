import { AlertTriangle, CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FastagBeforeDrop, FastagUsageSummary } from "@/types/drop";
import { fastagInr, readFastagBalance } from "./fastag";

const RECHARGED_NOTE = "FASTag balance went up (recharged?) — no charge for that part.";

interface FastagReturnFieldProps {
  /**
   * booking.fastag — the balance now is asked for whenever the car coming back
   * counts as a FASTag car (currentHasFastag); the usage only in READINGS mode
   */
  info: FastagBeforeDrop;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Without a drop bill the usage is recorded for the branch manager to collect. */
  billedOnDropBill: boolean;
  /** Replaces the line on how the usage is billed (Edit Return). */
  note?: string;
}

/**
 * FASTag balance at the drop (Oct 15 2026), asked for whenever the car coming
 * back counts as a FASTag car (marked, or its balance read at pickup / the
 * swap). With every earlier reading present the usage since pickup (summed
 * across mid-rental swaps) is charged from the balances — the typed toll charge
 * is not used; otherwise the balance is recorded and the toll charge is typed.
 * Swapped onto a car without a FASTag: the usage is already known and needs no input.
 */
export function FastagReturnField({ info, value, onChange, disabled, billedOnDropBill, note }: FastagReturnFieldProps) {
  if (info.mode !== "READINGS" && !info.currentHasFastag) return null;
  const readings = info.mode === "READINGS";
  const prior = Number(info.priorUsage) || 0;
  const billedNote = note ?? (billedOnDropBill
    ? "Added to the drop bill when you compute the charges (no GST)."
    : "Recorded when you complete the return (no GST) — the branch manager collects it at settlement.");

  if (!info.currentHasFastag) {
    if (prior <= 0 && !info.priorRecharged) return null;
    return (
      <div className="space-y-1.5 p-4 rounded-lg border bg-green-50/40 border-green-200">
        <p className="text-sm font-semibold flex items-center gap-2 text-green-900">
          <CreditCard className="h-4 w-4" /> FASTag usage
        </p>
        <p className="text-sm text-gray-800">
          On the swapped-out vehicle{info.swapCount > 1 ? "s" : ""}: <strong>{fastagInr(prior)}</strong>
        </p>
        {info.priorRecharged && <p className="text-xs text-amber-700">{RECHARGED_NOTE}</p>}
        <p className="text-xs text-green-900/80">{billedNote}</p>
      </div>
    );
  }

  const read = readFastagBalance(value);
  const start = info.currentStartBalance != null ? Number(info.currentStartBalance) : null;
  // Same formula as the server: earlier cars' usage + max(0, start − now)
  const usage = readings && read.value != null && start != null ? prior + Math.max(0, start - read.value) : null;
  const recharged = readings && ((read.value != null && start != null && read.value > start) || info.priorRecharged);

  return (
    <div className="space-y-2 p-4 rounded-lg border bg-green-50/40 border-green-200">
      <Label htmlFor="returnFastagBalance" className="text-sm font-semibold flex items-center gap-2 text-green-900">
        <CreditCard className="h-4 w-4" /> FASTag balance now (₹)
      </Label>
      {start != null && (
        <p className="text-xs text-muted-foreground">
          {info.swapCount > 0 ? "At the swap (this vehicle)" : "At pickup"}:{" "}
          <span className="font-medium text-foreground">{fastagInr(start)}</span>
          {prior > 0 && (
            <> · used on the swapped-out vehicle{info.swapCount > 1 ? "s" : ""}: <span className="font-medium text-foreground">{fastagInr(prior)}</span></>
          )}
        </p>
      )}
      <div className="relative max-w-xs">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
        <Input
          id="returnFastagBalance"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className="pl-7 h-10"
          placeholder="e.g. 215"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      {value.trim() !== "" && read.error ? (
        <p className="text-xs text-red-500">{read.error}</p>
      ) : usage != null ? (
        <p className="text-sm text-gray-800">
          FASTag usage: <strong>{fastagInr(usage)}</strong>
        </p>
      ) : null}
      {recharged && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {RECHARGED_NOTE}
        </p>
      )}
      <p className="text-xs text-green-900/80">
        {readings
          ? billedNote
          : `No balance was recorded ${info.swapCount > 0 ? "for an earlier car" : "at pickup"}, so the usage can't be worked out — the balance is kept and any toll charge is typed below.`}
      </p>
    </div>
  );
}

/** Under the drop bill: each car's readings after swaps, and the recharge note. */
export function FastagUsageNotes({ fastag }: { fastag: FastagUsageSummary | null | undefined }) {
  if (!fastag || fastag.status !== "COMPUTED") return null;
  const tagged = fastag.legs.filter((l) => l.hasFastag);
  if (tagged.length <= 1 && fastag.notes.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-green-200 bg-green-50/40 p-3 text-xs text-gray-700">
      {tagged.length > 1 &&
        tagged.map((l, i) => (
          <p key={`${l.regNo}-${i}`}>
            FASTag {l.regNo}: {fastagInr(l.startBalance)} → {fastagInr(l.endBalance)}
            {l.recharged ? " (recharged — no charge)" : ` = ${fastagInr(l.usage)}`}
          </p>
        ))}
      {fastag.notes.map((n) => (
        <p key={n} className="text-amber-700">{n}</p>
      ))}
    </div>
  );
}
