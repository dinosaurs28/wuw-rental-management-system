import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Info, Loader2, Pencil } from "lucide-react";
import { DL_INVALID_MESSAGE, isValidDrivingLicence, normalizeDrivingLicence } from "@repo/schemas";

import { cn } from "@/lib/utils";
import { dlStatusLabel } from "@/lib/dlStatus";
import { bookingService } from "@/services/booking.service";
import { employeePaymentService } from "@/services/payment.service";
import {
  completedOperationService,
  type EditPickupBody,
  type EditReturnBody,
  type PickupSummary,
  type ReturnSummary,
  type ReturnSummaryDamage,
  type SummaryBillLine,
} from "@/services/completedOperation.service";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { DlStatusSelector } from "@/components/booking/DlStatus";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { PhotoEditor, type EditablePhoto } from "@/components/employee/completed/PhotoEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
 * Completed pickups / returns (client item 1): the read-only summary, and
 * Edit Pickup / Edit Return — the only way back into what was captured.
 */

type Phase = "PICKUP" | "RETURN";
type Summary = PickupSummary | ReturnSummary;

const FUEL_LEVELS = Array.from({ length: 10 }, (_, i) => String(i + 1));
const SEVERITIES = ["Minor", "Moderate", "Severe"] as const;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (x: unknown) => Number(x ?? 0) || 0;
const km = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("en-IN")} km`);
const fuel = (level: string | null | undefined) => (level ? `${level}/10` : "—");
const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd MMM yyyy, h:mm a") : "—");
const balance = (v: string | null | undefined) => (v == null ? "Not read" : inr(num(v)));
/** FASTag balance typed by staff: ₹ with up to 2 decimals. */
const isBalanceInput = (v: string) => /^\d{1,6}(\.\d{1,2})?$/.test(v.trim());
const BALANCE_PROBLEM = "Enter the FASTag balance in ₹ (up to 2 decimals).";
const phaseWord = (phase: Phase) => (phase === "PICKUP" ? "pickup" : "return");

const summaryKey = (phase: Phase, bookingId: string) => ["employee-completed-summary", phase, bookingId];

function useSummary(phase: Phase, bookingId: string, enabled = true) {
  return useQuery<Summary>({
    queryKey: summaryKey(phase, bookingId),
    queryFn: () =>
      phase === "PICKUP"
        ? completedOperationService.getPickupSummary(bookingId)
        : completedOperationService.getReturnSummary(bookingId),
    enabled: enabled && !!bookingId,
    retry: false,
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return isAxiosError<{ message?: string }>(error) ? error.response?.data?.message ?? fallback : fallback;
}

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

const damageBilling = (d: ReturnSummaryDamage) =>
  !d.chargeCustomer ? "Company expense" : d.billedAtDrop ? "Charged on the drop bill" : "Charged by the branch manager";

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

      <Section title="Payments">
        <Payments bookingId={summary.booking.publicId} />
      </Section>
    </div>
  );
}

// ── Edit forms ───────────────────────────────────────────────────────────────

function FuelChoice({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FUEL_LEVELS.map((lvl) => (
        <button
          key={lvl}
          type="button"
          onClick={() => onChange(lvl)}
          className={cn(
            "h-9 w-9 rounded-md border text-sm font-semibold transition-colors",
            value === lvl ? "bg-[#FF5F00] border-[#FF5F00] text-white" : "bg-white text-gray-600 hover:border-gray-400",
          )}
        >
          {lvl}
        </button>
      ))}
    </div>
  );
}

function FieldError({ children }: { children?: string | null }) {
  return children ? <p className="text-xs text-red-600 mt-1">{children}</p> : null;
}

const photosOf = (photos: { fileId: string; url: string; label?: string | null }[]): EditablePhoto[] =>
  photos.map((p) => ({ fileId: p.fileId, url: p.url, label: p.label ?? null }));

/** Files added / taken off compared with what was saved. */
function photoDiff(before: EditablePhoto[], after: EditablePhoto[]) {
  const had = new Set(before.map((p) => p.fileId));
  const has = new Set(after.map((p) => p.fileId));
  return {
    removed: before.filter((p) => !has.has(p.fileId)).map((p) => p.fileId),
    added: after.filter((p) => !had.has(p.fileId)),
  };
}

/**
 * Photos uploaded during an edit: the ones dropped before saving — or all of
 * them when the edit is closed unsaved — are deleted when the form closes.
 * Photos already saved with the booking are never deleted from here.
 */
function useEditUploads(remove: (fileId: string) => Promise<unknown>) {
  const uploaded = useRef(new Set<string>());
  const kept = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const fileId of uploaded.current) {
        if (!kept.current.has(fileId)) remove(fileId).catch(() => {});
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return {
    track: (upload: (form: FormData) => Promise<{ fileId: string; url: string }>) => async (form: FormData) => {
      const result = await upload(form);
      uploaded.current.add(result.fileId);
      return result;
    },
    keep: (fileIds: string[]) => {
      kept.current = new Set(fileIds);
    },
  };
}

interface FormProps<T> {
  summary: T;
  onSaved: (next: T) => void;
  onCancel: () => void;
}

function EditPickupForm({ summary, onSaved, onCancel }: FormProps<PickupSummary>) {
  const [odo, setOdo] = useState(summary.odometer != null ? String(summary.odometer) : "");
  const [fuelLevel, setFuelLevel] = useState<string | null>(summary.fuelLevel);
  const [fastag, setFastag] = useState(summary.fastag.balance != null ? String(Number(summary.fastag.balance)) : "");
  const [dlStatus, setDlStatus] = useState(summary.dl.status);
  const [dlNumber, setDlNumber] = useState(summary.customer.drivingLicenceNumber ?? "");
  const [photos, setPhotos] = useState<EditablePhoto[]>(() => photosOf(summary.photos));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const uploads = useEditUploads((fileId) => bookingService.deletePickupImage(fileId));

  const onFile = summary.customer.drivingLicenceNumber ?? "";
  const dlChanged = !!dlNumber.trim() && normalizeDrivingLicence(dlNumber) !== onFile;
  const body = useMemo((): EditPickupBody => {
    const out: EditPickupBody = {};
    if (odo.trim() && Number(odo) !== summary.odometer) out.odo = Number(odo);
    if (fuelLevel && fuelLevel !== summary.fuelLevel) out.pickupFuelLevel = fuelLevel;
    if (
      summary.fastag.hasFastag &&
      isBalanceInput(fastag) &&
      (summary.fastag.balance == null || Number(fastag) !== Number(summary.fastag.balance))
    ) {
      out.pickupFastagBalance = Number(fastag);
    }
    if (dlStatus && dlStatus !== summary.dl.status && dlStatus !== "DEPOSIT") out.dlStatus = dlStatus;
    if (dlChanged) out.drivingLicenceNumber = normalizeDrivingLicence(dlNumber);
    const { removed, added } = photoDiff(photosOf(summary.photos), photos);
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added.map((p) => ({ fileId: p.fileId, label: p.label ?? null }));
    return out;
  }, [odo, fuelLevel, fastag, dlStatus, dlNumber, dlChanged, photos, summary]);

  // Old pickups saved without a reading may stay without one
  const odoProblem =
    !odo.trim() && summary.odometer == null
      ? null
      : !/^\d+$/.test(odo.trim()) || Number(odo) <= 0
        ? "Enter the odometer reading in whole km."
        : null;
  const dlProblem = dlChanged && !isValidDrivingLicence(dlNumber) ? DL_INVALID_MESSAGE : null;
  const pickupFastagProblem = summary.fastag.hasFastag && fastag.trim() && !isBalanceInput(fastag) ? BALANCE_PROBLEM : null;
  const hadLabel = new Set(summary.photos.map((p) => p.label).filter(Boolean));
  const emptied = summary.captureFields.filter((f) => f.required && hadLabel.has(f.name) && !photos.some((p) => p.label === f.name));
  const blocker =
    odoProblem ??
    pickupFastagProblem ??
    dlProblem ??
    (summary.photos.length > 0 && photos.length === 0
      ? "Keep at least one pickup photo — replace a photo rather than removing them all."
      : null) ??
    (emptied.length ? `Take the required photo${emptied.length > 1 ? "s" : ""}: ${emptied.map((f) => f.name).join(", ")}.` : null) ??
    (uploading ? "Wait for the photos to upload." : null);
  const changed = Object.keys(body).length > 0;

  const save = async () => {
    if (blocker || !changed) return;
    setSaving(true);
    setFieldError(null);
    setFormError(null);
    try {
      const res = await completedOperationService.editPickup(summary.booking.publicId, body);
      uploads.keep(photos.map((p) => p.fileId));
      toast.success("Pickup updated");
      onSaved(res.data);
    } catch (error) {
      const data = isAxiosError<{ field?: string; code?: string; message?: string }>(error) ? error.response?.data : undefined;
      const message = errorMessage(error, "Couldn't save the changes. Try again.");
      const field =
        data?.field ??
        (data?.code === "INVALID_DL_NUMBER" || data?.code === "DL_NUMBER_REQUIRED" || data?.code === "DL_IN_USE"
          ? "drivingLicenceNumber"
          : data?.code?.startsWith("DL_STATUS")
            ? "dlStatus"
            : undefined);
      if (field) setFieldError({ field, message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="edit-odo">Odometer at pickup (km)</Label>
          <Input
            id="edit-odo"
            inputMode="numeric"
            value={odo}
            onChange={(e) => setOdo(e.target.value.replace(/[^0-9]/g, ""))}
            className={cn("mt-1.5", (errorFor("odo") || (odo && odoProblem)) && "border-red-500")}
          />
          <FieldError>{errorFor("odo") ?? (odo ? odoProblem : null)}</FieldError>
          {!errorFor("odo") && summary.edit.odometerCheckedAgainstCharges && (
            <p className="text-xs text-muted-foreground mt-1">
              The drop already worked out km from this reading — a change that alters the km charge is refused.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="edit-dl-number">Driving licence number</Label>
          <Input
            id="edit-dl-number"
            value={dlNumber}
            onChange={(e) => setDlNumber(e.target.value.toUpperCase())}
            placeholder="e.g. KA01 20110012345"
            className={cn("mt-1.5 font-mono", (errorFor("drivingLicenceNumber") || dlProblem) && "border-red-500")}
          />
          <FieldError>{errorFor("drivingLicenceNumber") ?? dlProblem}</FieldError>
        </div>
      </div>

      <div>
        <Label>Fuel level at pickup</Label>
        <div className="mt-1.5">
          <FuelChoice value={fuelLevel} onChange={setFuelLevel} />
        </div>
        <FieldError>{errorFor("pickupFuelLevel")}</FieldError>
      </div>

      {summary.fastag.hasFastag && (
        <div className="max-w-xs">
          <Label htmlFor="edit-pickup-fastag">FASTag balance at pickup (₹)</Label>
          <Input
            id="edit-pickup-fastag"
            inputMode="decimal"
            value={fastag}
            onChange={(e) => setFastag(e.target.value.replace(/[^0-9.]/g, ""))}
            className={cn("mt-1.5", (errorFor("pickupFastagBalance") || pickupFastagProblem) && "border-red-500")}
          />
          <FieldError>{errorFor("pickupFastagBalance") ?? pickupFastagProblem}</FieldError>
          {!errorFor("pickupFastagBalance") && summary.edit.fastagCheckedAgainstCharges && (
            <p className="text-xs text-muted-foreground mt-1">
              The drop billed FASTag from this balance — a change that alters the FASTag charge is refused.
            </p>
          )}
        </div>
      )}

      {summary.edit.dlStatusEditable ? (
        <div>
          <DlStatusSelector id="edit-dl-status" value={dlStatus} onValueChange={setDlStatus} error={errorFor("dlStatus")} />
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium">Original driving licence: {dlStatusLabel(summary.dl.status)}</p>
          {summary.edit.dlStatusLockedReason && (
            <p className="text-xs text-muted-foreground mt-0.5">{summary.edit.dlStatusLockedReason}</p>
          )}
        </div>
      )}

      <div>
        <Label>Pickup photos</Label>
        <div className="mt-2">
          <PhotoEditor
            fields={summary.captureFields}
            value={photos}
            onChange={setPhotos}
            onBusyChange={setUploading}
            upload={uploads.track((form) => bookingService.uploadPickupImage(form))}
          />
        </div>
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {formError}
        </div>
      )}

      <DialogFooter className="gap-2">
        {blocker && <p className="text-xs text-muted-foreground sm:mr-auto self-center">{blocker}</p>}
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!!blocker || !changed || saving} className="bg-[#FF5F00] hover:bg-[#e65500]">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Save changes
        </Button>
      </DialogFooter>
    </div>
  );
}

interface DamageDraft {
  area: string;
  description: string;
  severity: string;
  photos: EditablePhoto[];
}

function EditReturnForm({ summary, onSaved, onCancel }: FormProps<ReturnSummary>) {
  const [endOdo, setEndOdo] = useState(summary.odometer.end != null ? String(summary.odometer.end) : "");
  const [fuelLevel, setFuelLevel] = useState<string | null>(summary.fuel.return);
  const [fastag, setFastag] = useState(summary.fastag.balance != null ? String(Number(summary.fastag.balance)) : "");
  const [photos, setPhotos] = useState<EditablePhoto[]>(() => photosOf(summary.photos));
  const [damages, setDamages] = useState<Record<string, DamageDraft>>(() =>
    Object.fromEntries(
      summary.damages.map((d) => [
        d.publicId,
        { area: d.area, description: d.description, severity: d.severity, photos: photosOf(d.photos) },
      ]),
    ),
  );
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const uploads = useEditUploads((fileId) => bookingService.deleteReturnImage(fileId));

  const body = useMemo((): EditReturnBody => {
    const out: EditReturnBody = {};
    if (endOdo.trim() && Number(endOdo) !== summary.odometer.end) out.endOdometer = Number(endOdo);
    if (summary.edit.fuelEditable && fuelLevel && fuelLevel !== summary.fuel.return) out.returnFuelLevel = fuelLevel;
    if (
      summary.fastag.hasFastag &&
      isBalanceInput(fastag) &&
      (summary.fastag.balance == null || Number(fastag) !== Number(summary.fastag.balance))
    ) {
      out.returnFastagBalance = Number(fastag);
    }
    const { removed, added } = photoDiff(photosOf(summary.photos), photos);
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added.map((p) => ({ fileId: p.fileId }));
    const edits: NonNullable<EditReturnBody["damages"]> = [];
    for (const d of summary.damages) {
      const draft = damages[d.publicId];
      if (!d.editable || !draft) continue;
      const entry: NonNullable<EditReturnBody["damages"]>[number] = { publicId: d.publicId };
      if (draft.area.trim() !== d.area) entry.area = draft.area.trim();
      if (draft.description.trim() !== d.description) entry.description = draft.description.trim();
      if (draft.severity !== d.severity) entry.severity = draft.severity as (typeof SEVERITIES)[number];
      const diff = photoDiff(photosOf(d.photos), draft.photos);
      if (diff.removed.length) entry.removeFileIds = diff.removed;
      if (diff.added.length) entry.addPhotoIds = diff.added.map((p) => p.fileId);
      if (Object.keys(entry).length > 1) edits.push(entry);
    }
    if (edits.length) out.damages = edits;
    return out;
  }, [endOdo, fuelLevel, fastag, photos, damages, summary]);

  const odo = summary.odometer;
  const endProblem = !endOdo.trim()
    ? odo.end != null ? "Enter the odometer reading at drop." : null
    : !/^\d+$/.test(endOdo.trim())
      ? "Enter a whole number of km."
      : odo.measured && odo.start != null && Number(endOdo) < odo.start
        ? `End odometer can't be less than ${odo.swapCount > 0 ? "the replacement vehicle's reading at the swap" : "the pickup reading"} (${km(odo.start)}).`
        : null;
  const damageProblem =
    summary.damages
      .filter((d) => d.editable && damages[d.publicId])
      .map((d) => {
        const draft = damages[d.publicId]!;
        if (!draft.area.trim()) return "Enter the damaged area.";
        if (draft.description.trim().length < 3) return "Describe the damage (at least 3 characters).";
        if (draft.photos.length === 0) return "Keep at least one photo of each damage.";
        return null;
      })
      .find(Boolean) ?? null;
  const returnFastagProblem = summary.fastag.hasFastag && fastag.trim() && !isBalanceInput(fastag) ? BALANCE_PROBLEM : null;
  const blocker =
    endProblem ??
    (summary.photos.length > 0 && photos.length === 0
      ? "Keep at least one return photo — replace a photo rather than removing them all."
      : null) ??
    returnFastagProblem ??
    damageProblem ??
    (Object.values(uploading).some(Boolean) ? "Wait for the photos to upload." : null);
  const changed = Object.keys(body).length > 0;
  const setDamage = (publicId: string, patch: Partial<DamageDraft>) =>
    setDamages((all) => ({ ...all, [publicId]: { ...all[publicId]!, ...patch } }));

  const save = async () => {
    if (blocker || !changed) return;
    setSaving(true);
    setFieldError(null);
    setFormError(null);
    try {
      const res = await completedOperationService.editReturn(summary.booking.publicId, body);
      uploads.keep([...photos, ...Object.values(damages).flatMap((d) => d.photos)].map((p) => p.fileId));
      toast.success("Return updated");
      onSaved(res.data);
    } catch (error) {
      const data = isAxiosError<{ field?: string }>(error) ? error.response?.data : undefined;
      const message = errorMessage(error, "Couldn't save the changes. Try again.");
      if (data?.field === "endOdometer" || data?.field === "returnFuelLevel" || data?.field === "returnFastagBalance") {
        setFieldError({ field: data.field, message });
      } else {
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        <Info className="h-4 w-4 shrink-0" />
        Charges, discounts and the safety deposit can't be changed here. A reading that would change a charge already
        worked out is refused — ask the branch manager to adjust the bill.
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="edit-end-odo">Odometer at drop (km)</Label>
          <Input
            id="edit-end-odo"
            inputMode="numeric"
            value={endOdo}
            onChange={(e) => setEndOdo(e.target.value.replace(/[^0-9]/g, ""))}
            className={cn("mt-1.5", (errorFor("endOdometer") || (endOdo && endProblem)) && "border-red-500")}
          />
          <FieldError>{errorFor("endOdometer") ?? (endOdo ? endProblem : null)}</FieldError>
          {!errorFor("endOdometer") && !(endOdo && endProblem) && (
            <p className="text-xs text-muted-foreground mt-1">
              {odo.swapCount > 0 && odo.start != null
                ? `Replacement car started at ${km(odo.start)}.`
                : `Pickup reading: ${km(odo.pickup)}.`}
            </p>
          )}
        </div>
        <div>
          <Label>Fuel level at drop</Label>
          {summary.edit.fuelEditable ? (
            <>
              <div className="mt-1.5">
                <FuelChoice value={fuelLevel} onChange={setFuelLevel} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">At pickup: {fuel(summary.fuel.pickup)}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1.5">No fuel reading was kept for this rental.</p>
          )}
          <FieldError>{errorFor("returnFuelLevel")}</FieldError>
        </div>
      </div>

      {summary.fastag.hasFastag && (
        <div className="max-w-xs">
          <Label htmlFor="edit-return-fastag">FASTag balance at drop (₹)</Label>
          <Input
            id="edit-return-fastag"
            inputMode="decimal"
            value={fastag}
            onChange={(e) => setFastag(e.target.value.replace(/[^0-9.]/g, ""))}
            className={cn("mt-1.5", (errorFor("returnFastagBalance") || returnFastagProblem) && "border-red-500")}
          />
          <FieldError>{errorFor("returnFastagBalance") ?? returnFastagProblem}</FieldError>
          {!errorFor("returnFastagBalance") && !returnFastagProblem && (
            <p className="text-xs text-muted-foreground mt-1">
              At the handover: {balance(summary.fastag.startBalance)}. A change that alters the FASTag charge is refused.
            </p>
          )}
        </div>
      )}

      <div>
        <Label>Return photos</Label>
        <div className="mt-2">
          <PhotoEditor
            value={photos}
            onChange={setPhotos}
            onBusyChange={(busy) => setUploading((all) => ({ ...all, return: busy }))}
            upload={uploads.track((form) => bookingService.uploadReturnImage(form))}
          />
        </div>
      </div>

      {summary.damages.map((d) => {
        const draft = damages[d.publicId];
        return (
          <div key={d.publicId} className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-semibold">Damage found at drop</p>
            {!d.editable || !draft ? (
              <>
                <p className="text-sm">
                  {d.area} · {d.severity}
                </p>
                {d.description && <p className="text-sm text-gray-700">{d.description}</p>}
                <p className="text-xs text-muted-foreground">Reviewed by the branch manager — only they can change it.</p>
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`area-${d.publicId}`}>Damaged area</Label>
                    <Input
                      id={`area-${d.publicId}`}
                      value={draft.area}
                      maxLength={120}
                      onChange={(e) => setDamage(d.publicId, { area: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>Severity</Label>
                    <div className="flex gap-1.5 mt-1.5">
                      {SEVERITIES.map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setDamage(d.publicId, { severity: sev })}
                          className={cn(
                            "px-3 h-9 rounded-md border text-sm font-medium",
                            draft.severity === sev ? "bg-[#FF5F00] border-[#FF5F00] text-white" : "bg-white text-gray-700",
                          )}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor={`desc-${d.publicId}`}>What's damaged</Label>
                  <Textarea
                    id={`desc-${d.publicId}`}
                    value={draft.description}
                    maxLength={1000}
                    onChange={(e) => setDamage(d.publicId, { description: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {num(d.amount) > 0 ? `${inr(num(d.amount))} · ` : ""}
                  {damageBilling(d)} — the amount can't be changed here.
                </p>
                <PhotoEditor
                  value={draft.photos}
                  onChange={(next) => setDamage(d.publicId, { photos: next })}
                  onBusyChange={(busy) => setUploading((all) => ({ ...all, [d.publicId]: busy }))}
                  upload={uploads.track((form) => bookingService.uploadDamageImage(form))}
                />
              </>
            )}
          </div>
        );
      })}

      {formError && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {formError}
        </div>
      )}

      <DialogFooter className="gap-2">
        {blocker && <p className="text-xs text-muted-foreground sm:mr-auto self-center">{blocker}</p>}
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!!blocker || !changed || saving} className="bg-[#FF5F00] hover:bg-[#e65500]">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Save changes
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Dialog: summary, or the edit form ────────────────────────────────────────

interface CompletedOperationDialogProps {
  phase: Phase;
  bookingId: string | null;
  /** Opens straight on Edit Pickup / Edit Return. */
  startInEdit?: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a save (e.g. reload the queue). */
  onSaved?: () => void;
}

export function CompletedOperationDialog({ phase, bookingId, startInEdit = false, onOpenChange, onSaved }: CompletedOperationDialogProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(startInEdit);
  const { data: summary, isLoading, isError } = useSummary(phase, bookingId ?? "", !!bookingId);

  useEffect(() => {
    if (bookingId) setEditing(startInEdit);
  }, [bookingId, startInEdit]);

  const title = editing ? (phase === "PICKUP" ? "Edit Pickup" : "Edit Return") : phase === "PICKUP" ? "Pickup" : "Return";

  return (
    <Dialog open={!!bookingId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {summary?.state && summary.state !== "PENDING" && !editing && (
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
        ) : editing && summary.edit.allowed ? (
          summary.phase === "PICKUP" ? (
            <EditPickupForm
              summary={summary}
              onCancel={() => setEditing(false)}
              onSaved={(next) => {
                qc.setQueryData(summaryKey(phase, summary.booking.publicId), next);
                setEditing(false);
                onSaved?.();
              }}
            />
          ) : (
            <EditReturnForm
              summary={summary}
              onCancel={() => setEditing(false)}
              onSaved={(next) => {
                qc.setQueryData(summaryKey(phase, summary.booking.publicId), next);
                setEditing(false);
                onSaved?.();
              }}
            />
          )
        ) : (
          <>
            <SummaryContent summary={summary} />
            {summary.edit.allowed && (
              <DialogFooter>
                <Button onClick={() => setEditing(true)} className="bg-[#FF5F00] hover:bg-[#e65500] gap-1.5">
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
 * done: the read-only summary, with Edit Pickup / Edit Return.
 */
export function CompletedOperationPage({ phase, bookingId }: { phase: Phase; bookingId: string }) {
  const { data: summary, isLoading, isError } = useSummary(phase, bookingId);
  const [editOpen, setEditOpen] = useState(false);

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
              <Button onClick={() => setEditOpen(true)} className="bg-[#FF5F00] hover:bg-[#e65500] gap-1.5">
                <Pencil className="h-4 w-4" />
                {phase === "PICKUP" ? "Edit Pickup" : "Edit Return"}
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

      <CompletedOperationDialog
        phase={phase}
        bookingId={editOpen ? bookingId : null}
        startInEdit
        onOpenChange={(open) => !open && setEditOpen(false)}
        onSaved={() => setEditOpen(false)}
      />
    </div>
  );
}
