import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import { bookingService } from "@/services/booking.service";
import { paymentSessionService, type ReturnSessionResponse } from "@/services/paymentSession.service";
import { dropService, dropErrorCode } from "@/services/drop.service";
import { apiErrorMessage } from "@/lib/counterErrors";
import { StepCard } from "@/components/employee/StepCard";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { DropDamageSection } from "@/components/employee/drop/DropDamageSection";
import { DropDiscountPanel, type DropDiscountInput } from "@/components/employee/drop/DropDiscountPanel";
import { previewKmCharge, type KmChargeFigures } from "@/components/employee/drop/kmCharge";
import { RentalTimelineCard } from "@/components/employee/drop/RentalTimelineCard";
import { LateReturnPanel, type LateReturnOptions } from "@/components/employee/drop/LateReturnPanel";
import { DropBillSummary, LegacyReturnChargesSummary } from "@/components/employee/drop/DropBillSummary";
import { SwapChargesNote } from "@/components/employee/drop/SwapChargesNote";
import { DropOdometerFields } from "@/components/employee/drop/DropOdometerFields";
import { ExtendBookingModal } from "@/components/employee/extension/ExtendBookingModal";
import { DlStatusPanel } from "@/components/booking/DlStatus";
import { SwapVehicleAction } from "@/components/employee/swap/SwapVehicleAction";
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
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn, compressImage } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge, type LightboxItem } from "@/components/ui/PhotoLightbox";

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
              <BreadcrumbPage>Return Inspection</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight text-primary">Return Inspection</h1>
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

export default function ReturnProcessPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
  // other charges
  const [hasOtherCharges, setHasOtherCharges] = useState(false);
  const [otherChargeItems, setOtherChargeItems] = useState<{ id: string; label: string; amount: string }[]>([
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
  const [showExtendModal, setShowExtendModal] = useState(false);

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

  const { data: pickupCapturesData } = useQuery<{
    photos: { publicId: string; captureLabel: string | null; url: string; mime: string }[];
  }>({
    queryKey: ["pickup-captures", bookingId],
    queryFn: () => apiClient.get(`/employee/return/${bookingId}/pickup-captures`).then((r) => r.data),
    enabled: !!bookingId,
    refetchOnWindowFocus: false,
  });
  const pickupCaptures = pickupCapturesData?.photos ?? [];
  const pickupLightboxItems: LightboxItem[] = pickupCaptures.map((p, i) => ({
    url: p.url,
    mime: p.mime,
    label: p.captureLabel ? `Pickup: ${p.captureLabel}` : `Pickup photo ${i + 1}`,
  }));

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

  const paymentSettled = returnSession?.session?.status === "COMPLETED";
  const netPayable = returnSession ? parseFloat(returnSession.session.netPayable) : 0;
  const isZeroBalance = returnSession !== null && netPayable === 0;

  const showFastagModule = !!frozenConfig?.fastagModuleEnabled && !!vehicle?.hasFastag;
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
    /^\d+$/.test(endOdometer.trim()) && endOdometerValue != null && !endOdometerTooLow && !manualExtraKmMissing;
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

  // Real money taken in this session (the deposit credit is a DEPOSIT entry, not a payment).
  const hasRecordedPayment = !!returnSession?.session.entries.some(
    (e) => !e.isVoided && (e.entryType === "PAYMENT" || e.entryType === "REFUND"),
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
      if (session.km?.kmSource === "STAFF_ENTERED" && session.km.manualExtraKm != null) {
        setManualExtraKm(String(session.km.manualExtraKm));
      }
      // Computed before an extension changed the booked end / free km — that bill is stale.
      const allowance = booking?.kmAllowance;
      if (
        session.billStale ||
        (session.km && !session.km.autoKmSkipped && allowance && session.km.includedKm !== allowance.includedKm)
      ) {
        toast.info("The rental changed since the charges were computed — enter the readings and compute them again.");
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
    onError: () => toast.error("Failed to remove photo"),
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
    if (fastagChecked && fastagAmount) {
      payload.fastagAmount = parseFloat(fastagAmount);
      if (fastagNotes) payload.fastagNotes = fastagNotes;
    }
    if (hasOtherCharges) {
      payload.otherCharges = otherChargeItems
        .filter((c) => c.label.trim() && c.amount && parseFloat(c.amount) > 0)
        .map((c) => ({ label: c.label.trim(), amount: parseFloat(c.amount) }));
    }
    if (discountToSend) payload.discount = discountToSend;
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
      if (code === "LATE_RATE_UNAVAILABLE") {
        // Late, but the vehicle has no extra-hour rate — staff set pricing or waive it.
        // Refresh the timeline: the car may have become late since the page loaded.
        setLateError(message);
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
        toast.error(message);
        return;
      }
      if (code === "EXTENSION_PENDING") {
        // Show the unsettled extension in the rental-time block (it may be new since page load)
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
    if (dropErrorCode(err) !== "DROP_BILL_STALE") return;
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
  } | null>(null);

  const completeReturnMutation = useMutation({
    mutationFn: (data: Parameters<typeof bookingService.completeReturn>[1]) =>
      bookingService.completeReturn(bookingId!, data),
    onSuccess: (data) => {
      setLegacySubmissionResult({
        success: true,
        message: data.message || "Return completed",
        returnCharges: data.returnCharges,
      });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Failed to complete return"));
      // An unsettled extension / a return already sent to the manager / a changed
      // rental: refresh so the page shows why
      const code = dropErrorCode(err);
      if (code === "EXTENSION_PENDING" || code === "RETURN_AWAITING_MANAGER" || code === "USE_DROP_BILL") {
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

  // Recorded and waiting for the branch manager: nothing to inspect or bill again
  if (awaitingManager) {
    return <ReturnPageShell {...shellProps}>{null}</ReturnPageShell>;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SESSION FLOW (usePaymentSessions = true)
  // ══════════════════════════════════════════════════════════════════════════
  if (useSessionFlow) {
    const stepPhotos = pickupCaptures.length > 0 ? 2 : 1;
    const stepCharges = stepPhotos + 1;
    const stepDamage = stepCharges + 1;
    const stepDeposit = safetyDeposit > 0 ? stepDamage + 1 : null;
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
        {/* ── STEP 1: Pickup Reference Photos ─────────────────────────────── */}
        {pickupCaptures.length > 0 && (
          <StepCard
            stepNum={1}
            title="Pre-delivery Reference Photos"
            subtitle="Taken at vehicle pickup — compare against current condition"
            isCompleted={true}
            isLocked={false}
          >
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {pickupCaptures.map((photo, pIdx) => (
                  <div key={photo.publicId} className="rounded-lg overflow-hidden border bg-gray-50">
                    <button
                      type="button"
                      className="relative block w-full group"
                      onClick={() => openLightbox(pickupLightboxItems, pIdx)}
                      aria-label="View pickup photo"
                    >
                      <img
                        src={photo.url}
                        alt={photo.captureLabel ?? "Pickup photo"}
                        className="w-full h-28 object-cover cursor-zoom-in"
                        loading="lazy"
                      />
                      <ZoomBadge />
                    </button>
                    {photo.captureLabel && (
                      <div className="px-2 py-1 bg-white border-t">
                        <p className="text-xs font-medium truncate">{photo.captureLabel}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
              <Select
                value={returnFuelLevel}
                onValueChange={(v) => { setReturnFuelLevel(v); setFuelDeficit(false); setFuelCharge(""); setReturnSession(null); }}
                disabled={step3Complete}
              >
                <SelectTrigger className="h-11 max-w-xs">
                  <SelectValue placeholder="Select fuel level at return" />
                </SelectTrigger>
                <SelectContent>
                  {FUEL_LEVEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFuelDeficit && !fuelDeficit && (
                <p className="text-xs text-amber-600">Return fuel is lower than pickup — check the box below to charge.</p>
              )}
            </div>

            {/* ── Fuel Deficit ── */}
            <div className="space-y-3 p-4 rounded-lg border bg-amber-50/40 border-amber-200">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="fuelDeficit"
                  checked={fuelDeficit}
                  onCheckedChange={(v) => { setFuelDeficit(!!v); setFuelCharge(""); setReturnSession(null); }}
                  disabled={step3Complete}
                />
                <Label htmlFor="fuelDeficit" className="text-sm font-semibold cursor-pointer text-amber-900 flex items-center gap-2">
                  <Fuel className="h-4 w-4" /> Fuel Deficit — charge customer
                </Label>
              </div>
              {fuelDeficit && (
                <div className="space-y-1.5 ml-7">
                  <Label className="text-xs text-neutral-600">Fuel Deficit Charge (₹, before GST — GST is added on the bill)</Label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      type="number"
                      min="0"
                      className="pl-7 h-10"
                      placeholder="e.g. 300"
                      value={fuelCharge}
                      onChange={(e) => { setFuelCharge(e.target.value); setReturnSession(null); }}
                      disabled={step3Complete}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── FASTag ── */}
            {showFastagModule && (
              <div className="space-y-3 p-4 rounded-lg border bg-green-50/40 border-green-200">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="fastagChecked"
                    checked={fastagChecked}
                    onCheckedChange={(v) => { setFastagChecked(!!v); setFastagAmount(""); setFastagNotes(""); setReturnSession(null); }}
                    disabled={step3Complete}
                  />
                  <Label htmlFor="fastagChecked" className="text-sm font-semibold cursor-pointer text-green-900 flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> FASTag Toll Charges — charge customer
                  </Label>
                </div>
                {fastagChecked && (
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
                          value={fastagAmount}
                          onChange={(e) => { setFastagAmount(e.target.value); setReturnSession(null); }}
                          disabled={step3Complete}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-neutral-600">Notes (optional)</Label>
                      <Input
                        className="h-10"
                        placeholder="Route / toll plaza..."
                        value={fastagNotes}
                        onChange={(e) => setFastagNotes(e.target.value)}
                        disabled={step3Complete}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Other / Additional Charges ── */}
            <div className="space-y-3 p-4 rounded-lg border bg-purple-50/40 border-purple-200">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="hasOtherCharges"
                  checked={hasOtherCharges}
                  onCheckedChange={(v) => { setHasOtherCharges(!!v); setReturnSession(null); }}
                  disabled={step3Complete}
                />
                <Label htmlFor="hasOtherCharges" className="text-sm font-semibold cursor-pointer text-purple-900 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Other / Additional Charges
                </Label>
              </div>
              {hasOtherCharges && (
                <div className="ml-7 space-y-3">
                  <p className="text-xs text-neutral-600">
                    Amounts are before GST — GST is added on the bill. Late return is charged automatically, so don't add it here.
                  </p>
                  {otherChargeItems.map((item) => (
                    <div key={item.id} className="flex gap-2 items-center">
                      <Input
                        className="h-10 flex-1"
                        placeholder="Description (e.g. Interior cleaning)"
                        value={item.label}
                        onChange={(e) => {
                          setOtherChargeItems((prev) => prev.map((c) => c.id === item.id ? { ...c, label: e.target.value } : c));
                          setReturnSession(null);
                        }}
                        disabled={step3Complete}
                      />
                      <div className="relative w-32 shrink-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                        <Input
                          type="number"
                          min="0"
                          className="pl-7 h-10"
                          placeholder="0"
                          value={item.amount}
                          onChange={(e) => {
                            setOtherChargeItems((prev) => prev.map((c) => c.id === item.id ? { ...c, amount: e.target.value } : c));
                            setReturnSession(null);
                          }}
                          disabled={step3Complete}
                        />
                      </div>
                      {otherChargeItems.length > 1 && !step3Complete && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-red-500 hover:text-red-700 shrink-0"
                          onClick={() => setOtherChargeItems((prev) => prev.filter((c) => c.id !== item.id))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {!step3Complete && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-purple-700 border-purple-300 hover:bg-purple-50"
                      onClick={() => setOtherChargeItems((prev) => [...prev, { id: Date.now().toString(), label: "", amount: "" }])}
                    >
                      + Add Another Charge
                    </Button>
                  )}
                </div>
              )}
            </div>

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

            {/* ── Safety Deposit Hint ── */}
            {safetyDeposit > 0 && !step3Complete && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-blue-800">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  <span className="font-semibold">{formatPrice(safetyDeposit)} safety deposit</span> collected at pickup will be credited automatically against the above charges.
                </p>
              </div>
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

            {/* ── Drop charges with per-line GST (server bill; updates on every recompute) ── */}
            {step3Complete && returnSession?.bill && <DropBillSummary bill={returnSession.bill} />}

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
            subtitle="The deposit collected at pickup has been applied as a credit"
            isCompleted={step3Complete && damageStepDone}
            isLocked={!step3Complete || !damageStepDone}
          >
            <CardContent className="pt-4">
              <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-4">
                <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">
                    {formatPrice(safetyDeposit)} safety deposit applied
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

                {safetyDeposit <= 0 && (
                  <LedgerSummaryCard session={returnSession.session} />
                )}

                {isZeroBalance && (
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

                {!isZeroBalance && (
                  <RecordPaymentPanel
                    session={returnSession.session}
                    onSuccess={(updatedSession) => {
                      setReturnSession((prev) => prev ? { ...prev, session: updatedSession } : null);
                      if (updatedSession.status === "COMPLETED") {
                        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                        toast.success("Return settled — booking marked as Returned.");
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
      {/* Pickup reference photos */}
      {pickupCaptures.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              Pre-delivery Condition
              <span className="text-xs font-normal text-muted-foreground">(taken at pickup)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {pickupCaptures.map((photo, pIdx) => (
                <div key={photo.publicId} className="rounded-lg overflow-hidden border bg-gray-50">
                  <button
                    type="button"
                    className="relative block w-full group"
                    onClick={() => openLightbox(pickupLightboxItems, pIdx)}
                    aria-label="View pickup photo"
                  >
                    <img src={photo.url} alt={photo.captureLabel ?? "Pickup photo"} className="w-full h-28 object-cover cursor-zoom-in" loading="lazy" />
                    <ZoomBadge />
                  </button>
                  {photo.captureLabel && (
                    <div className="px-2 py-1 bg-white border-t">
                      <p className="text-xs font-medium truncate">{photo.captureLabel}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
              disabled={(legacyShowDamage && dropDamages.length === 0) || !readingsReady}>
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
                swapCharges.length > 0) && (
                <p className="text-sm text-muted-foreground">
                  Extra km, any late return and the vehicle-swap difference are worked out by the server when you
                  confirm (GST added) and recorded for the branch manager to collect at settlement.
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
                : "Enter the end odometer reading to complete the return."}
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
