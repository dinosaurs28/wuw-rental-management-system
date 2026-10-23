/**
 * Financials → Cash Shift (Oct 2026). Fleet members' shifts: who holds how much
 * cash, and the branch manager closes a shift once the cash is handed over.
 *
 *  - Summary cards: open shifts · cash with fleet members · closed today · mismatches
 *  - Open list (default): one row per open shift, "Verify & close" per row
 *  - Closed list: fleet member / date range / Matched-Mismatch filters, read-only report
 *  - Payments no open shift will confirm (outside a shift, or left in a shift
 *    closed before Oct 2026): confirm / reject one by one (the old Cash Confirmations)
 *
 * Expected cash is computed by the server (opening float + cash collected − cash
 * refunded) and never typed. The shell owns the `shift` URL param: shiftId opens
 * that shift (payments if open, the report if closed).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, Wallet, Users, CalendarCheck, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  addIstDays,
  formatIstDateTime,
  formatMoney,
  istToday,
  sanitizeRupeeInput,
  toPaise,
} from "@/components/manager/payment/cashShiftFormat";
import {
  cashShiftService,
  type CashShiftCards,
  type CashShiftDetail,
  type CashShiftPayment,
  type CashShiftRow,
  type ShiftResult,
  type UnconfirmedPayment,
} from "@/services/cashShift.service";
import { managerDashboardService, type Employee } from "@/services/managerDashboard.service";

// ── helpers ───────────────────────────────────────────────────────────────────

/** "6h 20m" / "45m" / "2d 3h". */
export function durationLabel(fromIso: string, toMs: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "₹18,500" for the confirmation popup (paise shown only when present). */
function rupees(v: string | number): string {
  const paise = toPaise(v);
  const opts = paise % 100 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `₹${(paise / 100).toLocaleString("en-IN", opts)}`;
}

/** "Ravi K." */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

function paymentMode(p: Pick<CashShiftPayment, "method" | "onlineGateway" | "cashAmount" | "onlineAmount">): string {
  const gateway = (p.onlineGateway ?? "").toUpperCase();
  const online = gateway === "UPI" ? "UPI" : gateway ? "Card / online" : "UPI";
  if (p.method === "CASH") return "Cash";
  if (p.method === "SPLIT") return `Cash + ${online}`;
  return online;
}

function paymentType(p: CashShiftPayment): string {
  if (p.direction === "OUT") return "Refund";
  if (p.paymentTypes && p.paymentTypes.length > 0) return p.paymentTypes.join(" + ");
  return "—";
}

function ResultBadge({ result }: { result: ShiftResult | null }) {
  if (!result) return <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Open</span>;
  return result === "MATCHED" ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Matched</span>
  ) : (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Mismatch</span>
  );
}

function SignedMoney({ value }: { value: string | null }) {
  if (value === null) return <span>—</span>;
  const p = toPaise(value);
  const tone = p === 0 ? "text-neutral-700" : p < 0 ? "text-red-600" : "text-amber-600";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return <span className={`tabular-nums font-medium ${tone}`}>{sign}{formatMoney(Math.abs(p) / 100)}</span>;
}

function Card({ icon: Icon, label, value, sub }: { icon: typeof Wallet; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

// ── Shift sheet: open shift payments, or the closed shift's read-only report ──

function ShiftSheet({
  publicId,
  onClose,
  onVerify,
  reloadKey,
  onChanged,
}: {
  publicId: string | null;
  onClose: () => void;
  onVerify: (shift: CashShiftDetail) => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [shift, setShift] = useState<CashShiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CashShiftPayment | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!publicId) return;
    let cancelled = false;
    setError(null);
    cashShiftService
      .detail(publicId)
      .then((d) => !cancelled && setShift(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, "Couldn't load this shift.")));
    return () => {
      cancelled = true;
    };
  }, [publicId, reloadKey, attempt]);

  const view = shift && shift.publicId === publicId ? shift : null;

  const reject = async () => {
    if (!rejecting || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await cashShiftService.rejectPayment(rejecting.publicId, reason.trim());
      toast.success("Payment rejected — it is no longer in the shift's expected cash.");
      setRejecting(null);
      setReason("");
      setAttempt((n) => n + 1);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't reject this payment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!publicId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl gap-0 p-0 overflow-y-auto">
        <SheetHeader className="border-b border-neutral-100 bg-neutral-50/60 px-5 py-4">
          <SheetTitle className="pr-6 text-[15px]">{view ? view.employeeName : "Cash shift"}</SheetTitle>
          <SheetDescription className="text-xs">
            {view
              ? view.isOpen
                ? `Open since ${formatIstDateTime(view.openedAt)} · ${durationLabel(view.openedAt)}`
                : `${formatIstDateTime(view.openedAt)} – ${formatIstDateTime(view.closedAt)} · closed by ${view.closedByName ?? "—"}`
              : "Shift payments"}
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
            <p className="text-sm text-neutral-600">{error}</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
          </div>
        ) : !view ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-neutral-100" />)}
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {!view.isOpen && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600">
                    <Lock className="h-3.5 w-3.5" /> Closed shift report (read-only)
                  </span>
                  <ResultBadge result={view.result} />
                </div>
                <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-neutral-500">Expected cash</dt><dd className="font-semibold tabular-nums">{formatMoney(view.expectedCash)}</dd></div>
                  <div><dt className="text-xs text-neutral-500">Cash received</dt><dd className="font-semibold tabular-nums">{formatMoney(view.cashReceived)}</dd></div>
                  <div><dt className="text-xs text-neutral-500">Difference</dt><dd><SignedMoney value={view.difference} /></dd></div>
                  <div><dt className="text-xs text-neutral-500">Closed by</dt><dd className="font-medium">{view.closedByName ?? "—"}</dd></div>
                </dl>
                {view.discrepancyExplanation && (
                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-neutral-700">
                    <span className="font-semibold">Note: </span>{view.discrepancyExplanation}
                  </p>
                )}
                {!view.closedByManager && (
                  <p className="mt-2 text-[11px] text-neutral-500">Closed by the fleet member (before managers closed shifts).</p>
                )}
              </div>
            )}

            <ShiftBreakdown shift={view} />

            <div>
              <h3 className="mb-2 text-sm font-semibold text-neutral-800">Payments ({view.transactions.length})</h3>
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Mode</th>
                      <th className="px-3 py-2 font-medium">Booking</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                      {view.isOpen && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {view.transactions.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-neutral-500">No payments in this shift yet.</td></tr>
                    )}
                    {view.transactions.map((t) => {
                      const dead = ["VOIDED", "REJECTED", "FAILED"].includes(t.status);
                      return (
                        <tr key={t.publicId} className={`border-t border-neutral-100 ${dead ? "text-neutral-400 line-through" : ""}`}>
                          <td className="px-3 py-2">
                            {paymentType(t)}
                            {dead && <span className="ml-1 text-[10px] no-underline">({t.status.toLowerCase()})</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.direction === "OUT" ? "−" : ""}{formatMoney(t.totalAmount)}
                          </td>
                          <td className="px-3 py-2">{paymentMode(t)}</td>
                          <td className="px-3 py-2 font-mono text-xs">#{t.bookingPublicId.slice(-8).toUpperCase()}</td>
                          <td className="px-3 py-2 text-xs">{formatIstDateTime(t.collectedAt ?? t.createdAt)}</td>
                          {view.isOpen && (
                            <td className="px-3 py-2 text-right">
                              {t.status === "COLLECTED" && (
                                <button
                                  className="text-xs font-medium text-red-600 hover:underline"
                                  onClick={() => { setRejecting(t); setReason(""); }}
                                >
                                  Reject
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {view.isOpen && (
                <p className="mt-2 text-[11px] text-neutral-500">
                  Closing the shift confirms every pending payment in it. Reject a payment first if the money wasn't received.
                </p>
              )}
            </div>

            {view.isOpen && (
              <div className="sticky bottom-0 -mx-5 border-t border-neutral-100 bg-white px-5 py-3">
                <Button className="w-full" onClick={() => onVerify(view)}>Verify &amp; close</Button>
              </div>
            )}
          </div>
        )}

        <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this payment?</AlertDialogTitle>
              <AlertDialogDescription>
                {rejecting ? `${formatMoney(rejecting.totalAmount)} · ${paymentMode(rejecting)} — it leaves the shift's expected cash.` : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (at least 5 characters)" rows={3} />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || reason.trim().length < 5}
                onClick={(e) => { e.preventDefault(); void reject(); }}
              >
                Reject payment
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/** Expected cash (big) with its components, non-cash, and the per-type split. */
function ShiftBreakdown({ shift }: { shift: CashShiftDetail }) {
  const c = shift.expectedCashComponents;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="text-xs font-medium text-neutral-500">Expected cash</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-neutral-900">{formatMoney(c.expectedCash)}</div>
          <div className="mt-2 space-y-0.5 text-xs text-neutral-600">
            <div className="flex justify-between"><span>Opening float</span><span className="tabular-nums">{formatMoney(c.openingCash)}</span></div>
            <div className="flex justify-between"><span>+ Cash collected</span><span className="tabular-nums">{formatMoney(c.cashCollected)}</span></div>
            <div className="flex justify-between"><span>− Cash refunded</span><span className="tabular-nums">{formatMoney(c.cashRefunded)}</span></div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="text-xs font-medium text-neutral-500">Non-cash (UPI / card) — for information</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-800">{formatMoney(shift.nonCashCollected)}</div>
          {toPaise(shift.nonCashRefunded) > 0 && (
            <div className="mt-1 text-xs text-neutral-500">Refunded by UPI / bank: {formatMoney(shift.nonCashRefunded)}</div>
          )}
          <div className="mt-2 text-xs text-neutral-500">{shift.paymentCount} payment{shift.paymentCount === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Payment type</th>
              <th className="px-3 py-2 text-right font-medium">Cash</th>
              <th className="px-3 py-2 text-right font-medium">Non-cash</th>
            </tr>
          </thead>
          <tbody>
            {shift.typeBreakdown.map((t) => (
              <tr key={t.type} className="border-t border-neutral-100">
                <td className="px-3 py-1.5">{t.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(t.cash)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(t.nonCash)}</td>
              </tr>
            ))}
            {(toPaise(shift.refundsPaidOut.cash) > 0 || toPaise(shift.refundsPaidOut.nonCash) > 0) && (
              <tr className="border-t border-neutral-100 text-neutral-600">
                <td className="px-3 py-1.5">Refunds paid out</td>
                <td className="px-3 py-1.5 text-right tabular-nums">−{formatMoney(shift.refundsPaidOut.cash)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">−{formatMoney(shift.refundsPaidOut.nonCash)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Verify & close side panel ─────────────────────────────────────────────────

function VerifyCloseSheet({
  shiftId,
  onClose,
  onClosed,
}: {
  shiftId: string | null;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [shift, setShift] = useState<CashShiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!shiftId) return;
    let cancelled = false;
    setError(null);
    cashShiftService
      .detail(shiftId)
      .then((d) => !cancelled && setShift(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, "Couldn't load this shift.")));
    return () => {
      cancelled = true;
    };
  }, [shiftId, reload]);

  useEffect(() => {
    if (!shiftId) return;
    setReceived("");
    setNote("");
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [shiftId]);

  const view = shift && shift.publicId === shiftId ? shift : null;
  const expectedP = view ? toPaise(view.expectedCash) : 0;
  const hasReceived = received.trim() !== "" && Number.isFinite(Number(received));
  const receivedP = hasReceived ? toPaise(received) : 0;
  const diffP = receivedP - expectedP;
  const noteRequired = hasReceived && diffP !== 0;
  const canSubmit = !!view && view.isOpen && hasReceived && receivedP >= 0 && (!noteRequired || note.trim().length > 0);

  const submit = async () => {
    if (!view || !canSubmit) return;
    setSaving(true);
    try {
      const res = await cashShiftService.close(view.publicId, {
        cashReceived: receivedP / 100,
        expectedCash: expectedP / 100,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(res.data.result === "MATCHED" ? `${shortName(view.employeeName)}'s shift closed — cash matched.` : `${shortName(view.employeeName)}'s shift closed with a difference.`);
      setConfirming(false);
      onClosed();
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      toast.error(apiErrorMessage(e, "Couldn't close this shift."));
      setConfirming(false);
      if (code === "EXPECTED_CASH_CHANGED" || code === "SHIFT_NOT_OPEN") setReload((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!shiftId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl gap-0 p-0 overflow-y-auto">
        <SheetHeader className="border-b border-neutral-100 bg-neutral-50/60 px-5 py-4">
          <SheetTitle className="pr-6 text-[15px]">Verify &amp; close{view ? ` — ${view.employeeName}` : ""}</SheetTitle>
          <SheetDescription className="text-xs">
            {view
              ? `Opened ${formatIstDateTime(view.openedAt)} · closes now (${formatIstDateTime(new Date(now).toISOString())}) · ${durationLabel(view.openedAt, now)}`
              : "Count the cash handed over and close the shift"}
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
            <p className="text-sm text-neutral-600">{error}</p>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Retry</Button>
          </div>
        ) : !view ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-neutral-100" />)}
          </div>
        ) : !view.isOpen ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <Lock className="h-6 w-6 text-neutral-400" />
            <p className="text-sm text-neutral-600">This shift is already closed.</p>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <ShiftBreakdown shift={view} />

            <div className="space-y-3 rounded-xl border border-neutral-200 p-4">
              <div>
                <Label htmlFor="cash-received" className="text-xs">Cash received *</Label>
                <Input
                  id="cash-received"
                  inputMode="decimal"
                  value={received}
                  onChange={(e) => {
                    const v = sanitizeRupeeInput(e.target.value);
                    if (v !== null) setReceived(v);
                  }}
                  placeholder="0.00"
                  className="mt-1 text-lg tabular-nums"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">Difference</span>
                {hasReceived ? (
                  <span className="flex items-center gap-1.5">
                    <SignedMoney value={(diffP / 100).toFixed(2)} />
                    <span className="text-xs text-neutral-500">{diffP === 0 ? "matched" : diffP < 0 ? "short" : "over"}</span>
                  </span>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </div>
              <div>
                <Label htmlFor="close-note" className="text-xs">Note{noteRequired ? " * (required — the cash doesn't match)" : " (optional)"}</Label>
                <Textarea
                  id="close-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="mt-1"
                  placeholder={noteRequired ? "Why is the cash different?" : ""}
                />
              </div>
            </div>

            <Button className="w-full" disabled={!canSubmit} onClick={() => setConfirming(true)}>
              Close shift
            </Button>
          </div>
        )}

        <AlertDialog open={confirming} onOpenChange={(o) => !o && !saving && setConfirming(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {view ? `Close ${shortName(view.employeeName)}'s shift?` : "Close shift?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {view ? `Cash received ${rupees(receivedP / 100)}, expected ${rupees(view.expectedCash)}.` : ""}
                {diffP !== 0 ? ` Difference ${diffP < 0 ? "−" : "+"}${rupees(Math.abs(diffP) / 100)}.` : ""} The shift is locked once closed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); void submit(); }}>
                {saving ? "Closing…" : "Close shift"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

// ── Payments outside open shifts (the old Cash Confirmations) ─────────────────

function UnconfirmedSection({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<UnconfirmedPayment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<UnconfirmedPayment | null>(null);
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    cashShiftService
      .unconfirmed()
      .then((r) => !cancelled && setRows(r.transactions ?? []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, attempt]);

  if (rows.length === 0) return null;

  const confirm = async (row: UnconfirmedPayment) => {
    setBusy(row.transactionPublicId);
    try {
      await cashShiftService.confirmPayment(row.transactionPublicId);
      toast.success("Payment confirmed.");
      setAttempt((n) => n + 1);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't confirm this payment."));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!rejecting || reason.trim().length < 5) return;
    setBusy(rejecting.transactionPublicId);
    try {
      await cashShiftService.rejectPayment(rejecting.transactionPublicId, reason.trim());
      toast.success("Payment rejected.");
      setRejecting(null);
      setAttempt((n) => n + 1);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't reject this payment."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-neutral-800">Awaiting confirmation outside open shifts ({rows.length})</h3>
      <p className="mb-2 text-xs text-neutral-500">
        Pending payments no open shift will confirm: recorded without a shift, or left in a shift closed before managers closed shifts.
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Collected by</th>
              <th className="px-3 py-2 font-medium">Booking</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Collected</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.transactionPublicId} className="border-t border-neutral-100">
                <td className="px-3 py-2">{r.employeeName ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">#{r.bookingPublicId.slice(-8).toUpperCase()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                <td className="px-3 py-2">
                  {r.method === "CASH" ? "Cash" : r.method === "SPLIT" ? "Cash + UPI" : r.isUpi ? "UPI" : "Online"}
                  {r.proofPhotoUrl && (
                    <a href={r.proofPhotoUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs text-sky-700 underline">photo</a>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{formatIstDateTime(r.collectedAt)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" disabled={busy === r.transactionPublicId} onClick={() => void confirm(r)}>Confirm</Button>
                  <Button size="sm" variant="ghost" className="ml-1 text-red-600" disabled={busy === r.transactionPublicId} onClick={() => { setRejecting(r); setReason(""); }}>Reject</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this payment?</AlertDialogTitle>
            <AlertDialogDescription>{rejecting ? `${formatMoney(rejecting.amount)} collected by ${rejecting.employeeName ?? "staff"}.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (at least 5 characters)" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={reason.trim().length < 5} onClick={(e) => { e.preventDefault(); void reject(); }}>Reject payment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────

const ALL = "__all__";
const PAGE_SIZE = 20;

export function CashShiftTab({
  shiftId,
  onShiftIdChange,
}: {
  shiftId: string | null;
  onShiftIdChange: (id: string | null) => void;
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const [cards, setCards] = useState<CashShiftCards | null>(null);
  const [openRows, setOpenRows] = useState<CashShiftRow[]>([]);
  const [closedRows, setClosedRows] = useState<CashShiftRow[]>([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employee, setEmployee] = useState<string>(ALL);
  const [from, setFrom] = useState(() => addIstDays(istToday(), -6));
  const [to, setTo] = useState(() => istToday());
  const [result, setResult] = useState<string>(ALL);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    managerDashboardService.getEmployees(200).then(setEmployees).catch(() => setEmployees([]));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const emp = employee === ALL ? undefined : employee;
    Promise.all([
      cashShiftService.cards({ from, to }),
      cashShiftService.listOpen(1, 100, emp),
      cashShiftService.listClosed(page, PAGE_SIZE, {
        employeePublicId: emp,
        from,
        to,
        result: result === ALL ? undefined : (result as ShiftResult),
      }),
    ])
      .then(([c, o, cl]) => {
        if (cancelled) return;
        setCards(c);
        setOpenRows(o.data);
        setClosedRows(cl.data);
        setClosedTotal(cl.total);
      })
      .catch((e) => !cancelled && toast.error(apiErrorMessage(e, "Couldn't load cash shifts.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [employee, from, to, result, page, reloadKey]);

  // A deep link to a closed shift shows the Closed list behind its report
  useEffect(() => {
    if (!shiftId) return;
    if (closedRows.some((r) => r.publicId === shiftId)) setView("closed");
  }, [shiftId, closedRows]);

  const totalPages = Math.max(1, Math.ceil(closedTotal / PAGE_SIZE));
  const rangeLabel = useMemo(() => (from === to ? from : `${from} – ${to}`), [from, to]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={Users} label="Open shifts" value={cards ? String(cards.openShifts) : "—"} sub="Fleet members with an open shift" />
        <Card icon={Wallet} label="Cash with fleet members" value={cards ? formatMoney(cards.cashWithFleet) : "—"} sub="Expected cash across open shifts" />
        <Card
          icon={CalendarCheck}
          label="Closed today"
          value={cards ? String(cards.closedToday.count) : "—"}
          sub={cards ? `${formatMoney(cards.closedToday.cashReceived)} received` : undefined}
        />
        <Card icon={Scale} label="Mismatches" value={cards ? String(cards.mismatches) : "—"} sub={`Closed with a difference · ${rangeLabel}`} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-neutral-100 p-1">
          {(["open", "closed"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${view === v ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600"}`}
            >
              {v === "open" ? `Open (${openRows.length})` : "Closed"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-[11px] text-neutral-500">Fleet member</Label>
            <Select value={employee} onValueChange={(v) => { setEmployee(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All fleet members</SelectItem>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {view === "closed" && (
            <>
              <div>
                <Label className="text-[11px] text-neutral-500">Closed from</Label>
                <Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPage(1); } }} />
              </div>
              <div>
                <Label className="text-[11px] text-neutral-500">to</Label>
                <Input type="date" className="h-9 w-40" value={to} min={from} max={istToday()} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPage(1); } }} />
              </div>
              <div>
                <Label className="text-[11px] text-neutral-500">Status</Label>
                <Select value={result} onValueChange={(v) => { setResult(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All</SelectItem>
                    <SelectItem value="MATCHED">Matched</SelectItem>
                    <SelectItem value="MISMATCH">Mismatch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
        {view === "open" ? (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Fleet member</th>
                <th className="px-4 py-2.5 font-medium">Opened at</th>
                <th className="px-4 py-2.5 font-medium">Time open</th>
                <th className="px-4 py-2.5 text-right font-medium">Payments</th>
                <th className="px-4 py-2.5 text-right font-medium">Cash</th>
                <th className="px-4 py-2.5 text-right font-medium">Non-cash</th>
                <th className="px-4 py-2.5 text-right font-medium">Total collected</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {!loading && openRows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-500">No open shifts right now.</td></tr>
              )}
              {openRows.map((r) => (
                <tr key={r.publicId} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => onShiftIdChange(r.publicId)}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{r.employeeName}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatIstDateTime(r.openedAt)}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-600">{durationLabel(r.openedAt, now)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.paymentCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.cashCollected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.nonCashCollected)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(r.totalCollected)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); setVerifyId(r.publicId); }}>Verify &amp; close</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Fleet member</th>
                <th className="px-4 py-2.5 font-medium">Opened at</th>
                <th className="px-4 py-2.5 font-medium">Closed at</th>
                <th className="px-4 py-2.5 font-medium">Closed by</th>
                <th className="px-4 py-2.5 text-right font-medium">Expected cash</th>
                <th className="px-4 py-2.5 text-right font-medium">Cash received</th>
                <th className="px-4 py-2.5 text-right font-medium">Difference</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && closedRows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-500">No closed shifts for these filters.</td></tr>
              )}
              {closedRows.map((r) => (
                <tr key={r.publicId} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => onShiftIdChange(r.publicId)}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{r.employeeName}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatIstDateTime(r.openedAt)}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatIstDateTime(r.closedAt)}</td>
                  <td className="px-4 py-3 text-neutral-600">{r.closedByName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.expectedCash)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.cashReceived)}</td>
                  <td className="px-4 py-3 text-right"><SignedMoney value={r.difference} /></td>
                  <td className="px-4 py-3"><ResultBadge result={r.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view === "closed" && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-neutral-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {view === "open" && <UnconfirmedSection reloadKey={reloadKey} onChanged={refresh} />}

      <ShiftSheet
        publicId={shiftId}
        onClose={() => onShiftIdChange(null)}
        onVerify={(s) => { onShiftIdChange(null); setVerifyId(s.publicId); }}
        reloadKey={reloadKey}
        onChanged={refresh}
      />
      <VerifyCloseSheet
        shiftId={verifyId}
        onClose={() => setVerifyId(null)}
        onClosed={() => {
          setVerifyId(null);
          setView("closed");
          refresh();
        }}
      />
      {cards && cards.openShifts === 0 && view === "open" && openRows.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Every shift is closed — all cash is with the branch.
        </p>
      )}
    </div>
  );
}

export default CashShiftTab;
