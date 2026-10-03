import { useState } from "react";
import { AlarmClock, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { LateChargePreview, LateReturnStatus, RentalTimeline, ReturnLateSummary } from "@/types/drop";
import { formatDuration, formatIstDateTime, formatIstTime, formatRate, inr } from "./dropFormat";

export interface LateReturnOptions {
  /** MANUAL grace only: staff ticked "Apply grace". */
  applyGrace: boolean;
  /** Staff waived the automatic late charge (the reason is audit-logged). */
  waiver: { reason: string } | null;
}

interface LateReturnPanelProps {
  /** Booking (or last compute's) rental timeline — the preview before a bill exists. */
  timeline: RentalTimeline;
  /** The late line as the server billed it (drop-bill compute); null before compute. */
  billed: ReturnLateSummary | null;
  options: LateReturnOptions;
  onOptionsChange: (next: LateReturnOptions) => void;
  /**
   * "drop-bill" = added to this drop's bill (Unified Payments branches);
   * "branch-manager" = recorded at completion, collected by the manager (legacy).
   */
  collection: "drop-bill" | "branch-manager";
  readOnly?: boolean;
  isPending?: boolean;
  /** Server message, e.g. LATE_RATE_UNAVAILABLE. */
  error?: string | null;
}

const STATUS_BADGE: Record<LateReturnStatus, { label: string; className: string }> = {
  ON_TIME: { label: "On time", className: "bg-green-50 text-green-700 border-green-200" },
  WITHIN_GRACE: { label: "Within grace", className: "bg-green-50 text-green-700 border-green-200" },
  CHARGED: { label: "Charged", className: "bg-red-50 text-red-700 border-red-200" },
  WAIVED: { label: "Waived", className: "bg-gray-50 text-gray-600 border-gray-200" },
  DISABLED: { label: "Not charged", className: "bg-gray-50 text-gray-600 border-gray-200" },
  RATE_UNAVAILABLE: { label: "No rate set", className: "bg-amber-50 text-amber-800 border-amber-200" },
};

/** The billed late line in the preview's shape. */
function billedAsPreview(late: ReturnLateSummary): LateChargePreview {
  return {
    hours: late.hours,
    rate: late.rate,
    taxable: late.taxable,
    cgst: late.cgst,
    sgst: late.sgst,
    gst: late.gst,
    gstRate: late.gstRate,
    total: late.total,
    status: late.status,
    graceApplied: late.graceApplied,
    gstUnavailableReason: null,
  };
}

/**
 * Automatic late-return charge at drop: vehicle extra-hour rate × hours late after
 * the branch grace, charged at face value with no GST (item 8; a bill computed
 * before that may still show its GST). Staff can tick "Apply grace" on
 * MANUAL-grace branches and waive the charge with a reason.
 */
export function LateReturnPanel({
  timeline,
  billed,
  options,
  onOptionsChange,
  collection,
  readOnly,
  isPending,
  error,
}: LateReturnPanelProps) {
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");

  const lateMinutes = billed?.lateMinutes ?? timeline.lateMinutes;
  if (lateMinutes <= 0) return null;

  const graceMinutes = billed?.graceMinutes ?? timeline.graceMinutes;
  const graceType = billed?.graceType ?? timeline.graceType;
  const gracePolicyEnabled = billed?.gracePolicyEnabled ?? timeline.gracePolicyEnabled;
  const canApplyGrace = gracePolicyEnabled && graceType === "MANUAL" && graceMinutes > 0;

  // Before a bill exists: the server's preview for the options ticked now (the "with
  // grace" figures are only sent while the branch is on MANUAL grace and nothing is billed).
  // A timeline that already carries a billed line (waived, or the other grace choice)
  // can't price the options ticked now — then the amount waits for the compute.
  const candidate = options.applyGrace && canApplyGrace ? timeline.lateChargePreviewWithGrace : timeline.lateChargePreview;
  const candidateMatches =
    !!candidate && candidate.status !== "WAIVED" && (!canApplyGrace || candidate.graceApplied === options.applyGrace);
  const preview: LateChargePreview | null = billed ? billedAsPreview(billed) : candidateMatches ? candidate : null;
  const pendingWaiver = !billed && !!options.waiver;
  const status: LateReturnStatus | null = pendingWaiver
    ? preview && preview.status !== "CHARGED" && preview.status !== "RATE_UNAVAILABLE"
      ? preview.status
      : "WAIVED"
    : preview?.status ?? null;

  const dueAt = billed?.dueAt ?? timeline.currentEndAt;
  const returnedAt = billed?.returnedAt ?? timeline.returnedAt;
  const waiverReason = billed?.waiverReason ?? options.waiver?.reason ?? null;
  // A LATE_RATE_UNAVAILABLE refusal can only be cleared by pricing the vehicle or waiving
  const canWaive =
    !readOnly && (status === "CHARGED" || status === "RATE_UNAVAILABLE" || (!!error && !options.waiver));
  const reasonValid = reason.trim().length >= 3;

  const submitWaiver = () => {
    if (!reasonValid) return;
    onOptionsChange({ ...options, waiver: { reason: reason.trim() } });
    setWaiving(false);
    setReason("");
  };

  return (
    <div
      className={cn(
        "space-y-3 p-4 rounded-lg border",
        status === "CHARGED" ? "bg-red-50/40 border-red-200" : "bg-gray-50/60 border-gray-200",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-2 text-gray-900">
          <AlarmClock className="h-4 w-4 text-red-600" /> Late return
        </p>
        {status && (
          <span
            className={cn(
              "rounded border px-1.5 py-px text-[10px] font-semibold uppercase",
              STATUS_BADGE[status].className,
            )}
          >
            {STATUS_BADGE[status].label}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-600">
        Due {formatIstDateTime(dueAt)}
        {returnedAt && (
          <> · {billed ? "returned" : "as of"} {billed ? formatIstDateTime(returnedAt) : formatIstTime(returnedAt)}</>
        )}
        {" · "}
        <span className="font-semibold text-gray-900">{formatDuration(lateMinutes)} late</span>
      </p>

      {canApplyGrace && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="lateApplyGrace"
            checked={options.applyGrace}
            onCheckedChange={(v) => onOptionsChange({ ...options, applyGrace: !!v })}
            disabled={readOnly || isPending}
          />
          <Label htmlFor="lateApplyGrace" className="text-sm cursor-pointer">
            Apply grace ({graceMinutes} min)
          </Label>
        </div>
      )}

      {/* ── What is (or would be) billed ── */}
      {status === "WAIVED" ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white p-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-gray-900">
              {pendingWaiver
                ? collection === "drop-bill"
                  ? "Will be waived when you compute the charges"
                  : "Will be waived when you complete the return"
                : `Late charge of ${inr(billed?.waivedAmount ?? "0")} waived`}
            </p>
            {waiverReason && <p className="text-xs text-gray-600 break-words">Reason: {waiverReason}</p>}
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-gray-700"
              disabled={isPending}
              onClick={() => onOptionsChange({ ...options, waiver: null })}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5 mr-1" />}
              Undo waiver
            </Button>
          )}
        </div>
      ) : !preview ? (
        <p className="text-xs text-gray-600">
          {collection === "drop-bill"
            ? "The late charge is worked out when you compute the charges."
            : "The late charge is worked out when you complete the return."}
        </p>
      ) : status === "CHARGED" ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-red-900">
            {preview.hours} hr × {preview.rate != null ? inr(preview.rate) : "—"}/hr = {inr(preview.taxable)}
            {Number(preview.gst) > 0 && (
              <>
                {" "}+ GST {inr(preview.gst)}
                {preview.gstRate != null && ` (${formatRate(preview.gstRate)})`} = {inr(preview.total)}
              </>
            )}
          </p>
          <p className="text-xs text-gray-600">
            {/* Late return carries no GST (item 8) */}
            {collection === "drop-bill"
              ? billed
                ? "On the drop bill (no GST)."
                : "Added to the drop bill when you compute the charges (no GST) — the return time is fixed at the first compute."
              : "Recorded when you complete the return (measured to that moment, no GST) — the branch manager collects it at settlement."}
          </p>
        </div>
      ) : status === "WITHIN_GRACE" ? (
        <p className="text-sm text-green-800">Within the {graceMinutes}-min grace — no charge.</p>
      ) : status === "DISABLED" ? (
        <p className="text-sm text-gray-700">Late-return charges are turned off for this branch — no charge.</p>
      ) : status === "RATE_UNAVAILABLE" ? (
        <p className="text-sm text-amber-800">
          {collection === "drop-bill"
            ? "This vehicle has no extra-hour rate, so the late return can't be billed. Ask the branch manager to set the vehicle's pricing, or waive the charge with a reason."
            : "This vehicle has no extra-hour rate, so the late return won't be billed. Ask the branch manager to set the vehicle's pricing."}
        </p>
      ) : null}

      {canWaive && !waiving && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-gray-700"
          disabled={isPending}
          onClick={() => setWaiving(true)}
        >
          Waive late charge
        </Button>
      )}
      {canWaive && waiving && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <Label htmlFor="lateWaiverReason" className="text-xs text-neutral-600">
            Reason for waiving <span className="text-red-500">*</span>
          </Label>
          <Input
            id="lateWaiverReason"
            className="h-10"
            placeholder="e.g. Delayed by the branch at pickup"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitWaiver()}
          />
          {reason.length > 0 && !reasonValid && (
            <p className="text-xs text-red-600">Give a reason (at least 3 characters).</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-[#FF5F00] hover:bg-[#e65600] text-white"
              disabled={!reasonValid || isPending}
              onClick={submitWaiver}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              Waive charge
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setWaiving(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
