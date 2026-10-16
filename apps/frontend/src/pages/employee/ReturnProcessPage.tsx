import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import apiClient from "@/lib/axios";
import { bookingService, type EmployeeBooking } from "@/services/booking.service";
import { paymentSessionService, type ReturnSessionResponse } from "@/services/paymentSession.service";
import { dropService, dropErrorCode } from "@/services/drop.service";
import { apiErrorMessage } from "@/lib/counterErrors";
import { StepCard } from "@/components/employee/StepCard";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";
import { depositRefundOnSession } from "@/lib/counterPayment";
import { SafetyDepositChoice } from "@/components/payment/counter/SafetyDepositChoice";
import { LegacyRemainingPaymentCard } from "@/components/payment/counter/LegacyRemainingPaymentCard";
import type { SafetyDepositHandling } from "@/services/paymentSession.service";
import { employeePaymentService } from "@/services/payment.service";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { DropDamageSection } from "@/components/employee/drop/DropDamageSection";
import { DropDiscountPanel, type DropDiscountInput } from "@/components/employee/drop/DropDiscountPanel";
import { previewKmCharge, type KmChargeFigures } from "@/components/employee/drop/kmCharge";
import { RentalTimelineCard } from "@/components/employee/drop/RentalTimelineCard";
import { LateReturnPanel, type LateReturnOptions } from "@/components/employee/drop/LateReturnPanel";
import { DropBillSummary, LegacyReturnChargesSummary } from "@/components/employee/drop/DropBillSummary";
import { SwapChargesNote } from "@/components/employee/drop/SwapChargesNote";
import { DropOdometerFields } from "@/components/employee/drop/DropOdometerFields";
import { FastagReturnField, FastagUsageNotes } from "@/components/employee/drop/FastagReturnField";
import { readFastagBalance } from "@/components/employee/drop/fastag";
import { ExtendBookingModal } from "@/components/employee/extension/ExtendBookingModal";
import { DlStatusPanel } from "@/components/booking/DlStatus";
import { SwapVehicleAction } from "@/components/employee/swap/SwapVehicleAction";
import {
  HandoverConditionPhotos,
  handoverReferenceHeading,
  hasHandoverReference,
  type ReturnConditionCaptures,
} from "@/components/employee/drop/HandoverConditionPhotos";
import { BookingSwapHistory } from "@/components/employee/swap/BookingSwapHistory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Upload,
  Trash2,
  ArrowLeft,
  Fuel,
  AlertTriangle,
  FileCheck,
  X,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  CalendarPlus,
  Info,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn, compressImage } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge, type LightboxItem } from "@/components/ui/PhotoLightbox";
import { CompletedOperationPage, PendingAdjustment } from "@/components/employee/completed/CompletedOperation";
import {
  damageDraftOf,
  damageDraftProblem,
  damageEdit,
  errorMessage,
  isMoneyInput,
  moneyText,
  photoDiff,
  photosOf,
  sameMoney,
  useEditUploads,
  useSummary,
  type DamageDraft,
} from "@/components/employee/completed/completedEdit";
import { EditSaveBar, EditSavedCard, PendingAdjustmentCard } from "@/components/employee/completed/OperationEditFlow";
import { useEditSaveFlow } from "@/components/employee/completed/useEditSaveFlow";
import { DropDamageEditor } from "@/components/employee/completed/DropDamageEditor";
import { PhotoEditor, type EditablePhoto } from "@/components/employee/completed/PhotoEditor";
import {
  completedOperationService,
  isCompletedForPhase,
  type EditReturnBody,
  type ReturnSummary,
} from "@/services/completedOperation.service";

const FUEL_LEVEL_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const FUEL_LEVEL_ORDER: Record<string, number> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [String(i + 1), i + 1])
);

// ── Stable page shell (must be defined OUTSIDE the page component so React
//    never remounts the subtree — an inline component would get a new function
//    reference on every render, causing unmount/remount and losing file inputs)
interface ReturnPageShellProps {
  children: React.ReactNode;
  isCompleted: boolean;
  bookingStatus: string;
  bookingPublicId: string;
  customerName: string;
  vehicleRegNo?: string;
  onBack: () => void;
  headerActions?: React.ReactNode;
  /** DL status reminder under the header (#3). */
  dlStatusBlock?: React.ReactNode;
  /** Original / extended / late rental time (#7). */
  rentalTimelineBlock?: React.ReactNode;
  /** "Swap vehicle" only while no drop bill (RETURN session) has been started (#13). */
  canSwap: boolean;
  /** The drop was recorded and sent for the branch manager's confirmation. */
  awaitingManager: boolean;
  /** "Edit Return" when a completed drop is corrected (client item 1). */
  title?: string;
}

function ReturnPageShell({
  children,
  isCompleted,
  bookingStatus,
  bookingPublicId,
  customerName,
  vehicleRegNo,
  onBack,
  headerActions,
  dlStatusBlock,
  rentalTimelineBlock,
  canSwap,
  awaitingManager,
  title = "Return Inspection",
}: ReturnPageShellProps) {
  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      <DashboardNavbar />
      <div className="container mx-auto max-w-3xl py-8 space-y-6 px-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/employee/dashboard">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/employee/dashboard">Returns</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight text-primary">{title}</h1>
              <Badge
                variant={isCompleted ? "outline" : "secondary"}
                className={cn("uppercase px-3 py-1", isCompleted && "bg-green-100 text-green-700 border-green-200")}
              >
                {bookingStatus.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm flex items-center gap-4">
              <span>
                License: <span className="font-mono text-foreground font-medium">{vehicleRegNo}</span>
              </span>
              <span>•</span>
              <span>
                Customer: <span className="font-medium text-foreground">{customerName}</span>
              </span>
              <span>•</span>
              <span>Ref: #{bookingPublicId.substring(0, 8)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            {/* Swap the car mid-rental (#13) — PICKED_UP, before the drop bill; the dialog shows any server refusal */}
            {canSwap && <SwapVehicleAction bookingPublicId={bookingPublicId} bookingStatus={bookingStatus} />}
            <Button
              variant="outline"
              className="border-orange-500 text-orange-500 hover:bg-orange-50 px-6"
              onClick={onBack}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        </div>

        {rentalTimelineBlock}

        {dlStatusBlock}

        {/* Vehicle swaps on this booking (#13) — hidden until there is one */}
        <BookingSwapHistory bookingPublicId={bookingPublicId} />

        {isCompleted && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-3">
            <FileCheck className="h-5 w-5" />
            <div>
              <p className="font-semibold">Return Completed</p>
              <p className="text-sm">This vehicle has been returned and processed.</p>
            </div>
          </div>
        )}

        {awaitingManager && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Waiting for the branch manager</p>
              <p className="text-sm">
                This return was recorded and sent to the branch manager to confirm. Nothing more to do here.
              </p>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

// ── Charge fields shared by the drop and Edit Return ───────────────────────────

interface OtherChargeItem {
  id: string;
  label: string;
  amount: string;
}

/** Fuel level at return (1–10), against the level the vehicle started with. */
function ReturnFuelLevelField({
  value,
  onChange,
  disabled,
  pickupFuelLevel,
  swappedWithReadings,
  deficitHint,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  pickupFuelLevel: string | null;
  swappedWithReadings: boolean;
  /** Lower than at pickup and not charged yet */
  deficitHint: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium flex items-center gap-2">
        <Fuel className="h-4 w-4 text-muted-foreground" />
        Return Fuel Level
      </Label>
      {pickupFuelLevel && (
        <p className="text-xs text-muted-foreground">
          {swappedWithReadings ? "Level at the swap (this vehicle)" : "Pickup level"}:{" "}
          <span className="font-medium text-foreground">{FUEL_LEVEL_OPTIONS.find((o) => o.value === pickupFuelLevel)?.label ?? pickupFuelLevel}</span>
        </p>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-11 max-w-xs">
          <SelectValue placeholder="Select fuel level at return" />
        </SelectTrigger>
        <SelectContent>
          {FUEL_LEVEL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {deficitHint && (
        <p className="text-xs text-amber-600">Return fuel is lower than pickup — check the box below to charge.</p>
      )}
    </div>
  );
}

/** Fuel deficit charged to the customer (no GST). */
function FuelDeficitCharge({
  checked,
  onCheckedChange,
  amount,
  onAmountChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 p-4 rounded-lg border bg-amber-50/40 border-amber-200">
      <div className="flex items-center gap-3">
        <Checkbox
          id="fuelDeficit"
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(!!v)}
          disabled={disabled}
        />
        <Label htmlFor="fuelDeficit" className="text-sm font-semibold cursor-pointer text-amber-900 flex items-center gap-2">
          <Fuel className="h-4 w-4" /> Fuel Deficit — charge customer
        </Label>
      </div>
      {checked && (
        <div className="space-y-1.5 ml-7">
          <Label className="text-xs text-neutral-600">Fuel Deficit Charge (₹, no GST)</Label>
          <div className="relative max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
            <Input
              type="number"
              min="0"
              className="pl-7 h-10"
              placeholder="e.g. 300"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Typed FASTag / toll charge — when the balances can't measure the usage. */
function FastagTollCharge({
  checked,
  onCheckedChange,
  amount,
  onAmountChange,
  notes,
  onNotesChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 p-4 rounded-lg border bg-green-50/40 border-green-200">
      <div className="flex items-center gap-3">
        <Checkbox
          id="fastagChecked"
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(!!v)}
          disabled={disabled}
        />
        <Label htmlFor="fastagChecked" className="text-sm font-semibold cursor-pointer text-green-900 flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> FASTag Toll Charges — charge customer
        </Label>
      </div>
      {checked && (
        <div className="ml-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Amount (₹)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input
                type="number"
                min="0"
                className="pl-7 h-10"
                placeholder="e.g. 150"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Notes (optional)</Label>
            <Input
              className="h-10"
              placeholder="Route / toll plaza..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Other / additional drop charges, line by line (no GST). */
function OtherChargesFields({
  checked,
  onCheckedChange,
  items,
  onItemsChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  items: OtherChargeItem[];
  /** `typed`: a line's description / amount was edited (not a line added or removed) */
  onItemsChange: (next: OtherChargeItem[], typed: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 p-4 rounded-lg border bg-purple-50/40 border-purple-200">
      <div className="flex items-center gap-3">
        <Checkbox
          id="hasOtherCharges"
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(!!v)}
          disabled={disabled}
        />
        <Label htmlFor="hasOtherCharges" className="text-sm font-semibold cursor-pointer text-purple-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Other / Additional Charges
        </Label>
      </div>
      {checked && (
        <div className="ml-7 space-y-3">
          <p className="text-xs text-neutral-600">
            Charged as entered — drop charges carry no GST. Late return is charged automatically, so don't add it here.
          </p>
          {items.map((item) => (
            <div key={item.id} className="flex gap-2 items-center">
              <Input
                className="h-10 flex-1"
                placeholder="Description (e.g. Interior cleaning)"
                value={item.label}
                onChange={(e) => onItemsChange(items.map((c) => c.id === item.id ? { ...c, label: e.target.value } : c), true)}
                disabled={disabled}
              />
              <div className="relative w-32 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                <Input
                  type="number"
                  min="0"
                  className="pl-7 h-10"
                  placeholder="0"
                  value={item.amount}
                  onChange={(e) => onItemsChange(items.map((c) => c.id === item.id ? { ...c, amount: e.target.value } : c), true)}
                  disabled={disabled}
                />
              </div>
              {items.length > 1 && !disabled && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 text-red-500 hover:text-red-700 shrink-0"
                  onClick={() => onItemsChange(items.filter((c) => c.id !== item.id), false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-purple-700 border-purple-300 hover:bg-purple-50"
              onClick={() => onItemsChange([...items, { id: Date.now().toString(), label: "", amount: "" }], false)}
            >
              + Add Another Charge
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The drop is refused while an edit's money difference is open (409
 * ADJUSTMENT_PENDING): that difference, settled right here from the pickup's
 * summary — then the drop carries on.
 */
function AdjustmentPendingNotice({ bookingPublicId, message }: { bookingPublicId: string; message: string }) {
  const { data: summary, isLoading } = useSummary("PICKUP", bookingPublicId);
  const record = summary?.pendingAdjustment ?? null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-3 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Settle the edit's difference first</p>
          <p className="text-sm">{message}</p>
        </div>
      </div>
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-[#FF5F00]" />
      ) : summary && record ? (
        <div className="rounded-lg border bg-white px-3">
          <PendingAdjustment summary={summary} record={record} />
        </div>
      ) : summary ? (
        <p className="text-sm font-medium text-green-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> The difference is settled — carry on with the drop.
        </p>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link to={`/staff/pickups/${bookingPublicId}`}>Open the pickup summary</Link>
        </Button>
      )}
    </div>
  );
}

export default function ReturnProcessPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Edit Return (client item 1): ?edit=1 on a completed drop opens this workflow again
  const [searchParams] = useSearchParams();
  const editRequested = searchParams.get("edit") === "1";

  // ── Photos ─────────────────────────────────────────────────────────────────
  const [returnPhotos, setReturnPhotos] = useState<{ publicId: string; url: string }[]>([]);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const openLightbox = (items: LightboxItem[], index: number) => setLightbox({ items, index });

  // ── Charge inputs ──────────────────────────────────────────────────────────
  const [endOdometer, setEndOdometer] = useState("");
  const [returnFuelLevel, setReturnFuelLevel] = useState("");
  // fuel deficit
  const [fuelDeficit, setFuelDeficit] = useState(false);
  const [fuelCharge, setFuelCharge] = useState("");
  // fastag
  const [fastagChecked, setFastagChecked] = useState(false);
  const [fastagAmount, setFastagAmount] = useState("");
  const [fastagNotes, setFastagNotes] = useState("");
  // FASTag balance now — the bill charges the usage since pickup from the balances
  const [fastagNow, setFastagNow] = useState("");
  // other charges
  const [hasOtherCharges, setHasOtherCharges] = useState(false);
  const [otherChargeItems, setOtherChargeItems] = useState<OtherChargeItem[]>([
    { id: "1", label: "", amount: "" },
  ]);

  // Late return (automatic charge): MANUAL-grace tick and the staff waiver — resent with every compute
  const [lateOptions, setLateOptions] = useState<LateReturnOptions>({ applyGrace: false, waiver: null });
  const [lateError, setLateError] = useState<string | null>(null);
  // Extra km typed by staff — only after a mid-rental swap recorded without odometer readings
  const [manualExtraKm, setManualExtraKm] = useState("");

  // ── Session ────────────────────────────────────────────────────────────────
  const [returnSession, setReturnSession] = useState<ReturnSessionResponse | null>(null);
  // A drop bill (RETURN session) exists on the server — computed here or found on reload,
  // even if cleared for edits. The vehicle can't be swapped from then on.
  const [returnSessionStarted, setReturnSessionStarted] = useState(false);
  // Discount the server accepted — resent with every compute or it is dropped.
  const [appliedDiscount, setAppliedDiscount] = useState<DropDiscountInput | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  // Safety deposit at drop (#6): set off (default) or refunded in full — resent with every
  // compute. The ref feeds a recompute started in the same tick as the change.
  const [depositHandling, setDepositHandling] = useState<SafetyDepositHandling>("SET_OFF");
  const depositHandlingRef = useRef<SafetyDepositHandling>("SET_OFF");
  const [showExtendModal, setShowExtendModal] = useState(false);

  // An edit's difference still to settle blocks the drop (409 ADJUSTMENT_PENDING): the server's message
  const [adjustmentBlock, setAdjustmentBlock] = useState<string | null>(null);

  // ── Damage ─────────────────────────────────────────────────────────────────
  // damageDecision: null = not yet decided, "NO_DAMAGE" = no damage, "DAMAGE_FOUND" = damage recorded at drop
  const [damageDecision, setDamageDecision] = useState<"NO_DAMAGE" | "DAMAGE_FOUND" | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: booking, isLoading, error } = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () => bookingService.getReturnDetails(bookingId!),
    enabled: !!bookingId,
    refetchOnWindowFocus: false,
  });

  // Handover photos of the car being returned (pickup, or its mid-rental swap — item 2)
  const { data: pickupCapturesData } = useQuery<ReturnConditionCaptures>({
    queryKey: ["pickup-captures", bookingId],
    queryFn: () => apiClient.get(`/employee/return/${bookingId}/pickup-captures`).then((r) => r.data),
    enabled: !!bookingId,
    refetchOnWindowFocus: false,
  });
  const showHandoverReference = hasHandoverReference(pickupCapturesData);
  const handoverHeading = handoverReferenceHeading(pickupCapturesData);

  const { data: dropDamagesData, refetch: refetchDropDamages } = useQuery({
    queryKey: ["drop-damages", bookingId],
    queryFn: () => dropService.listDamages(bookingId!),
    enabled: !!bookingId && !!booking,
    refetchOnWindowFocus: false,
  });
  const dropDamages = dropDamagesData ?? [];

  // ── Derived state ──────────────────────────────────────────────────────────
  const frozenConfig = booking?.frozenChargeConfig;
  const useSessionFlow = booking?.usePaymentSessions === true;
  const vehicle = booking?.items[0]?.vehicle;
  const safetyDeposit = parseFloat(booking?.safetyDeposit ?? "0") || 0;
  const isCompleted = booking?.status === "RETURNED" || booking?.status === "COMPLETED";

  // Deposit still held and anything already on credit (#6 / #11). Once a drop bill is
  // computed its own deposit block is used instead.
  const { data: financialState } = useQuery({
    queryKey: ["employee-financial-state", bookingId],
    queryFn: () => employeePaymentService.getFinancialState(bookingId!),
    enabled: !!bookingId && !!booking && !isCompleted,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const depositHeld = returnSession?.deposit
    ? parseFloat(returnSession.deposit.held) || 0
    : financialState?.safetyDepositHeld != null
      ? parseFloat(financialState.safetyDepositHeld) || 0
      : safetyDeposit;
  const creditPending = parseFloat(financialState?.creditPending ?? "0") || 0;
  const creditCollateral = financialState?.credit?.collateral ?? [];
  // Legacy branches: an advance booking's balance is settled at the counter before the return
  const legacyRemainingDue =
    booking?.usePaymentSessions !== true &&
    booking?.isAdvancePayment === true &&
    !booking.remainingPaidAt &&
    (parseFloat(booking.remainingBalance ?? "0") || 0) > 0;

  const paymentSettled = returnSession?.session?.status === "COMPLETED";
  const netPayable = returnSession ? parseFloat(returnSession.session.netPayable) : 0;
  const isZeroBalance = returnSession !== null && netPayable === 0;
  // "Refund in full" bill (#6): the deposit is paid back with the settlement — the panel asks how
  const refundsDepositInFull = !!returnSession && depositRefundOnSession(returnSession.session) > 0;

  // FASTag balances (Oct 15 2026): READINGS → the usage since pickup is charged from
  // the balance now and the typed toll charge isn't offered; MANUAL (a reading is
  // missing) or an older server keeps the typed toll charge.
  const fastagInfo = booking?.fastag ?? null;
  const fastagFromReadings = fastagInfo?.mode === "READINGS";
  // Typed FASTag / toll charge (the fallback when the balances can't measure the
  // usage): a booking with a FASTag car is charged whatever the branch module; for
  // a car without a FASTag the branch FASTag module decides.
  const fastagManualShown =
    !fastagFromReadings &&
    (!!vehicle?.hasFastag || fastagInfo?.mode === "MANUAL" || !!frozenConfig?.fastagModuleEnabled);
  // FASTag balance now: asked for (and required) whenever the car coming back counts
  // as a FASTag car for this booking — marked, or its balance read at pickup / the swap
  const fastagNowNeeded = !!fastagInfo?.currentHasFastag;
  const fastagNowValue = fastagNowNeeded ? readFastagBalance(fastagNow).value : null;
  const fastagNowMissing = fastagNowNeeded && fastagNowValue == null;
  // Km across mid-rental swaps: swaps with readings are measured segment by segment
  // (km = earlier vehicles + end − the current vehicle's start); a swap without
  // readings leaves km unmeasurable and staff type the extra km instead.
  const kmSegments = booking?.kmSegments ?? null;
  const manualKmAllowed = !!booking?.kmAllowance?.manualExtraKmAllowed;
  const currentStartOdometer = kmSegments ? kmSegments.currentStartOdometer : booking?.startOdometer ?? null;
  const swappedWithReadings = !!kmSegments && kmSegments.swapCount > 0 && kmSegments.complete;
  const manualExtraKmValue =
    manualKmAllowed && manualExtraKm.trim() !== "" && /^\d+$/.test(manualExtraKm.trim())
      ? parseInt(manualExtraKm.trim(), 10)
      : null;
  const manualExtraKmMissing = manualKmAllowed && manualExtraKmValue == null;
  // Extra km is billed by the server; this is a read-only preview while typing.
  const endOdometerValue = endOdometer !== "" && !Number.isNaN(parseFloat(endOdometer))
    ? parseFloat(endOdometer)
    : null;
  const endOdometerTooLow =
    endOdometerValue != null && !manualKmAllowed && currentStartOdometer != null && endOdometerValue < currentStartOdometer;
  const drivenKmFallback =
    !manualKmAllowed && currentStartOdometer != null && endOdometerValue != null
      ? (kmSegments?.priorKm ?? 0) + Math.max(0, endOdometerValue - currentStartOdometer)
      : null;
  // The drop can't be billed / completed until the readings are in
  const readingsReady =
    /^\d+$/.test(endOdometer.trim()) && endOdometerValue != null && !endOdometerTooLow && !manualExtraKmMissing &&
    !fastagNowMissing;
  const kmPreview = endOdometerValue != null && booking?.kmAllowance
    ? previewKmCharge(currentStartOdometer, endOdometerValue, booking.kmAllowance, {
        priorKm: kmSegments?.priorKm ?? 0,
        segments: kmSegments?.segments ?? [],
        manualExtraKm: manualExtraKmValue,
      })
    : null;
  const serverKm = returnSession?.km;
  const kmSummary: { figures: KmChargeFigures; source: "preview" | "computed" } | null = serverKm
    ? {
        source: "computed",
        figures: {
          kmDriven: serverKm.kmDriven,
          includedKm: serverKm.includedKm,
          extraKm: serverKm.extraKm,
          extraKmRate: parseFloat(serverKm.extraKmRate) || 0,
          extraKmCharge: parseFloat(serverKm.extraKmCharge) || 0,
          extraKmEnabled: serverKm.extraKmEnabled,
          autoKmSkipped: serverKm.autoKmSkipped ?? null,
          priorKm: serverKm.priorKm ?? 0,
          segments: serverKm.segments ?? [],
          manualExtraKm: serverKm.manualExtraKm ?? null,
          kmSource: serverKm.kmSource,
          freeKmOriginal: serverKm.freeKmOriginal ?? null,
          freeKmExtensions: serverKm.freeKmExtensions ?? null,
        },
      }
    : kmPreview
      ? { source: "preview", figures: kmPreview }
      : null;
  // Rental time + late return: the last drop-bill compute's figures (return time frozen
  // on the bill), else the booking's (measured to page load while the car is out).
  const rentalTimeline = returnSession?.rentalTimeline ?? booking?.rentalTimeline ?? null;
  const billedLate = returnSession?.late ?? null;
  const swapCharges = booking?.swapCharges ?? [];
  // Fuel deficit detection
  const pickupFuelLevel = booking?.pickupFuelLevel ?? null;
  const hasFuelDeficit = returnFuelLevel && pickupFuelLevel
    ? FUEL_LEVEL_ORDER[returnFuelLevel] < FUEL_LEVEL_ORDER[pickupFuelLevel]
    : false;

  // Real money taken in this session (the deposit credit is a DEPOSIT entry, not a payment;
  // a "Refund in full" bill's SAFETY_DEPOSIT_REFUND line is part of the bill, not money paid out).
  const hasRecordedPayment = !!returnSession?.session.entries.some(
    (e) =>
      !e.isVoided &&
      (e.entryType === "PAYMENT" || e.entryType === "REFUND") &&
      e.referenceType !== "SAFETY_DEPOSIT_REFUND",
  );
  // Once money moves, the bill (damage, discount, extension) is frozen.
  const billLocked = paymentSettled || hasRecordedPayment || isCompleted;
  const shownDiscount = returnSession?.discount !== undefined
    ? returnSession.discount
    : appliedDiscount
      ? { amount: appliedDiscount.amount.toFixed(2), reason: appliedDiscount.reason }
      : null;

  // Step completion flags
  const step2Complete = returnPhotos.length > 0;
  const step3Complete = !!returnSession && returnSession.session.status !== "OPEN";
  const damageStepDone =
    damageDecision === "NO_DAMAGE" || (damageDecision === "DAMAGE_FOUND" && dropDamages.length > 0);

  // ── Auto-fill return fuel level from pickup record ─────────────────────────
  useEffect(() => {
    if (booking?.pickupFuelLevel && !returnFuelLevel) {
      setReturnFuelLevel(booking.pickupFuelLevel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.pickupFuelLevel]);

  // ── A mid-rental swap (#13) changes the vehicle being handed back: readings typed
  //    for the previous car no longer apply and the fuel default is the new car's ──
  const vehicleSig = booking
    ? `${booking.items[0]?.vehicle.publicId ?? ""}|${booking.kmSegments?.swapCount ?? 0}`
    : null;
  const vehicleSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (vehicleSig == null) return;
    const prev = vehicleSigRef.current;
    vehicleSigRef.current = vehicleSig;
    if (prev === null || prev === vehicleSig) return;
    setEndOdometer("");
    setManualExtraKm("");
    setReturnFuelLevel(booking?.pickupFuelLevel ?? "");
    setFuelDeficit(false);
    setFuelCharge("");
    setFastagNow("");
    setReturnSession(null);
    toast.info("Vehicle swapped — enter the end odometer and fuel level of the vehicle being returned now.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleSig]);

  // ── Auto-calculate fuel deficit charge from vehicle's fuelBar rate ──────────
  useEffect(() => {
    const fuelBarRate = vehicle?.fuelBar ? Number(vehicle.fuelBar) : 0;
    if (!fuelBarRate || !hasFuelDeficit || !returnFuelLevel || !pickupFuelLevel) return;
    const deficitBars = FUEL_LEVEL_ORDER[pickupFuelLevel] - FUEL_LEVEL_ORDER[returnFuelLevel];
    if (deficitBars > 0) {
      setFuelCharge(String(Math.ceil(deficitBars * fuelBarRate)));
      setFuelDeficit(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnFuelLevel, vehicle?.fuelBar]);

  // ── Restore session on page reload ─────────────────────────────────────────
  useEffect(() => {
    if (!bookingId || !useSessionFlow || returnSession || isCompleted) return;
    paymentSessionService.getActiveReturnSession(bookingId).then((session) => {
      if (!session) return;
      setReturnSessionStarted(true);
      if (session.discount) {
        setAppliedDiscount({ amount: parseFloat(session.discount.amount), reason: session.discount.reason });
      }
      // The deposit choice on that bill (#6) is resent by the next compute
      if (session.deposit?.handling) {
        depositHandlingRef.current = session.deposit.handling;
        setDepositHandling(session.deposit.handling);
      }
      if (session.km?.kmSource === "STAFF_ENTERED" && session.km.manualExtraKm != null) {
        setManualExtraKm(String(session.km.manualExtraKm));
      }
      // Computed before an extension changed the booked end / free km — that bill is stale.
      const allowance = booking?.kmAllowance;
      if (
        session.billStale ||
        (session.km && !session.km.autoKmSkipped && allowance && session.km.includedKm !== allowance.includedKm)
      ) {
        toast.info(
          session.billStaleReason === "DROP_GST_REMOVED"
            ? "Drop charges no longer carry GST — enter the readings and compute the charges again."
            : session.billStaleReason === "FASTAG_CHANGED"
              ? "The FASTag balance at pickup changed since the charges were computed — enter the readings and compute them again."
              : session.billStaleReason === "PICKUP_ODOMETER_CHANGED"
                ? "The pickup odometer reading was corrected since the charges were computed — enter the readings and compute them again."
                : "The rental changed since the charges were computed — enter the readings and compute them again.",
        );
        return;
      }
      // Late-charge choices on that bill are resent by the next compute
      if (session.late) {
        setLateOptions({
          applyGrace: session.late.graceType === "MANUAL" && session.late.graceApplied,
          waiver: session.late.waived && session.late.waiverReason ? { reason: session.late.waiverReason } : null,
        });
      }
      setReturnSession(session);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, useSessionFlow]);

  // ── Damages already recorded at drop (e.g. after a reload) mean damage was found ──
  useEffect(() => {
    if (dropDamages.length > 0 && damageDecision !== "DAMAGE_FOUND") setDamageDecision("DAMAGE_FOUND");
  }, [dropDamages.length, damageDecision]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const uploadReturnMutation = useMutation({
    mutationFn: bookingService.uploadReturnImage,
    onSuccess: (data) => {
      setReturnPhotos((prev) => [...prev, { publicId: data.fileId, url: data.url }]);
      toast.success("Return photo uploaded");
    },
    onError: () => toast.error("Failed to upload photo"),
  });

  const deleteReturnImageMutation = useMutation({
    mutationFn: bookingService.deleteReturnImage,
    onSuccess: (_, publicId) => {
      setReturnPhotos((prev) => prev.filter((img) => img.publicId !== publicId));
      toast.success("Photo removed");
    },
    // 409 FILE_IN_USE: already saved with the booking — kept on purpose
    onError: (error: any) => toast.error(error?.response?.data?.message || "Failed to remove photo"),
  });

  const buildComputePayload = (discountToSend: DropDiscountInput | null, late: LateReturnOptions) => {
    const payload: Parameters<typeof paymentSessionService.computeReturnSession>[1] = {
      endOdometer: parseFloat(endOdometer),
      returnImageIds: returnPhotos.map((p) => p.publicId),
    };
    if (late.applyGrace) payload.applyGrace = true;
    if (late.waiver) payload.waiveLateCharge = late.waiver;
    if (manualKmAllowed && manualExtraKmValue != null) payload.manualExtraKm = manualExtraKmValue;
    if (returnFuelLevel) payload.returnFuelLevel = returnFuelLevel;
    if (fuelDeficit && fuelCharge) payload.fuelCharge = parseFloat(fuelCharge);
    // With every reading the server charges the usage from the balances
    if (fastagNowValue != null) payload.returnFastagBalance = fastagNowValue;
    if (!fastagFromReadings && fastagManualShown && fastagChecked && fastagAmount) {
      payload.fastagAmount = parseFloat(fastagAmount);
      if (fastagNotes) payload.fastagNotes = fastagNotes;
    }
    if (hasOtherCharges) {
      payload.otherCharges = otherChargeItems
        .filter((c) => c.label.trim() && c.amount && parseFloat(c.amount) > 0)
        .map((c) => ({ label: c.label.trim(), amount: parseFloat(c.amount) }));
    }
    if (discountToSend) payload.discount = discountToSend;
    // Safety deposit choice (#6) — resent with every compute, like the discount
    payload.safetyDepositHandling = depositHandlingRef.current;
    return payload;
  };

  const computeChargesMutation = useMutation({
    mutationFn: ({ discount, late }: { discount: DropDiscountInput | null; late: LateReturnOptions }) =>
      paymentSessionService.computeReturnSession(bookingId!, buildComputePayload(discount, late)),
  });

  /**
   * Compute (or recompute) the RETURN bill. `trigger` only changes the feedback;
   * `discountNotice` is kept on screen after an automatic discount removal. `late`
   * (grace tick / waiver) is kept only once the server accepts it.
   */
  const runCompute = async (
    discountToSend: DropDiscountInput | null,
    trigger: "inputs" | "refresh" | "discount" | "late",
    discountNotice: string | null = null,
    late: LateReturnOptions = lateOptions,
  ): Promise<void> => {
    try {
      const sessionResponse = await computeChargesMutation.mutateAsync({ discount: discountToSend, late });
      setReturnSession(sessionResponse);
      setReturnSessionStarted(true);
      setAppliedDiscount(discountToSend);
      setLateOptions(late);
      setLateError(null);
      setDiscountError(discountNotice);
      setAdjustmentBlock(null);
      toast.success(
        trigger === "discount"
          ? discountToSend ? "Discount applied" : "Discount removed"
          : trigger === "late"
            ? late.waiver ? "Late charge waived" : "Late charge updated"
            : trigger === "refresh" ? "Charges updated" : "Charges computed",
      );
    } catch (err) {
      const message = apiErrorMessage(err, "Failed to compute charges");
      const code = dropErrorCode(err);
      if (code === "ADJUSTMENT_PENDING") {
        setAdjustmentBlock(message);
        toast.error(message);
        return;
      }
      if (code === "LATE_RATE_UNAVAILABLE") {
        // Late, but the vehicle has no extra-hour rate — staff set pricing or waive it.
        // Refresh the timeline: the car may have become late since the page loaded.
        setLateError(message);
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
        toast.error(message);
        return;
      }
      if (code === "EXTENSION_PENDING" || code === "DROP_READINGS_CHANGED") {
        // Show the unsettled extension in the rental-time block (it may be new since page load),
        // or the pickup / swap readings an edit just corrected
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      }
      if (code === "DISCOUNT_EXCEEDS_CHARGES") {
        if (trigger === "discount" || !discountToSend) {
          setDiscountError(message);
          return;
        }
        // The drop charges fell below the discount already given — drop it and rebill.
        toast.warning("Discount removed — it was more than the drop charges.");
        await runCompute(null, trigger, `${message} The discount was removed.`, late);
        return;
      }
      toast.error(message);
    }
  };

  const zeroBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!returnSession) throw new Error("No session");
      return paymentSessionService.recordPayment(returnSession.session.publicId, {
        method: "CASH",
        amount: 0,
        idempotencyKey: `zero-balance:${returnSession.session.publicId}`,
        notes: safetyDeposit > 0
          ? "Zero balance — safety deposit covered all charges"
          : "Zero balance — nothing due at return",
      });
    },
    onSuccess: (updatedSession) => {
      setReturnSession((prev) => prev ? { ...prev, session: updatedSession } : null);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      toast.success("Return settled. Vehicle marked as returned.");
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Failed to complete return"));
      handleStaleBill(err);
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatPrice = (amount: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
    }).format(Number(amount));

  const onDropReturn = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const processedFile = await compressImage(file);
        const formData = new FormData();
        formData.append("file", processedFile);
        uploadReturnMutation.mutate(formData);
      } catch {
        const formData = new FormData();
        formData.append("file", file);
        uploadReturnMutation.mutate(formData);
      }
    }
  };

  const { getRootProps: getReturnRootProps, getInputProps: getReturnInputProps } = useDropzone({
    onDrop: onDropReturn,
    accept: { "image/*": [] },
  });

  /**
   * Recompute with the readings on screen. A session restored after a reload has
   * none, so it's cleared and staff re-enter them (the discount is kept for then).
   */
  const recomputeBill = async (
    discountToSend: DropDiscountInput | null,
    trigger: "refresh" | "discount" | "late",
    late: LateReturnOptions = lateOptions,
  ): Promise<void> => {
    if (endOdometer === "") {
      setAppliedDiscount(discountToSend);
      setLateOptions(late);
      setReturnSession(null);
      toast.info("Re-enter the readings and compute the charges again.");
      return;
    }
    await runCompute(discountToSend, trigger, null, late);
  };

  /**
   * "Apply grace" / waiver changed. On a live drop bill it rebills right away (kept
   * only if the server accepts it); otherwise it is sent with the next compute /
   * completion.
   */
  const handleLateOptionsChange = (next: LateReturnOptions) => {
    setLateError(null);
    if (useSessionFlow && returnSession && !billLocked) {
      void recomputeBill(appliedDiscount, "late", next);
      return;
    }
    setLateOptions(next);
  };

  /**
   * Safety deposit choice changed (#6). A live drop bill is recomputed with it right
   * away; otherwise it is sent with the next compute (legacy: with the completion).
   */
  const handleDepositHandlingChange = (next: SafetyDepositHandling) => {
    depositHandlingRef.current = next;
    setDepositHandling(next);
    if (useSessionFlow && returnSession && !billLocked) void recomputeBill(appliedDiscount, "refresh");
  };

  /** A drop damage was added or removed — refresh the list and (session branches) the bill. */
  const handleDamagesChanged = async () => {
    await refetchDropDamages();
    if (!useSessionFlow || !returnSession || paymentSettled) return;
    await recomputeBill(appliedDiscount, "refresh");
  };

  // Damage mutations resolve after later renders (e.g. a discount applied meanwhile),
  // so they call the latest handler, not the one from the render that started them.
  const damagesChangedRef = useRef(handleDamagesChanged);
  useEffect(() => {
    damagesChangedRef.current = handleDamagesChanged;
  });
  const onDamagesChanged = () => damagesChangedRef.current();

  /** Payment refused because damages or the booked period changed since compute. */
  function handleStaleBill(err: unknown) {
    const code = dropErrorCode(err);
    // An edit's difference opened meanwhile: it is settled first (shown above the steps)
    if (code === "ADJUSTMENT_PENDING") setAdjustmentBlock(apiErrorMessage(err, "Settle the edit's difference first."));
    if (code !== "DROP_BILL_STALE") return;
    void recomputeBill(appliedDiscount, "refresh");
  }

  /** Extension changes the booked period (and free km) — the bill must be recomputed. */
  const handleExtensionSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    // Lateness is measured from the new end — a waiver given for the old one doesn't carry over
    setLateOptions({ applyGrace: false, waiver: null });
    setLateError(null);
    if (returnSession && !paymentSettled) {
      setReturnSession(null);
      toast.info("Rental extended — compute the charges again for the new return time.");
    }
  };

  const bookingVehicles = booking?.items.map((i) => i.vehicle) ?? [];

  // ── Legacy flow hooks (must be unconditional — declared before any early return) ──
  const [legacyShowCompleteDialog, setLegacyShowCompleteDialog] = useState(false);
  const [legacyHasDamage, setLegacyHasDamage] = useState(false);
  const [legacySubmissionResult, setLegacySubmissionResult] = useState<{
    success: boolean;
    message: string;
    /** Extra km / late return recorded for the branch manager to collect. */
    returnCharges?: Awaited<ReturnType<typeof bookingService.completeReturn>>["returnCharges"];
    /** FASTag usage from the balances (readings, recharge note). */
    fastag?: Awaited<ReturnType<typeof bookingService.completeReturn>>["fastag"];
    /** Deposit choice recorded with the return (#6). */
    safetyDeposit?: Awaited<ReturnType<typeof bookingService.completeReturn>>["safetyDeposit"];
  } | null>(null);

  const completeReturnMutation = useMutation({
    mutationFn: (data: Parameters<typeof bookingService.completeReturn>[1]) =>
      bookingService.completeReturn(bookingId!, data),
    onSuccess: (data) => {
      setLegacySubmissionResult({
        success: true,
        message: data.message || "Return completed",
        returnCharges: data.returnCharges,
        fastag: data.fastag,
        safetyDeposit: data.safetyDeposit,
      });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Failed to complete return"));
      // An unsettled extension / a return already sent to the manager / a changed
      // rental: refresh so the page shows why
      const code = dropErrorCode(err);
      if (code === "ADJUSTMENT_PENDING") setAdjustmentBlock(apiErrorMessage(err, "Settle the edit's difference first."));
      if (
        code === "EXTENSION_PENDING" ||
        code === "RETURN_AWAITING_MANAGER" ||
        code === "USE_DROP_BILL" ||
        code === "DROP_READINGS_CHANGED"
      ) {
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      }
    },
  });

  // ── Loading / Error ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (error || !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        Failed to load booking details
      </div>
    );
  }

  // Done (returned, or sent to a manager) before this page opened: the read-only
  // summary, never the workflow — changes go through Edit Return (client item 1),
  // this page again with ?edit=1. A drop finished on this page keeps its confirmation below.
  const completedBeforeOpen =
    isCompletedForPhase("RETURN", booking) && !paymentSettled && !legacySubmissionResult?.success;
  if (completedBeforeOpen && !editRequested) {
    return <CompletedOperationPage phase="RETURN" bookingId={booking.publicId} />;
  }

  // ── Shell props (passed to the stable ReturnPageShell component above) ──────
  // Legacy drop already recorded and sent to the manager — the vehicle is back
  const awaitingManager = booking.status === "PICKED_UP" && !!booking.requiresManagerConfirmation;
  const shellProps = {
    isCompleted,
    bookingStatus: booking.status,
    bookingPublicId: booking.publicId,
    customerName: booking.customer.user.name,
    vehicleRegNo: vehicle?.regNo,
    onBack: () => navigate("/employee/dashboard"),
    // The server refuses a swap once a drop bill exists or the return awaits the manager
    canSwap: !returnSession && !returnSessionStarted && !awaitingManager,
    awaitingManager,
    // DL status from pickup (#3): a reminder of what to hand back; Fleet can correct it while on trip.
    dlStatusBlock: (
      <DlStatusPanel
        role="employee"
        publicId={booking.publicId}
        bookingStatus={booking.status}
        dlStatus={booking.dlStatus}
        dlDepositNote={booking.dlDepositNote}
        dlStatusUpdatedAt={booking.dlStatusUpdatedAt}
        dropReminder={!isCompleted}
      />
    ),
    // Original / extended / late rental time (#7) — server minutes, never rounded
    rentalTimelineBlock: rentalTimeline ? (
      <RentalTimelineCard
        timeline={rentalTimeline}
        lateBasis={isCompleted || awaitingManager ? "returned" : billedLate ? "billed" : "live"}
        extensionHint={isCompleted || awaitingManager ? null : useSessionFlow ? "drop-bill" : "complete"}
      />
    ) : null,
  };

  // Edit Return: the drop's sections again, prefilled from what it recorded
  if (completedBeforeOpen) {
    return (
      <ReturnEditMode
        booking={booking}
        shellProps={{ ...shellProps, title: "Edit Return", isCompleted: false, awaitingManager: false, canSwap: false }}
        pickupCaptures={pickupCapturesData}
      />
    );
  }

  // Recorded and waiting for the branch manager: nothing to inspect or bill again
  if (awaitingManager) {
    return <ReturnPageShell {...shellProps}>{null}</ReturnPageShell>;
  }

  // Typed FASTag / toll charge — on the drop bill, or recorded for the manager (legacy)
  const renderFastagTollCharge = (disabled: boolean) => (
    <FastagTollCharge
      checked={fastagChecked}
      onCheckedChange={(v) => { setFastagChecked(v); setFastagAmount(""); setFastagNotes(""); setReturnSession(null); }}
      amount={fastagAmount}
      onAmountChange={(v) => { setFastagAmount(v); setReturnSession(null); }}
      notes={fastagNotes}
      onNotesChange={setFastagNotes}
      disabled={disabled}
    />
  );

  // ══════════════════════════════════════════════════════════════════════════
  // SESSION FLOW (usePaymentSessions = true)
  // ══════════════════════════════════════════════════════════════════════════
  if (useSessionFlow) {
    const stepPhotos = showHandoverReference ? 2 : 1;
    const stepCharges = stepPhotos + 1;
    const stepDamage = stepCharges + 1;
    const stepDeposit = depositHeld > 0 ? stepDamage + 1 : null;
    const stepPayment = (stepDeposit ?? stepDamage) + 1;
    const canExtend = booking.status === "PICKED_UP" && !billLocked;
    const showDiscountPanel =
      !!returnSession &&
      !hasRecordedPayment &&
      (shownDiscount !== null || parseFloat(returnSession.session.totalCharges) > 0);

    return (
      <ReturnPageShell
        {...shellProps}
        headerActions={
          canExtend ? (
            <Button
              variant="outline"
              className="border-orange-500 text-orange-500 hover:bg-orange-50 px-6"
              onClick={() => setShowExtendModal(true)}
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Extend
            </Button>
          ) : null
        }
      >
        {adjustmentBlock && <AdjustmentPendingNotice bookingPublicId={booking.publicId} message={adjustmentBlock} />}

        {/* ── STEP 1: Handover reference photos (pickup, or the swap) ─────── */}
        {showHandoverReference && pickupCapturesData && (
          <StepCard
            stepNum={1}
            title={handoverHeading.title}
            subtitle={handoverHeading.subtitle}
            isCompleted={true}
            isLocked={false}
          >
            <CardContent className="pt-4">
              <HandoverConditionPhotos data={pickupCapturesData} onOpen={openLightbox} />
            </CardContent>
          </StepCard>
        )}

        {/* ── STEP 2: Return Photos ────────────────────────────────────────── */}
        <StepCard
          stepNum={stepPhotos}
          title="Return Condition Photos"
          subtitle="Upload 4–6 photos showing the current vehicle condition"
          isCompleted={step2Complete}
          isLocked={isCompleted}
        >
          <CardContent className="pt-4 space-y-4">
            {!isCompleted && (
              <div
                {...getReturnRootProps()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <input {...getReturnInputProps()} />
                <Upload className="mx-auto h-10 w-10 text-gray-400 mb-3" />
                <p className="text-sm text-gray-600 font-medium">Drag & drop photos, or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">Supports JPG, PNG</p>
              </div>
            )}
            {returnPhotos.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                {returnPhotos.map((img, idx) => (
                  <div
                    key={img.publicId}
                    className="relative aspect-square rounded-md overflow-hidden border bg-muted group cursor-pointer"
                    onClick={() => openLightbox(returnPhotos.map((r, i) => ({ url: r.url, label: `Return photo ${i + 1}` })), idx)}
                  >
                    <img src={img.url} alt={`Return ${idx}`} className="w-full h-full object-cover" />
                    <ZoomBadge />
                    {!isCompleted && (
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                        onClick={(e) => { e.stopPropagation(); deleteReturnImageMutation.mutate(img.publicId); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!step2Complete && (
              <p className="text-xs text-amber-600 text-center">Upload at least one photo to unlock the next step.</p>
            )}
          </CardContent>
        </StepCard>

        {/* ── STEP 3: Charge Details ───────────────────────────────────────── */}
        <StepCard
          stepNum={stepCharges}
          title="Charge Details"
          subtitle="Review vehicle readings and enter any additional charges"
          isCompleted={step3Complete}
          isLocked={!step2Complete || isCompleted}
        >
          <CardContent className="pt-4 space-y-5">
            {/* ── Odometer (km across mid-rental swaps; staff-entered km after a swap without readings) ── */}
            <DropOdometerFields
              endOdometer={endOdometer}
              onEndOdometerChange={(v) => { setEndOdometer(v); setReturnSession(null); }}
              manualExtraKm={manualExtraKm}
              onManualExtraKmChange={(v) => { setManualExtraKm(v); setReturnSession(null); }}
              disabled={step3Complete}
              currentStartOdometer={currentStartOdometer}
              swappedWithReadings={swappedWithReadings}
              manualKmAllowed={manualKmAllowed}
              endOdometerTooLow={endOdometerTooLow}
              kmSummary={kmSummary}
              drivenKmFallback={drivenKmFallback}
            />

            {/* ── Fuel Level ── */}
            <ReturnFuelLevelField
              value={returnFuelLevel}
              onChange={(v) => { setReturnFuelLevel(v); setFuelDeficit(false); setFuelCharge(""); setReturnSession(null); }}
              disabled={step3Complete}
              pickupFuelLevel={pickupFuelLevel}
              swappedWithReadings={swappedWithReadings}
              deficitHint={hasFuelDeficit && !fuelDeficit}
            />

            {/* ── Fuel Deficit ── */}
            <FuelDeficitCharge
              checked={fuelDeficit}
              onCheckedChange={(v) => { setFuelDeficit(v); setFuelCharge(""); setReturnSession(null); }}
              amount={fuelCharge}
              onAmountChange={(v) => { setFuelCharge(v); setReturnSession(null); }}
              disabled={step3Complete}
            />

            {/* ── FASTag balance now (every earlier reading present) ── */}
            {fastagInfo && (
              <FastagReturnField
                info={fastagInfo}
                value={fastagNow}
                onChange={(v) => { setFastagNow(v); setReturnSession(null); }}
                disabled={step3Complete}
                billedOnDropBill
              />
            )}

            {/* ── FASTag ── */}
            {fastagManualShown && renderFastagTollCharge(step3Complete)}

            {/* ── Other / Additional Charges ── */}
            <OtherChargesFields
              checked={hasOtherCharges}
              onCheckedChange={(v) => { setHasOtherCharges(v); setReturnSession(null); }}
              items={otherChargeItems}
              onItemsChange={(next, typed) => {
                setOtherChargeItems(next);
                if (typed) setReturnSession(null);
              }}
              disabled={step3Complete}
            />

            {/* ── Late return beyond the booked end (automatic EXTRA_TIME line) ── */}
            {rentalTimeline && (
              <LateReturnPanel
                timeline={rentalTimeline}
                billed={billedLate}
                options={lateOptions}
                onOptionsChange={handleLateOptionsChange}
                collection="drop-bill"
                readOnly={billLocked}
                isPending={computeChargesMutation.isPending}
                error={lateError}
              />
            )}

            {/* ── Vehicle-swap difference billed on this drop ── */}
            <SwapChargesNote charges={swapCharges} billedOnDropBill />

            {/* ── Discount carried over from the previous compute ── */}
            {appliedDiscount && !step3Complete && (
              <p className="text-xs text-muted-foreground">
                The discount of {formatPrice(appliedDiscount.amount)} ({appliedDiscount.reason}) will be applied again.
              </p>
            )}

            {/* ── Safety deposit: set off against the charges or refund in full (#6) ── */}
            {depositHeld > 0 && !step3Complete && (
              <SafetyDepositChoice
                held={depositHeld}
                value={depositHandling}
                onChange={handleDepositHandlingChange}
                isPending={computeChargesMutation.isPending}
              />
            )}

            {/* ── Compute Button ── */}
            {!step3Complete && (
              <Button
                className="bg-[#FF5F00] hover:bg-[#e65600] text-white gap-2"
                disabled={!readingsReady || computeChargesMutation.isPending}
                onClick={() => void runCompute(appliedDiscount, "inputs")}
              >
                {computeChargesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="h-4 w-4" />
                )}
                Compute Charges
              </Button>
            )}

            {/* ── Drop charges at face value, no GST (server bill; updates on every recompute) ── */}
            {step3Complete && returnSession?.bill && <DropBillSummary bill={returnSession.bill} />}
            {step3Complete && returnSession?.bill && <FastagUsageNotes fastag={returnSession.fastag} />}

            {/* Recompute hint when session exists */}
            {step3Complete && !billLocked && (
              <Button
                variant="outline"
                size="sm"
                className="text-orange-600 border-orange-300 hover:bg-orange-50"
                onClick={() => { setReturnSession(null); }}
              >
                Recompute charges (change inputs above)
              </Button>
            )}
          </CardContent>
        </StepCard>

        {/* ── STEP 4: Vehicle Condition (damage is billed BEFORE payment) ─── */}
        <StepCard
          stepNum={stepDamage}
          title="Vehicle Condition"
          subtitle="Record any new damage — damage charged to the customer is added to the bill"
          isCompleted={damageStepDone}
          isLocked={!step3Complete || isCompleted}
        >
          <CardContent className="pt-4 space-y-4">
            {damageDecision === null ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">Does the vehicle have any new damage?</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setDamageDecision("NO_DAMAGE"); }}
                    className="flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700"
                  >
                    No Damage
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDamageDecision("DAMAGE_FOUND"); }}
                    className="flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all bg-white border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-700"
                  >
                    Damage Found
                  </button>
                </div>
              </div>
            ) : damageDecision === "NO_DAMAGE" ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 p-4 text-green-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">No damage found — proceeding to payment.</p>
                </div>
                {!billLocked && (
                  <button
                    type="button"
                    className="text-xs text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0 ml-3"
                    onClick={() => setDamageDecision(null)}
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              /* DAMAGE_FOUND */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-orange-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Damage
                  </p>
                  {dropDamages.length === 0 && !billLocked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground text-xs h-8"
                      onClick={() => setDamageDecision(null)}
                    >
                      ← No Damage
                    </Button>
                  )}
                </div>
                <DropDamageSection
                  bookingPublicId={booking.publicId}
                  damages={dropDamages}
                  vehicles={bookingVehicles}
                  readOnly={billLocked}
                  billsAtDrop
                  onChanged={onDamagesChanged}
                  onPreview={(url, group) => openLightbox((group ?? [url]).map((u, i) => ({ url: u, label: group ? `Damage photo ${i + 1}` : undefined })), Math.max(0, (group ?? [url]).indexOf(url)))}
                />
                {dropDamages.length === 0 && (
                  <p className="text-xs text-amber-600">
                    Save at least one damage (or go back to “No Damage”) to continue to payment.
                  </p>
                )}
              </div>
            )}

            {!step3Complete && (
              <p className="text-sm text-muted-foreground text-center py-2">
                Compute charges in the previous step to proceed.
              </p>
            )}
          </CardContent>
        </StepCard>

        {/* ── STEP 5: Safety Deposit Info ──────────────────────────────────── */}
        {stepDeposit !== null && (
          <StepCard
            stepNum={stepDeposit}
            title="Safety Deposit"
            subtitle={
              depositHandling === "REFUND_IN_FULL"
                ? "The deposit collected at pickup is refunded in full"
                : "The deposit collected at pickup is set off against the charges"
            }
            isCompleted={step3Complete && damageStepDone}
            isLocked={!step3Complete || !damageStepDone}
          >
            <CardContent className="pt-4">
              {returnSession?.deposit ? (
                // The bill's own deposit block (#6); changing the choice recomputes the bill
                <SafetyDepositChoice
                  held={depositHeld}
                  value={depositHandling}
                  onChange={handleDepositHandlingChange}
                  deposit={returnSession.deposit}
                  readOnly={billLocked}
                  isPending={computeChargesMutation.isPending}
                />
              ) : (
                // Bill computed before the deposit choice existed (or reloaded without one)
                <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-4">
                  <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-900">
                      {formatPrice(depositHeld)} safety deposit applied
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      The safety deposit collected at pickup has been automatically credited against the return charges.
                      {returnSession && (
                        <>
                          {" "}
                          {parseFloat(returnSession.session.netPayable) < 0
                            ? `A refund of ${formatPrice(Math.abs(parseFloat(returnSession.session.netPayable)))} is due to the customer.`
                            : parseFloat(returnSession.session.netPayable) === 0
                              ? "The deposit exactly covers all charges — no further payment needed."
                              : `The deposit partially covers the charges. ${formatPrice(parseFloat(returnSession.session.netPayable))} remains payable.`}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {returnSession && (
                <div className="mt-4">
                  <LedgerSummaryCard session={returnSession.session} />
                </div>
              )}
            </CardContent>
          </StepCard>
        )}

        {/* ── STEP 6: Discount + Collect Payment / Issue Refund ────────────── */}
        <StepCard
          stepNum={stepPayment}
          title={
            returnSession
              ? parseFloat(returnSession.session.netPayable) < 0
                ? "Issue Refund to Customer"
                : parseFloat(returnSession.session.netPayable) === 0
                  ? "No Payment Required"
                  : "Collect Payment"
              : "Collect Payment / Issue Refund"
          }
          subtitle="Settle the return — this finalises the booking"
          isCompleted={paymentSettled}
          isLocked={!step3Complete || !damageStepDone}
        >
          <CardContent className="pt-4 space-y-4">
            {returnSession && !paymentSettled && (
              <>
                {showDiscountPanel && (
                  <DropDiscountPanel
                    applied={shownDiscount}
                    error={discountError}
                    isPending={computeChargesMutation.isPending}
                    onApply={(d) => void recomputeBill(d, "discount")}
                    onRemove={() => void recomputeBill(null, "discount")}
                  />
                )}

                {depositHeld <= 0 && (
                  <LedgerSummaryCard session={returnSession.session} />
                )}

                {/* Money already left owed on this booking (#11) — the branch manager clears it */}
                {creditPending > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span className="font-semibold">On credit: {formatPrice(creditPending)}</span>
                    {creditCollateral.length > 0 && <> (collateral: {creditCollateral.join(", ")})</>}
                    {" "}— still owed from earlier; the branch manager clears it when the customer pays.
                  </div>
                )}

                {isZeroBalance && !refundsDepositInFull && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <p className="text-sm font-medium">
                        {safetyDeposit > 0
                          ? "The safety deposit covers all charges exactly. No additional payment is needed."
                          : "Nothing is due at return. No payment is needed."}
                      </p>
                    </div>
                    <Button
                      className="w-full bg-[#28A745] hover:bg-green-700 text-white h-12 text-sm font-semibold"
                      disabled={zeroBalanceMutation.isPending || computeChargesMutation.isPending}
                      onClick={() => zeroBalanceMutation.mutate()}
                    >
                      {zeroBalanceMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <FileCheck className="h-4 w-4 mr-2" />
                      )}
                      Complete Return — No Payment Needed
                    </Button>
                  </div>
                )}

                {(!isZeroBalance || refundsDepositInFull) && (
                  <RecordPaymentPanel
                    session={returnSession.session}
                    onSuccess={(updatedSession) => {
                      setReturnSession((prev) => prev ? { ...prev, session: updatedSession } : null);
                      if (updatedSession.status === "COMPLETED") {
                        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                        const notes = [
                          updatedSession.credit &&
                            `₹${updatedSession.credit.amount} put on credit (collateral: ${updatedSession.credit.collateral})`,
                          updatedSession.depositRefund &&
                            `deposit ₹${updatedSession.depositRefund.amount} refunded (${updatedSession.depositRefund.method === "CASH" ? "cash" : "UPI"})`,
                        ].filter(Boolean);
                        toast.success(
                          `Return settled — booking marked as Returned.${notes.length ? ` ${notes.join("; ")}.` : ""}`,
                        );
                      }
                    }}
                    onError={handleStaleBill}
                  />
                )}
              </>
            )}

            {paymentSettled && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">Payment settled. Booking marked as Returned.</p>
                </div>
                {dropDamages.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 p-3 text-orange-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p className="text-sm">
                      The damage report is with the branch manager, who will set the vehicle's status.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!returnSession && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Compute charges in the previous step to proceed.
              </p>
            )}
          </CardContent>
        </StepCard>

        {/* ── Navigate to dashboard ────────────────────────────────────────── */}
        {paymentSettled && (
          <Button
            className="w-full bg-[#1A1A1A] hover:bg-black text-white h-12"
            onClick={() => navigate("/employee/dashboard")}
          >
            Return to Dashboard
          </Button>
        )}

        {/* ── Extend the rental (car still out) ────────────────────────────── */}
        {showExtendModal && (
          <ExtendBookingModal
            open={showExtendModal}
            bookingPublicId={booking.publicId}
            currentEndAt={booking.endAt}
            role="employee"
            onClose={() => setShowExtendModal(false)}
            onSuccess={handleExtensionSuccess}
          />
        )}

        {/* ── Image preview lightbox ───────────────────────────────────────── */}
        <PhotoLightbox
          open={!!lightbox}
          onOpenChange={(open) => !open && setLightbox(null)}
          items={lightbox?.items ?? []}
          startIndex={lightbox?.index ?? 0}
          title="Photo Preview"
        />
      </ReturnPageShell>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY FLOW (usePaymentSessions = false)
  // ══════════════════════════════════════════════════════════════════════════
  // Damage already recorded at drop keeps the damage section open.
  const legacyShowDamage = legacyHasDamage || dropDamages.length > 0;

  if (legacySubmissionResult?.success) {
    return (
      <ReturnPageShell {...shellProps}>
        <Card className="max-w-md mx-auto text-center p-6 border-green-200 bg-green-50/50">
          <CardContent className="space-y-4 pt-6">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <FileCheck className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-green-800">{legacySubmissionResult.message}</h2>
            {legacySubmissionResult.returnCharges && (
              <LegacyReturnChargesSummary charges={legacySubmissionResult.returnCharges} />
            )}
            <FastagUsageNotes fastag={legacySubmissionResult.fastag} />
            {legacySubmissionResult.safetyDeposit && (
              <p className="text-sm text-blue-800">
                Safety deposit {formatPrice(legacySubmissionResult.safetyDeposit.amount)}:{" "}
                {legacySubmissionResult.safetyDeposit.handling === "REFUND_IN_FULL"
                  ? "to be refunded in full"
                  : "set off against the charges"}{" "}
                — the branch manager settles it.
              </p>
            )}
            <Button className="w-full mt-4 bg-green-600 hover:bg-green-700" onClick={() => navigate("/employee/dashboard")}>
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </ReturnPageShell>
    );
  }

  return (
    <ReturnPageShell {...shellProps}>
      {adjustmentBlock && <AdjustmentPendingNotice bookingPublicId={booking.publicId} message={adjustmentBlock} />}

      {/* Handover reference photos (pickup, or the swap) */}
      {showHandoverReference && pickupCapturesData && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              {pickupCapturesData.currentVehicleCaptures?.source === "SWAP" ? handoverHeading.title : "Pre-delivery Condition"}
              <span className="text-xs font-normal text-muted-foreground">
                {pickupCapturesData.currentVehicleCaptures?.source === "SWAP" ? "(taken at the swap)" : "(taken at pickup)"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <HandoverConditionPhotos data={pickupCapturesData} onOpen={openLightbox} />
          </CardContent>
        </Card>
      )}

      {/* Return Photos */}
      <Card className="border-none shadow-sm">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl">1. Return Media Upload</CardTitle>
          <CardDescription className="text-base">Upload general condition photos (4–6 recommended).</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div {...getReturnRootProps()} className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center hover:bg-gray-50 transition-colors cursor-pointer bg-white">
            <input {...getReturnInputProps()} disabled={isCompleted} />
            <Upload className="mx-auto h-12 w-12 text-[#999999] mb-4" />
            <p className="text-base text-[#666666] font-medium">Drag & drop photos here, or click to browse</p>
          </div>
          {returnPhotos.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-4 mt-6">
              {returnPhotos.map((img, idx) => (
                <div key={img.publicId} className="relative aspect-square rounded-md overflow-hidden border bg-muted group cursor-pointer" onClick={() => openLightbox(returnPhotos.map((r, i) => ({ url: r.url, label: `Return photo ${i + 1}` })), idx)}>
                  <img src={img.url} alt={`Return ${idx}`} className="w-full h-full object-cover" />
                  <ZoomBadge />
                  <Button size="icon" variant="destructive" className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                    onClick={(e) => { e.stopPropagation(); deleteReturnImageMutation.mutate(img.publicId); }} disabled={isCompleted}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Km & time check — legacy (no drop bill: extra km and late return are recorded at
          completion and the branch manager collects them at settlement) */}
      {!isCompleted && returnPhotos.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="text-2xl">2. Km &amp; Time Check</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <DropOdometerFields
              endOdometer={endOdometer}
              onEndOdometerChange={setEndOdometer}
              manualExtraKm={manualExtraKm}
              onManualExtraKmChange={setManualExtraKm}
              currentStartOdometer={currentStartOdometer}
              swappedWithReadings={swappedWithReadings}
              manualKmAllowed={manualKmAllowed}
              endOdometerTooLow={endOdometerTooLow}
              kmSummary={kmPreview ? { figures: kmPreview, source: "billed-later" } : null}
              drivenKmFallback={drivenKmFallback}
            />
            {rentalTimeline && (
              <LateReturnPanel
                timeline={rentalTimeline}
                billed={null}
                options={lateOptions}
                onOptionsChange={handleLateOptionsChange}
                collection="branch-manager"
                isPending={completeReturnMutation.isPending}
              />
            )}
            <SwapChargesNote charges={swapCharges} billedOnDropBill={false} />
            {fastagInfo && (
              <FastagReturnField
                info={fastagInfo}
                value={fastagNow}
                onChange={setFastagNow}
                disabled={completeReturnMutation.isPending}
                billedOnDropBill={false}
              />
            )}
            {/* Typed FASTag charge (a reading is missing) — recorded for the manager to collect */}
            {fastagManualShown && renderFastagTollCharge(completeReturnMutation.isPending)}
          </CardContent>
        </Card>
      )}

      {/* Condition Check — legacy (damage is charged later by the manager) */}
      {returnPhotos.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6"><CardTitle className="text-2xl">3. Vehicle Condition</CardTitle></CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start space-x-4 p-6 border rounded-lg bg-white hover:border-orange-200 transition-colors cursor-pointer"
              onClick={() => !isCompleted && dropDamages.length === 0 && setLegacyHasDamage(!legacyHasDamage)}>
              <Checkbox id="damage-check" checked={legacyShowDamage} onCheckedChange={(c) => setLegacyHasDamage(!!c)}
                disabled={isCompleted || dropDamages.length > 0} />
              <div>
                <Label htmlFor="damage-check" className="text-base font-medium">Does the vehicle have any new damage?</Label>
                <p className="text-sm text-muted-foreground">Enable if you identify scratches, dents, or other issues.</p>
              </div>
            </div>
            {legacyShowDamage && (
              <DropDamageSection
                bookingPublicId={booking.publicId}
                damages={dropDamages}
                vehicles={bookingVehicles}
                readOnly={isCompleted}
                billsAtDrop={false}
                onChanged={onDamagesChanged}
                onPreview={(url, group) => openLightbox((group ?? [url]).map((u, i) => ({ url: u, label: group ? `Damage photo ${i + 1}` : undefined })), Math.max(0, (group ?? [url]).indexOf(url)))}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Advance booking: the balance is settled at the counter before the return (#11) */}
      {legacyRemainingDue && !isCompleted && (
        <LegacyRemainingPaymentCard
          bookingPublicId={booking.publicId}
          context="return"
          remainingBalance={booking.remainingBalance!}
          onSettled={() => {
            queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
            queryClient.invalidateQueries({ queryKey: ["employee-financial-state", bookingId] });
          }}
        />
      )}

      {/* Safety deposit (#6): recorded with the return — the branch manager settles it */}
      {depositHeld > 0 && returnPhotos.length > 0 && !isCompleted && (
        <SafetyDepositChoice
          held={depositHeld}
          value={depositHandling}
          onChange={handleDepositHandlingChange}
          readOnly={completeReturnMutation.isPending}
          settledByManager
        />
      )}

      {/* Sidebar with action buttons — legacy */}
      {returnPhotos.length > 0 && !isCompleted && (
        <div className="flex flex-col gap-3">
          <Dialog open={legacyShowCompleteDialog} onOpenChange={setLegacyShowCompleteDialog}>
            <Button className="w-full bg-[#28A745] hover:bg-green-700 text-white"
              onClick={() => {
                // Refresh the late-return preview — the server measures it to the moment of completion
                queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                setLegacyShowCompleteDialog(true);
              }}
              disabled={(legacyShowDamage && dropDamages.length === 0) || !readingsReady || legacyRemainingDue}>
              <FileCheck className="mr-2 h-4 w-4" /> Complete Return
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Complete Return</DialogTitle>
                <DialogDescription>
                  {dropDamages.length > 0
                    ? "The recorded damage goes to the branch manager, who charges it and sets the vehicle's status."
                    : "Confirm the vehicle is in good condition with no new damage."}
                </DialogDescription>
              </DialogHeader>
              {((kmPreview?.extraKmCharge ?? 0) > 0 ||
                (rentalTimeline?.lateMinutes ?? 0) > 0 ||
                swapCharges.length > 0 ||
                fastagFromReadings ||
                (fastagManualShown && fastagChecked && parseFloat(fastagAmount) > 0)) && (
                <p className="text-sm text-muted-foreground">
                  Extra km, any late return{fastagFromReadings || fastagChecked ? ", the FASTag charge" : ""} and the vehicle-swap difference are worked out by the server when you
                  confirm (no GST on drop charges) and recorded for the branch manager to collect at settlement.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setLegacyShowCompleteDialog(false)}>Cancel</Button>
                <Button className="bg-[#28A745] hover:bg-green-700 text-white"
                  disabled={!readingsReady || completeReturnMutation.isPending}
                  onClick={() => completeReturnMutation.mutate({
                    returnImageIds: returnPhotos.map((p) => p.publicId),
                    endOdometer: parseInt(endOdometer.trim(), 10),
                    ...(manualKmAllowed && manualExtraKmValue != null ? { manualExtraKm: manualExtraKmValue } : {}),
                    ...(lateOptions.applyGrace ? { applyGrace: true } : {}),
                    ...(lateOptions.waiver ? { waiveLateCharge: lateOptions.waiver } : {}),
                    ...(fastagNowValue != null ? { returnFastagBalance: fastagNowValue } : {}),
                    ...(fastagManualShown && fastagChecked && parseFloat(fastagAmount) > 0
                      ? { fastagAmount: parseFloat(fastagAmount), ...(fastagNotes.trim() ? { fastagNotes: fastagNotes.trim() } : {}) }
                      : {}),
                    // Recorded only when a deposit is held; the branch manager settles it (#6)
                    ...(depositHeld > 0 ? { safetyDepositHandling: depositHandling } : {}),
                  })}>
                  {completeReturnMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Complete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {legacyShowDamage && dropDamages.length === 0 && (
            <p className="text-xs text-amber-600 text-center">
              Save at least one damage (or untick the damage box) to complete the return.
            </p>
          )}
          {!readingsReady && (
            <p className="text-xs text-amber-600 text-center">
              {manualExtraKmMissing && endOdometer !== "" && !endOdometerTooLow
                ? "Enter the extra km driven to complete the return."
                : fastagNowMissing && /^\d+$/.test(endOdometer.trim()) && !endOdometerTooLow && !manualExtraKmMissing
                  ? "Enter the FASTag balance to complete the return."
                  : "Enter the end odometer reading to complete the return."}
            </p>
          )}
          {legacyRemainingDue && (
            <p className="text-xs text-amber-600 text-center">
              Settle the remaining balance above to complete the return.
            </p>
          )}
        </div>
      )}

      <PhotoLightbox
        open={!!lightbox}
        onOpenChange={(open) => !open && setLightbox(null)}
        items={lightbox?.items ?? []}
        startIndex={lightbox?.index ?? 0}
        title="Photo Preview"
      />
    </ReturnPageShell>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// EDIT RETURN (client item 1, full edit): this page again for a completed drop,
// prefilled from what it recorded (its inputs as last edited). Save changes shows
// the bill's difference (old → new), saves it and settles it at the counter — or,
// for a drop the branch manager settles (legacy), sends it to Settlements.
// ══════════════════════════════════════════════════════════════════════════

const num = (x: unknown) => Number(x ?? 0) || 0;

interface ReturnEditModeProps {
  booking: EmployeeBooking;
  shellProps: Omit<ReturnPageShellProps, "children">;
  pickupCaptures: ReturnConditionCaptures | undefined;
}

function ReturnEditMode({ booking, shellProps, pickupCaptures }: ReturnEditModeProps) {
  const { data: summary, isLoading, isError } = useSummary("RETURN", booking.publicId);

  if (isLoading) {
    return (
      <ReturnPageShell {...shellProps}>
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
        </div>
      </ReturnPageShell>
    );
  }
  if (isError || !summary) {
    return (
      <ReturnPageShell {...shellProps}>
        <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load this return.</p>
      </ReturnPageShell>
    );
  }
  // Nothing this page can edit (not completed, or the drop's inputs aren't on record): the summary
  if (summary.phase !== "RETURN" || !summary.edit.allowed || !summary.editState) {
    return <CompletedOperationPage phase="RETURN" bookingId={booking.publicId} />;
  }
  return (
    <ReturnEditForm
      booking={booking}
      summary={summary}
      editState={summary.editState}
      shellProps={shellProps}
      pickupCaptures={pickupCaptures}
    />
  );
}

function ReturnEditForm({
  booking,
  summary,
  editState,
  shellProps,
  pickupCaptures,
}: ReturnEditModeProps & { summary: ReturnSummary; editState: NonNullable<ReturnSummary["editState"]> }) {
  const inputs = editState.inputs;
  const dropBill = editState.flow === "DROP_BILL";
  const vehicle = booking.items[0]?.vehicle;
  const recordedEnd = inputs.endOdometer ?? summary.odometer.end;
  const recordedFuel = inputs.returnFuelLevel ?? summary.fuel.return;

  // ── The drop's inputs, as recorded / last edited ──
  const [endOdometer, setEndOdometer] = useState(recordedEnd != null ? String(recordedEnd) : "");
  const [manualExtraKm, setManualExtraKm] = useState(inputs.manualExtraKm != null ? String(inputs.manualExtraKm) : "");
  const [returnFuelLevel, setReturnFuelLevel] = useState(recordedFuel ?? "");
  const [fuelDeficit, setFuelDeficit] = useState(num(inputs.fuelCharge) > 0);
  const [fuelCharge, setFuelCharge] = useState(moneyText(inputs.fuelCharge));
  const [fastagNow, setFastagNow] = useState(inputs.returnFastagBalance != null ? String(num(inputs.returnFastagBalance)) : "");
  const [fastagChecked, setFastagChecked] = useState(num(inputs.fastagAmount) > 0);
  const [fastagAmount, setFastagAmount] = useState(moneyText(inputs.fastagAmount));
  const [fastagNotes, setFastagNotes] = useState(inputs.fastagNotes ?? "");
  const [hasOtherCharges, setHasOtherCharges] = useState(inputs.otherCharges.length > 0);
  const [otherChargeItems, setOtherChargeItems] = useState<OtherChargeItem[]>(() =>
    inputs.otherCharges.length > 0
      ? inputs.otherCharges.map((o, i) => ({ id: String(i + 1), label: o.label, amount: String(num(o.amount)) }))
      : [{ id: "1", label: "", amount: "" }],
  );
  const [discount, setDiscount] = useState<DropDiscountInput | null>(
    inputs.discount ? { amount: num(inputs.discount.amount), reason: inputs.discount.reason } : null,
  );
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [lateOptions, setLateOptions] = useState<LateReturnOptions>({
    applyGrace: inputs.applyGrace,
    waiver: inputs.waiveReason != null ? { reason: inputs.waiveReason } : null,
  });
  const [lateError, setLateError] = useState<string | null>(null);
  const [depositHandling, setDepositHandling] = useState<SafetyDepositHandling>(inputs.depositHandling);
  const [photos, setPhotos] = useState<EditablePhoto[]>(() => photosOf(summary.photos));
  const [damages, setDamages] = useState<Record<string, DamageDraft>>(() =>
    Object.fromEntries(summary.damages.filter((d) => d.editable).map((d) => [d.publicId, damageDraftOf(editState, d)])),
  );
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  // Photos uploaded here and not saved are deleted when the page closes
  const uploads = useEditUploads((fileId) => bookingService.deleteReturnImage(fileId));

  // ── Same figures as the drop: km across swaps, FASTag mode, late return ──
  const kmSegments = booking.kmSegments ?? null;
  const manualKmAllowed = !!booking.kmAllowance?.manualExtraKmAllowed;
  const currentStartOdometer = kmSegments ? kmSegments.currentStartOdometer : booking.startOdometer ?? null;
  const swappedWithReadings = !!kmSegments && kmSegments.swapCount > 0 && kmSegments.complete;
  const endValue = /^\d+$/.test(endOdometer.trim()) ? Number(endOdometer.trim()) : null;
  const endOdometerTooLow =
    endValue != null && !manualKmAllowed && currentStartOdometer != null && endValue < currentStartOdometer;
  // The bill's km charge is worked out by the server (shown in the review); km driven is shown here
  const drivenKm =
    !manualKmAllowed && currentStartOdometer != null && endValue != null
      ? (kmSegments?.priorKm ?? 0) + Math.max(0, endValue - currentStartOdometer)
      : null;
  const fastagInfo = booking.fastag ?? null;
  const fastagFromReadings = fastagInfo?.mode === "READINGS";
  // Asked for (and required) whenever the car handed back counts as a FASTag car
  const fastagNowShown = !!fastagInfo?.currentHasFastag;
  const fastagNowRead = readFastagBalance(fastagNow);
  // Typed FASTag / toll charge on the drop bill: the balances can't measure the usage, or one was typed
  const fastagTypedShown =
    dropBill &&
    (num(inputs.fastagAmount) > 0 ||
      (!fastagFromReadings &&
        (!!vehicle?.hasFastag || fastagInfo?.mode === "MANUAL" || !!booking.frozenChargeConfig?.fastagModuleEnabled)));
  const timeline = booking.rentalTimeline ?? null;
  const lateShown = !!timeline && timeline.lateMinutes > 0;
  const manualGrace =
    !!timeline && timeline.gracePolicyEnabled && timeline.graceType === "MANUAL" && timeline.graceMinutes > 0;
  const depositHeld = num(booking.safetyDeposit);
  const pickupFuelLevel = booking.pickupFuelLevel ?? summary.fuel.pickup;
  const hasFuelDeficit =
    !!returnFuelLevel && !!pickupFuelLevel && FUEL_LEVEL_ORDER[returnFuelLevel] < FUEL_LEVEL_ORDER[pickupFuelLevel];
  const typedOther = useMemo(
    () => (hasOtherCharges ? otherChargeItems.filter((c) => c.label.trim() || c.amount.trim()) : []),
    [hasOtherCharges, otherChargeItems],
  );

  // Only what changed is sent; the server keeps the rest as recorded
  const body = useMemo((): EditReturnBody => {
    const out: EditReturnBody = {};
    if (endValue != null && endValue !== recordedEnd) out.endOdometer = endValue;
    if (summary.edit.fuelEditable && returnFuelLevel && returnFuelLevel !== recordedFuel) {
      out.returnFuelLevel = returnFuelLevel;
    }
    if (
      fastagNowShown &&
      fastagNowRead.value != null &&
      (inputs.returnFastagBalance == null || !sameMoney(fastagNowRead.value, inputs.returnFastagBalance))
    ) {
      out.returnFastagBalance = fastagNowRead.value;
    }
    const { removed, added } = photoDiff(photosOf(summary.photos), photos);
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added.map((p) => ({ fileId: p.fileId }));
    const damageEdits = summary.damages.flatMap((d) => {
      const draft = d.editable ? damages[d.publicId] : undefined;
      const entry = draft ? damageEdit(editState, d, draft) : null;
      return entry ? [entry] : [];
    });
    if (damageEdits.length) out.damages = damageEdits;
    if (dropBill) {
      const fuel = fuelDeficit ? num(fuelCharge) : 0;
      if (!sameMoney(fuel, inputs.fuelCharge)) out.fuelCharge = fuel;
      if (fastagTypedShown) {
        const amount = fastagChecked ? num(fastagAmount) : 0;
        if (!sameMoney(amount, inputs.fastagAmount)) out.fastagAmount = amount;
        const notes = fastagChecked ? fastagNotes.trim() || null : null;
        if (notes !== (inputs.fastagNotes ?? null)) out.fastagNotes = notes;
      }
      const others = typedOther.map((c) => ({ label: c.label.trim(), amount: num(c.amount) }));
      const before = inputs.otherCharges.map((o) => ({ label: o.label, amount: num(o.amount) }));
      if (JSON.stringify(others) !== JSON.stringify(before)) out.otherCharges = others;
      const hadDiscount = inputs.discount ? { amount: num(inputs.discount.amount), reason: inputs.discount.reason } : null;
      if (JSON.stringify(discount) !== JSON.stringify(hadDiscount)) out.discount = discount;
    }
    if (lateShown) {
      if ((lateOptions.waiver?.reason ?? null) !== (inputs.waiveReason ?? null)) out.waiveLateCharge = lateOptions.waiver;
      if (manualGrace && lateOptions.applyGrace !== inputs.applyGrace) out.applyGrace = lateOptions.applyGrace;
    }
    if (manualKmAllowed && (!manualExtraKm.trim() || /^\d+$/.test(manualExtraKm.trim()))) {
      const typed = manualExtraKm.trim() ? Number(manualExtraKm.trim()) : null;
      if (typed !== inputs.manualExtraKm) out.manualExtraKm = typed;
    }
    if (depositHeld > 0 && depositHandling !== inputs.depositHandling) out.safetyDepositHandling = depositHandling;
    return out;
  }, [
    endValue, recordedEnd, summary, returnFuelLevel, recordedFuel, fastagNowShown, fastagNowRead.value, inputs, photos,
    damages, editState, dropBill, fuelDeficit, fuelCharge, fastagTypedShown, fastagChecked, fastagAmount, fastagNotes,
    typedOther, discount, lateShown, lateOptions, manualGrace, manualKmAllowed, manualExtraKm, depositHeld, depositHandling,
  ]);

  // ── The drop's own validations ──
  const endProblem = !endOdometer.trim()
    ? recordedEnd != null
      ? "Enter the end odometer reading."
      : null
    : endValue == null
      ? "Enter the end odometer reading in whole km."
      : endOdometerTooLow
        ? `The end odometer can't be less than ${swappedWithReadings ? "the reading at the swap" : "the start reading"} (${currentStartOdometer} km).`
        : null;
  const chargesProblem =
    endProblem ??
    (manualKmAllowed && manualExtraKm.trim() && !/^\d+$/.test(manualExtraKm.trim())
      ? "Enter the extra km as a whole number."
      : null) ??
    // A balance the drop recorded can be changed but not blanked; never recorded
    // (older drops) stays optional — checked only when typed
    (fastagNowShown && (inputs.returnFastagBalance != null || fastagNow.trim()) && fastagNowRead.error
      ? fastagNowRead.error
      : null) ??
    (dropBill && fuelDeficit && fuelCharge.trim() && !isMoneyInput(fuelCharge) ? "Enter the fuel charge in ₹." : null) ??
    (fastagTypedShown && fastagChecked && fastagAmount.trim() && !isMoneyInput(fastagAmount)
      ? "Enter the FASTag charge in ₹."
      : null) ??
    (dropBill && typedOther.some((c) => !c.label.trim() || !isMoneyInput(c.amount) || num(c.amount) <= 0)
      ? "Name each other charge and enter its amount in ₹."
      : null);
  const damageProblem =
    summary.damages
      .map((d) => (d.editable && damages[d.publicId] ? damageDraftProblem(d, damages[d.publicId]!) : null))
      .find(Boolean) ?? null;
  const blocker =
    (summary.photos.length > 0 && photos.length === 0
      ? "Keep at least one return photo — replace a photo rather than removing them all."
      : null) ??
    chargesProblem ??
    damageProblem ??
    (Object.values(uploading).some(Boolean) ? "Wait for the photos to upload." : null);
  const changed = Object.keys(body).length > 0;

  const setDamage = (publicId: string, patch: Partial<DamageDraft>) =>
    setDamages((all) => ({ ...all, [publicId]: { ...all[publicId]!, ...patch } }));

  /** Fuel level changed: the deficit charge follows it, as on the drop. */
  const changeFuelLevel = (level: string) => {
    setReturnFuelLevel(level);
    const fuelBarRate = vehicle?.fuelBar ? Number(vehicle.fuelBar) : 0;
    const deficitBars = pickupFuelLevel ? FUEL_LEVEL_ORDER[pickupFuelLevel] - FUEL_LEVEL_ORDER[level] : 0;
    if (dropBill && fuelBarRate && deficitBars > 0) {
      setFuelDeficit(true);
      setFuelCharge(String(Math.ceil(deficitBars * fuelBarRate)));
    } else {
      setFuelDeficit(false);
      setFuelCharge("");
    }
  };

  /** A refusal of the preview / save that belongs to a field. */
  const onFormError = (error: unknown) => {
    const data = isAxiosError<{ field?: string | null; code?: string }>(error) ? error.response?.data : undefined;
    const message = errorMessage(error, "Couldn't save the changes. Try again.");
    const field = data?.field ?? "";
    if (data?.code === "DISCOUNT_EXCEEDS_CHARGES" || field.startsWith("discount")) {
      setDiscountError(message);
    } else if (data?.code === "LATE_RATE_UNAVAILABLE" || field.startsWith("waiveLateCharge")) {
      setLateError(message);
    } else if (
      ["endOdometer", "manualExtraKm", "returnFuelLevel", "returnFastagBalance", "safetyDepositHandling"].includes(field)
    ) {
      // DEPOSIT_REFUND_RECORDED (safetyDepositHandling): the BM refunded the deposit in Settlements
      setFieldError({ field, message });
      document.getElementById(`edit-return-${field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setFormError(message);
    }
  };
  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  const flow = useEditSaveFlow<EditReturnBody, ReturnSummary>({
    phase: "RETURN",
    bookingId: booking.publicId,
    preview: (b) => completedOperationService.previewReturnEdit(booking.publicId, b),
    save: (b) => completedOperationService.editReturn(booking.publicId, b),
    onFormError,
    // Kept with the drop now: never cleaned up as unused uploads
    onSaved: () => uploads.keep([...photos, ...Object.values(damages).flatMap((d) => d.photos)].map((p) => p.fileId)),
  });

  const save = () => {
    if (blocker || !changed) return;
    setFieldError(null);
    setFormError(null);
    setDiscountError(null);
    setLateError(null);
    flow.open(body);
  };

  if (flow.finished) {
    return (
      <ReturnPageShell {...shellProps}>
        <EditSavedCard
          phase="RETURN"
          note={flow.finished.note}
          detail={`The return of ${vehicle ? `${vehicle.make} ${vehicle.model}` : "the vehicle"} for ${booking.customer.user.name} was updated.`}
        />
      </ReturnPageShell>
    );
  }

  const showHandoverReference = hasHandoverReference(pickupCaptures);
  const handoverHeading = handoverReferenceHeading(pickupCaptures);
  const stepPhotos = showHandoverReference ? 2 : 1;

  return (
    <ReturnPageShell {...shellProps}>
      <PendingAdjustmentCard summary={summary} />

      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        {dropBill
          ? "Correct what this drop recorded. Before saving you'll see what changes in the bill — then collect the difference or refund it."
          : "Correct what this drop recorded. Its charges are settled by the branch manager — a change in them goes to Settlements."}
      </div>

      {/* ── Handover reference photos (pickup, or the swap) ── */}
      {showHandoverReference && pickupCaptures && (
        <StepCard stepNum={1} title={handoverHeading.title} subtitle={handoverHeading.subtitle} isCompleted isLocked={false}>
          <CardContent className="pt-4">
            <HandoverConditionPhotos data={pickupCaptures} onOpen={(items, index) => setLightbox({ items, index })} />
          </CardContent>
        </StepCard>
      )}

      {/* ── Return photos ── */}
      <StepCard
        stepNum={stepPhotos}
        title="Return Condition Photos"
        subtitle="Replace, add or remove the photos taken at the return"
        isCompleted={photos.length > 0 && !uploading.return}
        isLocked={false}
      >
        <CardContent className="pt-4">
          <PhotoEditor
            value={photos}
            onChange={setPhotos}
            onBusyChange={(busy) => setUploading((all) => ({ ...all, return: busy }))}
            upload={uploads.track((form) => bookingService.uploadReturnImage(form))}
          />
        </CardContent>
      </StepCard>

      {/* ── Readings and drop charges ── */}
      <StepCard
        stepNum={stepPhotos + 1}
        title="Charge Details"
        subtitle={dropBill ? "Readings and the drop charges" : "Readings — the branch manager collects the charges"}
        isCompleted={!chargesProblem}
        isLocked={false}
      >
        <CardContent className="pt-4 space-y-5">
          <div id="edit-return-endOdometer" className="space-y-1">
            <DropOdometerFields
              endOdometer={endOdometer}
              onEndOdometerChange={(v) => { setEndOdometer(v); setFieldError(null); }}
              manualExtraKm={manualExtraKm}
              onManualExtraKmChange={(v) => { setManualExtraKm(v); setFieldError(null); }}
              currentStartOdometer={currentStartOdometer}
              swappedWithReadings={swappedWithReadings}
              manualKmAllowed={manualKmAllowed}
              endOdometerTooLow={endOdometerTooLow}
              kmSummary={null}
              drivenKmFallback={drivenKm}
            />
            {(errorFor("endOdometer") ?? errorFor("manualExtraKm")) && (
              <p className="text-xs text-red-600">{errorFor("endOdometer") ?? errorFor("manualExtraKm")}</p>
            )}
          </div>

          <div id="edit-return-returnFuelLevel" className="space-y-1">
            {summary.edit.fuelEditable ? (
              <ReturnFuelLevelField
                value={returnFuelLevel}
                onChange={(v) => { changeFuelLevel(v); setFieldError(null); }}
                pickupFuelLevel={pickupFuelLevel}
                swappedWithReadings={swappedWithReadings}
                deficitHint={dropBill && hasFuelDeficit && !fuelDeficit}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No fuel reading was kept for this rental.</p>
            )}
            {errorFor("returnFuelLevel") && <p className="text-xs text-red-600">{errorFor("returnFuelLevel")}</p>}
          </div>

          {dropBill && (
            <FuelDeficitCharge
              checked={fuelDeficit}
              onCheckedChange={(v) => { setFuelDeficit(v); setFuelCharge(""); }}
              amount={fuelCharge}
              onAmountChange={setFuelCharge}
            />
          )}

          {fastagInfo && (
            <div id="edit-return-returnFastagBalance" className="space-y-1">
              <FastagReturnField
                info={fastagInfo}
                value={fastagNow}
                onChange={(v) => { setFastagNow(v); setFieldError(null); }}
                billedOnDropBill={dropBill}
                note="A corrected balance re-works the FASTag charge — you'll see the difference before saving."
              />
              {errorFor("returnFastagBalance") && (
                <p className="text-xs text-red-600">{errorFor("returnFastagBalance")}</p>
              )}
            </div>
          )}

          {fastagTypedShown && (
            <FastagTollCharge
              checked={fastagChecked}
              onCheckedChange={(v) => { setFastagChecked(v); setFastagAmount(""); setFastagNotes(""); }}
              amount={fastagAmount}
              onAmountChange={setFastagAmount}
              notes={fastagNotes}
              onNotesChange={setFastagNotes}
            />
          )}

          {dropBill && (
            <OtherChargesFields
              checked={hasOtherCharges}
              onCheckedChange={setHasOtherCharges}
              items={otherChargeItems}
              onItemsChange={(next) => setOtherChargeItems(next)}
            />
          )}

          {timeline && (
            <LateReturnPanel
              timeline={timeline}
              billed={null}
              options={lateOptions}
              onOptionsChange={(next) => { setLateOptions(next); setLateError(null); }}
              collection={dropBill ? "drop-bill" : "branch-manager"}
              error={lateError}
              editing
            />
          )}

          <SwapChargesNote charges={booking.swapCharges ?? []} billedOnDropBill={dropBill} />

          {dropBill && (
            <DropDiscountPanel
              applied={discount ? { amount: discount.amount.toFixed(2), reason: discount.reason } : null}
              error={discountError}
              isPending={false}
              onApply={(d) => { setDiscount(d); setDiscountError(null); }}
              onRemove={() => { setDiscount(null); setDiscountError(null); }}
            />
          )}

          {depositHeld > 0 && (
            <div id="edit-return-safetyDepositHandling" className="space-y-1">
              <SafetyDepositChoice
                held={depositHeld}
                value={depositHandling}
                onChange={(v) => { setDepositHandling(v); setFieldError(null); }}
                settledByManager={!dropBill}
                note={dropBill ? "Changing it only updates what was recorded — no money moves with it." : undefined}
              />
              {errorFor("safetyDepositHandling") && (
                <p className="text-xs text-red-600">{errorFor("safetyDepositHandling")}</p>
              )}
            </div>
          )}
        </CardContent>
      </StepCard>

      {/* ── Damage recorded at the drop ── */}
      <StepCard
        stepNum={stepPhotos + 2}
        title="Vehicle Condition"
        subtitle="Damage recorded at the drop — what it says, its photos and its cost"
        isCompleted={!damageProblem}
        isLocked={false}
      >
        <CardContent className="pt-4 space-y-3">
          {summary.damages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No damage was recorded at this drop.</p>
          ) : (
            summary.damages.map((d) => (
              <DropDamageEditor
                key={d.publicId}
                damage={d}
                draft={d.editable ? damages[d.publicId] : undefined}
                onChange={(patch) => setDamage(d.publicId, patch)}
                upload={uploads.track((form) => bookingService.uploadDamageImage(form))}
                onBusyChange={(busy) => setUploading((all) => ({ ...all, [d.publicId]: busy }))}
              />
            ))
          )}
        </CardContent>
      </StepCard>

      <p className="text-xs text-muted-foreground">
        Rent, coupons and extensions aren't changed here — ask the branch manager.
      </p>

      {formError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {formError}
        </div>
      )}

      <EditSaveBar blocker={blocker} changed={changed} busy={flow.busy} onSave={save} />

      {flow.dialog}

      <PhotoLightbox
        open={!!lightbox}
        onOpenChange={(open) => !open && setLightbox(null)}
        items={lightbox?.items ?? []}
        startIndex={lightbox?.index ?? 0}
        title="Photo Preview"
      />
    </ReturnPageShell>
  );
}
