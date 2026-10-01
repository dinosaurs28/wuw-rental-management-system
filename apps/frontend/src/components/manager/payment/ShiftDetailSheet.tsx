import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Info, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ShiftStatusBadge, TransactionBadge } from "@/components/manager/payment/PaymentStateBadge";
import { apiErrorMessage } from "@/lib/counterErrors";
import type {
  ShiftDetail,
  ShiftStatus,
  ShiftTransaction,
  ShiftTransactionPurpose,
} from "@/services/payment.service";
import {
  LEGACY_VARIANCE_NOTE,
  VARIANCE_TONE_CLASSES,
  describeVariance,
  formatIstDateTime,
  formatIstDay,
  formatMoney,
  toPaise,
} from "./cashShiftFormat";

// ── Money breakdown ───────────────────────────────────────────────────────────

/** The shift figures the breakdown reads; every field is optional so the active-shift payload fits. */
export interface ShiftFigures {
  isOpen?: boolean;
  status?: ShiftStatus;
  openingCash?: string;
  cashCollected?: string;
  cashRefunded?: string;
  expectedClosing?: string;
  closingCash?: string | null;
  variance?: string | null;
  pendingCash?: string;
  confirmedCash?: string;
  rejectedCash?: string;
  upiCollected?: string;
  legacyVariance?: boolean;
}

function BreakdownRow({
  op,
  label,
  value,
  strong,
  valueClass,
  children,
}: {
  op?: string;
  label: string;
  value: string;
  strong?: boolean;
  valueClass?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`px-4 py-2.5 ${strong ? "bg-neutral-100/70" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs ${strong ? "font-semibold text-neutral-800" : "text-neutral-600"}`}>
          {op && <span className="inline-block w-4 text-neutral-400 font-mono">{op}</span>}
          {label}
        </span>
        <span
          className={`text-sm tabular-nums ${strong ? "font-bold" : "font-semibold"} ${valueClass ?? "text-neutral-800"}`}
        >
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Opening + collected − refunded = expected in drawer, against the counted
 * closing cash. Renders the server's figures as-is — nothing is recomputed.
 * `hideClosing` drops the counted/variance rows (the close form shows its own).
 */
export function ShiftMoneyBreakdown({
  shift,
  hideClosing = false,
}: {
  shift: ShiftFigures;
  hideClosing?: boolean;
}) {
  const legacy = !!shift.legacyVariance;
  const isOpen = shift.isOpen ?? shift.status === "OPEN";
  const pending = toPaise(shift.pendingCash);
  const confirmed = toPaise(shift.confirmedCash);
  const rejected = toPaise(shift.rejectedCash);
  const variance = describeVariance(shift.variance);
  const hasStatusSplit = shift.pendingCash !== undefined || shift.confirmedCash !== undefined;

  return (
    <div className="space-y-2">
      {legacy && (
        <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-neutral-400" />
          <span>{LEGACY_VARIANCE_NOTE}</span>
        </div>
      )}
      <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100 overflow-hidden">
        <BreakdownRow op={legacy ? undefined : " "} label="Opening cash" value={formatMoney(shift.openingCash)} />
        <BreakdownRow op={legacy ? undefined : "+"} label="Cash collected" value={formatMoney(shift.cashCollected)}>
          {hasStatusSplit && (confirmed > 0 || pending > 0 || rejected > 0) && (
            <p className="mt-1 pl-4 text-[11px] text-neutral-500">
              Confirmed {formatMoney(shift.confirmedCash)}
              {pending > 0 && (
                <span className="text-amber-700 font-medium"> · Pending confirmation {formatMoney(shift.pendingCash)}</span>
              )}
              {rejected > 0 && (
                <span className="text-red-600 font-medium"> · Rejected {formatMoney(shift.rejectedCash)}</span>
              )}
              {!isOpen && <span className="block text-neutral-400">Confirmation status is current; the shift figures were fixed at close.</span>}
            </p>
          )}
        </BreakdownRow>
        <BreakdownRow op={legacy ? undefined : "−"} label="Cash refunded" value={formatMoney(shift.cashRefunded)} />
        <BreakdownRow
          op={legacy ? undefined : "="}
          label={legacy ? "Expected (stored)" : "Expected in drawer"}
          value={formatMoney(shift.expectedClosing)}
          strong
        />
        {!hideClosing && (
          <>
            <BreakdownRow label="Counted at close" value={formatMoney(shift.closingCash ?? null)} />
            <BreakdownRow
              label="Variance"
              value={variance ? `${variance.text}${variance.tone === "even" ? "" : ` ${variance.label}`}` : "—"}
              valueClass={variance ? VARIANCE_TONE_CLASSES[variance.tone] : "text-neutral-400"}
              strong
            />
          </>
        )}
      </div>
      {shift.upiCollected !== undefined && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-neutral-200 px-4 py-2 text-xs">
          <span className="text-neutral-500">UPI collected <span className="text-neutral-400">(not in the drawer)</span></span>
          <span className="font-semibold tabular-nums text-neutral-700">{formatMoney(shift.upiCollected)}</span>
        </div>
      )}
    </div>
  );
}

// ── Transactions ──────────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<ShiftTransactionPurpose, string> = {
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining balance",
  FULL_PAYMENT: "Full payment",
  EXTENSION: "Extension",
  DAMAGE_FEE: "Damage fee",
  SAFETY_DEPOSIT: "Safety deposit",
  OVERPAYMENT_REFUND: "Overpayment refund",
  CANCELLATION_REFUND: "Cancellation refund",
};

function TransactionAmount({ txn }: { txn: ShiftTransaction }) {
  const out = txn.direction === "OUT";
  const cash = toPaise(txn.cashAmount);
  const online = toPaise(txn.onlineAmount);
  const onlineLabel = txn.onlineGateway === "UPI" ? "UPI" : "Online";
  return (
    <div className="text-right">
      <p className={`text-sm font-semibold tabular-nums ${out ? "text-red-600" : "text-neutral-900"}`}>
        {out ? "−" : ""}
        {formatMoney(txn.totalAmount)}
      </p>
      {cash > 0 && online > 0 && (
        <p className="text-[11px] text-neutral-500 tabular-nums">
          Cash {formatMoney(txn.cashAmount)} + {onlineLabel} {formatMoney(txn.onlineAmount)}
        </p>
      )}
      {cash === 0 && online > 0 && <p className="text-[11px] text-neutral-500">{onlineLabel}</p>}
      {cash > 0 && online === 0 && <p className="text-[11px] text-neutral-500">Cash</p>}
    </div>
  );
}

function TransactionRow({ txn }: { txn: ShiftTransaction }) {
  const out = txn.direction === "OUT";
  return (
    <li className="px-4 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              out ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"
            }`}
            title={out ? "Paid out of the drawer" : "Money taken"}
          >
            {out ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900">{PURPOSE_LABELS[txn.purpose] ?? txn.purpose}</p>
            <p className="text-[11px] text-neutral-500 truncate">
              <span className="font-mono">{txn.bookingPublicId}</span>
              {txn.customerName ? ` · ${txn.customerName}` : ""}
            </p>
          </div>
        </div>
        <TransactionAmount txn={txn} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-[11px] text-neutral-500">
        <TransactionBadge status={txn.status} />
        {txn.collectedAt && (
          <span>
            {formatIstDateTime(txn.collectedAt)}
            {txn.collectedByName ? ` · ${txn.collectedByName}` : ""}
          </span>
        )}
        {txn.onlineTransactionRef && <span className="font-mono">UTR {txn.onlineTransactionRef}</span>}
      </div>
      {(txn.confirmedAt || txn.rejectedAt) && (
        <p className="pl-8 text-[11px] text-neutral-500">
          {txn.confirmedAt && (
            <>Confirmed {formatIstDateTime(txn.confirmedAt)}{txn.confirmedByName ? ` by ${txn.confirmedByName}` : ""}</>
          )}
          {txn.rejectedAt && (
            <span className="text-red-600">
              Rejected {formatIstDateTime(txn.rejectedAt)}
              {txn.rejectedByName ? ` by ${txn.rejectedByName}` : ""}
              {txn.rejectionReason ? ` — ${txn.rejectionReason}` : ""}
            </span>
          )}
        </p>
      )}
      {txn.notes && <p className="pl-8 text-[11px] italic text-neutral-500">"{txn.notes}"</p>}
      {txn.linkedAfterClose && (
        <p className="ml-8 inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          <AlertTriangle className="h-3 w-3" /> Recorded after the shift closed — not in its figures
        </p>
      )}
    </li>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────────────

interface ShiftDetailSheetProps {
  /** The shift to show; null keeps the sheet closed. */
  publicId: string | null;
  onClose: () => void;
  /** Fetches the shift (BM: paymentService.getShift, Fleet: employeePaymentService.getMyShift). */
  load: (publicId: string) => Promise<ShiftDetail>;
  /** BM only: offered on DISCREPANCY_FLAGGED shifts. */
  onReconcile?: (shift: ShiftDetail) => void;
  /** Bump to re-fetch the open shift (e.g. after a reconcile). */
  reloadKey?: number;
}

export function ShiftDetailSheet({ publicId, onClose, load, onReconcile, reloadKey = 0 }: ShiftDetailSheetProps) {
  const [attempt, setAttempt] = useState(0);
  // Last response, tagged with the request it answered; loading/error derive from it.
  const [result, setResult] = useState<{ key: string; shift: ShiftDetail | null; error: string | null } | null>(null);
  const requestKey = publicId ? `${publicId}:${reloadKey}:${attempt}` : null;

  useEffect(() => {
    if (!publicId || !requestKey) return;
    let cancelled = false;
    load(publicId)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, shift: data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({ key: requestKey, shift: null, error: apiErrorMessage(err, "Couldn't load this shift.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [publicId, requestKey, load]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loading = !!requestKey && result?.key !== requestKey;
  const error = result && result.key === requestKey ? result.error : null;
  // While re-fetching the same shift, keep showing the previous copy.
  const view = result?.shift && result.shift.publicId === publicId ? result.shift : null;
  const txns = view?.transactions ?? [];

  return (
    <Sheet open={!!publicId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl gap-0 p-0 overflow-y-auto">
        <SheetHeader className="border-b border-neutral-100 bg-neutral-50/60 px-5 py-4">
          <SheetTitle className="text-[15px] pr-6">
            {view ? view.employeeName : "Cash shift"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {view
              ? `${formatIstDay(view.istDate)}${view.branchName ? ` · ${view.branchName}` : ""}`
              : "Shift details and transactions"}
          </SheetDescription>
        </SheetHeader>

        {loading && !view ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 rounded-lg bg-neutral-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
            <p className="text-sm text-neutral-700">{error}</p>
            <Button variant="outline" size="sm" onClick={retry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : view ? (
          <div className="space-y-5 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <ShiftStatusBadge status={view.status} />
              {view.reconciledAt && (
                <span className="text-xs text-green-700">
                  Reconciled{view.reconciledByName ? ` by ${view.reconciledByName}` : ""} ·{" "}
                  {formatIstDateTime(view.reconciledAt, true)}
                </span>
              )}
              {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                <p className="text-neutral-500">Opened</p>
                <p className="font-medium text-neutral-800">{formatIstDateTime(view.openedAt, true)}</p>
              </div>
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                <p className="text-neutral-500">Closed</p>
                <p className="font-medium text-neutral-800">
                  {view.closedAt ? formatIstDateTime(view.closedAt, true) : "Still open"}
                </p>
              </div>
            </div>

            <ShiftMoneyBreakdown shift={view} />

            {view.discrepancyExplanation && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-500">
                  {view.reconciledAt ? "Manager reconciliation note" : "Fleet Executive's explanation"}
                </p>
                <p className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm italic leading-relaxed text-neutral-800">
                  "{view.discrepancyExplanation}"
                </p>
              </div>
            )}

            {onReconcile && view.status === "DISCREPANCY_FLAGGED" && (
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => onReconcile(view)}
              >
                Reconcile this shift
              </Button>
            )}

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">Transactions</h3>
                <span className="text-xs text-neutral-500">{txns.length}</span>
              </div>
              {txns.length === 0 ? (
                <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-xs text-neutral-500">
                  No payments were linked to this shift.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
                  {txns.map((t) => (
                    <TransactionRow key={t.publicId} txn={t} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
