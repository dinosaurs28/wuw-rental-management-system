import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Loader2, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { dlStatusLabel } from "@/lib/dlStatus";
import { employeePaymentService } from "@/services/payment.service";
import type {
  AdjustmentPlan,
  AdjustmentRecord,
  EditPreview,
  PickupSummary,
  ReturnSummary,
  SummaryBillLine,
} from "@/services/completedOperation.service";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { adjustmentOutcome, damageBilling, summaryKey, useSummary } from "@/components/employee/completed/completedEdit";
import { AdjustmentLinesTable, AdjustmentSettle } from "@/components/employee/completed/AdjustmentSettle";
import type { PaymentSession } from "@/services/paymentSession.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Completed pickups / returns (client item 1): the read-only summary, and the
 * review / settle steps of Edit Pickup / Edit Return — the workflow pages again
 * with ?edit=1, the only way back into what was captured. An edit that moves
 * money (readings, drop charges, discount, deposit) is reviewed first (old → new,
 * Collect ₹X more / Refund ₹Y / No change), then saved, then its difference
 * settled at the counter on the edit's ADJUSTMENT session.
 */

type Phase = "PICKUP" | "RETURN";
type Summary = PickupSummary | ReturnSummary;

const inr = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (x: unknown) => Number(x ?? 0) || 0;
const km = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("en-IN")} km`);
const fuel = (level: string | null | undefined) => (level ? `${level}/10` : "—");
const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd MMM yyyy, h:mm a") : "—");
const balance = (v: string | null | undefined) => (v == null ? "Not read" : inr(num(v)));
const phaseWord = (phase: Phase) => (phase === "PICKUP" ? "pickup" : "return");

/** "Completed" (green) or "Awaiting manager" (amber). */
export function CompletedTag({ awaitingManager, className }: { awaitingManager?: boolean; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium",
        awaitingManager
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-emerald-50 text-emerald-700 border-emerald-200",
        className,
      )}
    >
      {awaitingManager ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {awaitingManager ? "Awaiting manager" : "Completed"}
    </Badge>
  );
}

/** "Completed 14 Oct, 3:45 PM · by Ravi" */
export function completionText(
  completed: { at: string | null; byName: string | null } | null | undefined,
  awaitingManager?: boolean,
): string | null {
  if (!completed || (!completed.at && !completed.byName)) return null;
  return [
    awaitingManager ? "Sent to manager" : "Completed",
    completed.at ? format(new Date(completed.at), "dd MMM, h:mm a") : null,
    completed.byName ? `· by ${completed.byName}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// ── Read-only summary ────────────────────────────────────────────────────────

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-right text-gray-900", className)}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="rounded-lg border bg-white px-3 py-2">{children}</div>
    </div>
  );
}

function PhotoStrip({ photos, empty }: { photos: { url: string; label?: string | null }[]; empty: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return <p className="text-sm text-muted-foreground py-1">{empty}</p>;
  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 py-1">
        {photos.map((p, i) => (
          <button
            key={`${p.url}_${i}`}
            type="button"
            onClick={() => setOpen(i)}
            className="relative aspect-square rounded-md overflow-hidden border bg-muted cursor-zoom-in"
            aria-label={p.label ? `View ${p.label} photo` : "View photo"}
          >
            <img src={p.url} alt={p.label ?? "Photo"} className="w-full h-full object-cover" loading="lazy" />
            <ZoomBadge />
            {p.label && (
              <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1 py-0.5 truncate">
                {p.label}
              </span>
            )}
          </button>
        ))}
      </div>
      <PhotoLightbox
        items={photos.map((p) => ({ url: p.url, label: p.label ?? null }))}
        startIndex={open ?? 0}
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </>
  );
}

function BillLines({ lines }: { lines: SummaryBillLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground py-1">No charges.</p>;
  return (
    <div className="py-1">
      {lines.map((l, i) => {
        const amount = num(l.amount);
        return (
          <div key={`${l.label}_${i}`} className="flex justify-between gap-4 py-1 text-sm">
            <span className="text-gray-700">{l.label}</span>
            <span className={cn("font-medium", amount < 0 ? "text-emerald-700" : "text-gray-900")}>
              {amount < 0 ? "−" : ""}
              {inr(amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Payments({ bookingId }: { bookingId: string }) {
  const { data: fin, isLoading } = useQuery({
    queryKey: ["employee-financial-state", bookingId],
    queryFn: () => employeePaymentService.getFinancialState(bookingId),
    retry: false,
  });
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin my-2 text-muted-foreground" />;
  if (!fin) return <p className="text-sm text-muted-foreground py-1">Payments couldn't be loaded.</p>;
  const due = num(fin.amountDue);
  return (
    <>
      <Row label="Booking total" value={inr(num(fin.totalFinal))} />
      {num(fin.returnCharges) > 0 && <Row label="Drop charges" value={inr(num(fin.returnCharges))} />}
      <Row label="Collected" value={inr(num(fin.totalCollectedConfirmed) + num(fin.totalCollectedPending))} />
      {num(fin.totalRefunded) > 0 && <Row label="Refunded" value={inr(num(fin.totalRefunded))} />}
      <Row
        label="Due"
        value={due > 0 ? inr(due) : "Nothing due"}
        className={due > 0 ? "text-amber-700" : "text-emerald-700"}
      />
    </>
  );
}

function SummaryContent({ summary }: { summary: Summary }) {
  const awaiting = summary.state === "AWAITING_MANAGER";
  const doneText = completionText(summary.completed, awaiting);
  return (
    <div className="space-y-4">
      {summary.state && summary.state !== "PENDING" ? (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3",
            awaiting ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200",
          )}
        >
          {awaiting ? <Clock className="h-5 w-5 text-amber-600 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />}
          <div className="text-sm">
            <p className={cn("font-semibold", awaiting ? "text-amber-800" : "text-emerald-800")}>
              {awaiting ? "Awaiting manager" : "Completed"}
            </p>
            <p className="text-gray-700">
              {awaiting
                ? `This ${phaseWord(summary.phase)} was sent to the branch manager to confirm.`
                : `This ${phaseWord(summary.phase)} is done.`}
              {doneText ? ` ${doneText.replace(/^(Completed|Sent to manager) ?/, "")}` : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid sm:grid-cols-2 gap-4">
        <Section title="Customer">
          <Row label="Name" value={summary.customer.name} />
          {summary.customer.phone && <Row label="Phone" value={summary.customer.phone} />}
          {summary.phase === "PICKUP" && (
            <Row label="DL number" value={summary.customer.drivingLicenceNumber ?? "Not on file"} />
          )}
        </Section>
        <Section title="Vehicle">
          {summary.vehicles.map((v) => (
            <Row key={v.publicId} label={`${v.make} ${v.model}`} value={v.regNo} />
          ))}
        </Section>
      </div>

      {summary.phase === "PICKUP" ? (
        <>
          <Section title="Handover">
            <Row label="Pickup" value={when(summary.booking.startAt)} />
            <Row label="Odometer" value={km(summary.odometer)} />
            <Row label="Fuel level" value={fuel(summary.fuelLevel)} />
            {summary.fastag.hasFastag && <Row label="FASTag balance" value={balance(summary.fastag.balance)} />}
            <Row
              label="Original DL"
              value={`${dlStatusLabel(summary.dl.status)}${summary.dl.status === "DEPOSIT" && summary.dl.depositNote ? ` · ${summary.dl.depositNote}` : ""}`}
            />
            {summary.pickupDiscount && (
              <Row
                label="Pickup discount"
                value={`−${inr(num(summary.pickupDiscount.amount))}${summary.pickupDiscount.reason ? ` · ${summary.pickupDiscount.reason}` : ""}`}
              />
            )}
            {num(summary.safetyDeposit) > 0 && <Row label="Safety deposit" value={inr(num(summary.safetyDeposit))} />}
          </Section>
          <Section title={`Photos (${summary.photos.length})`}>
            <PhotoStrip photos={summary.photos} empty="No photos were saved with this pickup." />
          </Section>
          {summary.bill && (
            <Section title="Pickup bill">
              <BillLines lines={summary.bill.lines} />
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Drop">
            <Row label="Return due" value={when(summary.booking.endAt)} />
            {summary.booking.returnedAt && <Row label="Returned" value={when(summary.booking.returnedAt)} />}
            <Row label="Odometer at pickup" value={km(summary.odometer.pickup)} />
            {summary.odometer.swapCount > 0 && summary.odometer.start != null && (
              <Row label="Replacement car started at" value={km(summary.odometer.start)} />
            )}
            <Row label="Odometer at drop" value={km(summary.odometer.end)} />
            {summary.odometer.measured && summary.odometer.kmDriven != null && (
              <Row label="Km driven" value={km(summary.odometer.kmDriven)} />
            )}
            {summary.odometer.freeKm != null && <Row label="Free km" value={km(summary.odometer.freeKm)} />}
            {(summary.odometer.extraKm ?? 0) > 0 && <Row label="Extra km" value={km(summary.odometer.extraKm)} />}
            {!summary.odometer.measured && (
              <p className="text-xs text-muted-foreground py-1">
                The vehicle was swapped without odometer readings — km driven can't be measured.
              </p>
            )}
            <Row label="Fuel at pickup" value={fuel(summary.fuel.pickup)} />
            <Row label="Fuel at drop" value={fuel(summary.fuel.return)} />
            {summary.fastag.hasFastag && (
              <>
                <Row label="FASTag at handover" value={balance(summary.fastag.startBalance)} />
                <Row label="FASTag at drop" value={balance(summary.fastag.balance)} />
                {summary.fastag.usage != null && <Row label="FASTag used" value={inr(num(summary.fastag.usage))} />}
              </>
            )}
          </Section>
          <Section title={`Return photos (${summary.photos.length})`}>
            <PhotoStrip photos={summary.photos} empty="No photos were saved with this return." />
          </Section>
          {summary.damages.length > 0 && (
            <Section title={`Damage found (${summary.damages.length})`}>
              {summary.damages.map((d) => (
                <div key={d.publicId} className="py-2 border-b last:border-0">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-semibold text-gray-900">{d.area || "Damage"}</span>
                    <span className="text-amber-700 text-xs font-medium">{d.severity}</span>
                  </div>
                  {d.description && <p className="text-sm text-gray-700 mt-1">{d.description}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {num(d.amount) > 0 ? `${inr(num(d.amount))} · ` : ""}
                    {damageBilling(d)}
                  </p>
                  <PhotoStrip photos={d.photos} empty="No photos." />
                </div>
              ))}
            </Section>
          )}
          {summary.bill && (
            <Section title={summary.bill.settledBy === "DROP_BILL" ? "Drop bill" : "Drop charges"}>
              <BillLines lines={summary.bill.lines} />
              {summary.bill.settledBy === "BRANCH_MANAGER" && (
                <p className="text-xs text-muted-foreground pb-1">Collected by the branch manager in Settlements.</p>
              )}
            </Section>
          )}
        </>
      )}

      {summary.pendingAdjustment && (
        <Section title="Difference to settle">
          <PendingAdjustment summary={summary} record={summary.pendingAdjustment} />
        </Section>
      )}
      {(summary.adjustments?.length ?? 0) > 0 && (
        <Section title="Edits that changed the bill">
          <AdjustmentHistory records={summary.adjustments ?? []} />
        </Section>
      )}

      <Section title="Payments">
        <Payments bookingId={summary.booking.publicId} />
      </Section>
    </div>
  );
}

// ── Money difference of an edit ──────────────────────────────────────────────

/** A safety deposit raised by the edit is never taken on credit. */
const collectMethodsOf = (lines: { entryType: string; delta: string }[]) =>
  lines.some((l) => l.entryType === "DEPOSIT" && num(l.delta) > 0) ? ["CASH", "UPI", "SPLIT"] : undefined;

/** The difference of an earlier edit, settled from the summary. */
export function PendingAdjustment({ summary, record }: { summary: Summary; record: AdjustmentRecord }) {
  const qc = useQueryClient();
  // Settled here, or settled / refused elsewhere meanwhile: show what's true now
  const reload = () => {
    void qc.invalidateQueries({ queryKey: summaryKey(summary.phase, summary.booking.publicId) });
    void qc.invalidateQueries({ queryKey: ["employee-financial-state", summary.booking.publicId] });
  };
  return (
    <div className="py-2 space-y-2">
      <p className="text-xs text-muted-foreground">From the edit on {when(record.createdAt)}.</p>
      <AdjustmentSettle
        session={record.session}
        lines={record.lines}
        collectMethods={collectMethodsOf(record.lines)}
        onSettled={reload}
        onRefused={reload}
      />
    </div>
  );
}

/** Edits whose difference was settled, oldest first. */
function AdjustmentHistory({ records }: { records: AdjustmentRecord[] }) {
  return (
    <div className="divide-y">
      {records.map((r) => {
        // The edit's difference: its corrected charges less discounts (part may have come off credit)
        const net = num(r.session.totalCharges) + num(r.session.totalDiscounts);
        const offCredit = r.lines.filter((l) => l.entryType === "CREDIT").reduce((sum, l) => sum + num(l.delta), 0);
        return (
          <div key={r.session.publicId} className="py-2">
            <p className="text-sm font-medium text-gray-900">
              Edited {when(r.completedAt ?? r.createdAt)} ·{" "}
              {net > 0
                ? `${inr(net)} more, settled`
                : net < 0
                  ? offCredit > 0
                    ? `${inr(net)} less, ${inr(offCredit)} of it off the credit`
                    : `${inr(net)} less, refunded`
                  : "no change in money"}
            </p>
            <AdjustmentLinesTable lines={r.lines} />
          </div>
        );
      })}
    </div>
  );
}

/** Step 2 of an edit: the money difference it makes, then Save changes. */
export function EditReview({
  phase,
  preview,
  error,
  saving,
  onBack,
  onConfirm,
}: {
  phase: Phase;
  preview: EditPreview | null;
  error: string | null;
  saving: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const plan = preview?.adjustment ?? null;
  // The last edit's unsettled difference this save replaces
  const replaces = preview?.supersedes ?? null;
  return (
    <div className="space-y-4">
      {!plan ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
        </div>
      ) : (
        <>
          {replaces && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              This replaces the last edit's difference ({inr(num(replaces.netPayable))}), which wasn't settled — the
              amount below covers both edits.
            </div>
          )}
          <div className="rounded-lg border bg-white p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-1">{phase === "RETURN" ? "Drop charges" : "Money"}</h4>
            <AdjustmentLinesTable lines={plan.lines} showUnchanged />
          </div>
          <div
            className={cn(
              "rounded-lg border p-3 text-sm font-semibold",
              plan.action === "COLLECT"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : plan.action === "REFUND"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-gray-50 text-gray-800",
            )}
          >
            {adjustmentOutcome(plan)}
          </div>
          {plan.action !== "NONE" && plan.settledBy === "COUNTER" && (
            <p className="text-xs text-muted-foreground">
              {plan.action === "COLLECT"
                ? "After saving, collect it by cash, UPI, split or credit."
                : "After saving, refund it by cash or UPI."}
            </p>
          )}
        </>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onBack} disabled={saving}>
          Back to edit
        </Button>
        <Button onClick={onConfirm} disabled={saving || !plan} className="bg-[#FF5F00] hover:bg-[#e65500]">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Save changes
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Step 3 of an edit: the saved difference, collected / refunded now or later. */
export function SettleStep({
  session,
  plan,
  onDone,
}: {
  session: PaymentSession;
  plan: AdjustmentPlan;
  onDone: (note: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">The changes are saved. Settle the difference with the customer now.</p>
      <AdjustmentSettle
        session={session}
        lines={plan.lines}
        collectMethods={plan.methods.collect}
        onSettled={onDone}
        onRefused={onDone}
      />
      <div className="flex justify-center">
        <Button
          variant="ghost"
          onClick={() => onDone("The difference is still to be settled — settle it from the summary.")}
        >
          Settle later
        </Button>
      </div>
    </div>
  );
}

// ── Dialog: the summary of a completed row ───────────────────────────────────

interface CompletedOperationDialogProps {
  phase: Phase;
  bookingId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Edit Pickup / Edit Return: the workflow page again, in edit mode. */
  onEdit: (bookingId: string) => void;
}

export function CompletedOperationDialog({ phase, bookingId, onOpenChange, onEdit }: CompletedOperationDialogProps) {
  const { data: summary, isLoading, isError } = useSummary(phase, bookingId ?? "", !!bookingId);

  return (
    <Dialog open={!!bookingId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "PICKUP" ? "Pickup" : "Return"}
            {summary?.state && summary.state !== "PENDING" && (
              <CompletedTag awaitingManager={summary.state === "AWAITING_MANAGER"} />
            )}
          </DialogTitle>
          <DialogDescription>
            {bookingId ? `#${bookingId.slice(-6).toUpperCase()}` : ""}
            {summary ? ` · ${summary.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ")} · ${summary.customer.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
          </div>
        ) : isError || !summary ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load this {phaseWord(phase)}.</p>
        ) : (
          <>
            <SummaryContent summary={summary} />
            {summary.edit.allowed && (
              <DialogFooter>
                <Button
                  onClick={() => onEdit(summary.booking.publicId)}
                  className="bg-[#FF5F00] hover:bg-[#e65500] gap-1.5"
                >
                  <Pencil className="h-4 w-4" />
                  {phase === "PICKUP" ? "Edit Pickup" : "Edit Return"}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Page: a completed booking opened on the pickup / return URL ──────────────

/**
 * Shown by the pickup / return pages instead of the workflow once that step is
 * done: the read-only summary, with Edit Pickup / Edit Return — the same page
 * again with ?edit=1, the workflow prefilled from what it recorded.
 */
export function CompletedOperationPage({ phase, bookingId }: { phase: Phase; bookingId: string }) {
  const { data: summary, isLoading, isError } = useSummary(phase, bookingId);

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />
      <main className="container max-w-3xl mx-auto py-6 px-4 space-y-5">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/employee/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{phase === "PICKUP" ? "Pickup" : "Return"}</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{bookingId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-xl flex items-center gap-2">
              {phase === "PICKUP" ? "Pickup" : "Return"}
              {summary?.state && summary.state !== "PENDING" && (
                <CompletedTag awaitingManager={summary.state === "AWAITING_MANAGER"} />
              )}
            </CardTitle>
            {summary?.edit.allowed && (
              <Button asChild className="bg-[#FF5F00] hover:bg-[#e65500] gap-1.5">
                <Link to="?edit=1">
                  <Pencil className="h-4 w-4" />
                  {phase === "PICKUP" ? "Edit Pickup" : "Edit Return"}
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
              </div>
            ) : isError || !summary ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load this {phaseWord(phase)}.</p>
            ) : (
              <SummaryContent summary={summary} />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
