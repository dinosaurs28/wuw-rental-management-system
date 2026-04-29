import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import { bookingService } from "@/services/booking.service";
import { paymentSessionService, type ReturnSessionResponse } from "@/services/paymentSession.service";
import { StepCard } from "@/components/employee/StepCard";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
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
  Gauge,
  AlertTriangle,
  FileCheck,
  X,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn, compressImage } from "@/lib/utils";

const FUEL_LEVEL_OPTIONS = [
  { value: "EMPTY", label: "Empty (0%)" },
  { value: "QUARTER", label: "Quarter (25%)" },
  { value: "HALF", label: "Half (50%)" },
  { value: "THREE_QUARTER", label: "Three Quarter (75%)" },
  { value: "FULL", label: "Full (100%)" },
] as const;

const FUEL_LEVEL_ORDER: Record<string, number> = {
  EMPTY: 0, QUARTER: 1, HALF: 2, THREE_QUARTER: 3, FULL: 4,
};

const FUEL_LEVEL_TO_PCT: Record<string, number> = {
  EMPTY: 0, QUARTER: 25, HALF: 50, THREE_QUARTER: 75, FULL: 100,
};

interface DamageItem {
  id: string;
  area: string;
  type: string;
  severity: string;
  description: string;
  photos: { publicId: string; url: string }[];
}

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
}

function ReturnPageShell({
  children,
  isCompleted,
  bookingStatus,
  bookingPublicId,
  customerName,
  vehicleRegNo,
  onBack,
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
          <Button
            variant="outline"
            className="border-orange-500 text-orange-500 hover:bg-orange-50 px-6"
            onClick={onBack}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>

        {isCompleted && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-3">
            <FileCheck className="h-5 w-5" />
            <div>
              <p className="font-semibold">Return Completed</p>
              <p className="text-sm">This vehicle has been returned and processed.</p>
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // ── Charge inputs ──────────────────────────────────────────────────────────
  const [endOdometer, setEndOdometer] = useState("");
  const [returnFuelLevel, setReturnFuelLevel] = useState("");
  // km exceeded
  const [kmExceeded, setKmExceeded] = useState(false);
  const [extraKmCharge, setExtraKmCharge] = useState("");
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

  // ── Session ────────────────────────────────────────────────────────────────
  const [returnSession, setReturnSession] = useState<ReturnSessionResponse | null>(null);

  // ── Damage ─────────────────────────────────────────────────────────────────
  const [hasDamage, setHasDamage] = useState<boolean | null>(null);
  const [damageChargeType, setDamageChargeType] = useState<"PENALTY" | "COMPENSATION" | null>(null);
  const [damages, setDamages] = useState<DamageItem[]>([]);
  const [activeDamage, setActiveDamage] = useState<Partial<DamageItem>>({ severity: "Minor", photos: [] });
  const [showDamageForm, setShowDamageForm] = useState(false);
  const [damageSubmitted, setDamageSubmitted] = useState(false);

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
  // Compute km limit for display (prefer effectiveFreeKmLimit computed by server)
  const freeKmLimit = booking?.effectiveFreeKmLimit ?? booking?.freeKmLimit ?? null;
  const extraKmRate = booking?.extraKmRate ?? null;
  const kmDriven = endOdometer && booking?.startOdometer != null
    ? Math.max(0, parseFloat(endOdometer) - booking.startOdometer)
    : null;
  const kmOverLimit = freeKmLimit != null && kmDriven != null ? Math.max(0, kmDriven - freeKmLimit) : 0;
  const suggestedExtraKmCharge = kmOverLimit > 0 && extraKmRate != null
    ? Math.ceil(kmOverLimit * extraKmRate)
    : null;
  // Fuel deficit detection
  const pickupFuelLevel = booking?.pickupFuelLevel ?? null;
  const hasFuelDeficit = returnFuelLevel && pickupFuelLevel
    ? FUEL_LEVEL_ORDER[returnFuelLevel] < FUEL_LEVEL_ORDER[pickupFuelLevel]
    : false;

  // Step completion flags
  const step2Complete = returnPhotos.length > 0;
  const step3Complete = !!returnSession && returnSession.session.status !== "OPEN";
  const step5Complete = paymentSettled;

  // ── Auto-fill return fuel level from pickup record ─────────────────────────
  useEffect(() => {
    if (booking?.pickupFuelLevel && !returnFuelLevel) {
      setReturnFuelLevel(booking.pickupFuelLevel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.pickupFuelLevel]);

  // ── Restore session on page reload ─────────────────────────────────────────
  useEffect(() => {
    if (!bookingId || !useSessionFlow || returnSession || isCompleted) return;
    paymentSessionService.getActiveReturnSession(bookingId).then((session) => {
      if (session) setReturnSession(session);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, useSessionFlow]);

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

  const uploadDamageMutation = useMutation({
    mutationFn: bookingService.uploadDamageImage,
    onSuccess: (data) => {
      setActiveDamage((prev) => ({
        ...prev,
        photos: [...(prev.photos || []), { publicId: data.fileId, url: data.url }],
      }));
      toast.success("Damage photo uploaded");
    },
    onError: () => toast.error("Failed to upload damage photo"),
  });

  const deleteDamageImageMutation = useMutation({
    mutationFn: bookingService.deleteReturnImage,
    onSuccess: () => toast.success("Damage photo removed"),
    onError: () => toast.error("Failed to remove damage photo"),
  });

  const computeChargesMutation = useMutation({
    mutationFn: async () => {
      const payload: Parameters<typeof paymentSessionService.computeReturnSession>[1] = {
        endOdometer: parseFloat(endOdometer),
        returnImageIds: returnPhotos.map((p) => p.publicId),
      };
      if (returnFuelLevel) payload.returnFuelLevel = returnFuelLevel;
      if (kmExceeded && extraKmCharge) payload.extraKmCharge = parseFloat(extraKmCharge);
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
      return paymentSessionService.computeReturnSession(bookingId!, payload);
    },
    onSuccess: (sessionResponse) => {
      setReturnSession(sessionResponse);
      toast.success("Charges computed");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to compute charges");
    },
  });

  const zeroBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!returnSession) throw new Error("No session");
      return paymentSessionService.recordPayment(returnSession.session.publicId, {
        method: "CASH",
        amount: 0,
        idempotencyKey: `zero-balance:${returnSession.session.publicId}`,
        notes: "Zero balance — safety deposit covered all charges",
      });
    },
    onSuccess: (updatedSession) => {
      setReturnSession((prev) => prev ? { ...prev, session: updatedSession } : null);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      toast.success("Return settled. Vehicle marked as returned.");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to complete return");
    },
  });

  const reportDamageMutation = useMutation({
    mutationFn: (data: any) => bookingService.reportDamage(data),
    onSuccess: () => {
      setDamageSubmitted(true);
      toast.success("Damage report submitted to branch manager");
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to submit damage report");
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

  const onDropDamage = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const processedFile = await compressImage(file);
        const formData = new FormData();
        formData.append("file", processedFile);
        uploadDamageMutation.mutate(formData);
      } catch {
        const formData = new FormData();
        formData.append("file", file);
        uploadDamageMutation.mutate(formData);
      }
    }
  };

  const { getRootProps: getDamageRootProps, getInputProps: getDamageInputProps } = useDropzone({
    onDrop: onDropDamage,
    accept: { "image/*": [] },
  });

  const addDamageItem = () => {
    if (!activeDamage.area || !activeDamage.description) {
      toast.error("Please fill all damage fields");
      return;
    }
    setDamages((prev) => [
      ...prev,
      { ...activeDamage, id: Math.random().toString(36).substr(2, 9) } as DamageItem,
    ]);
    setActiveDamage({ severity: "Minor", photos: [] });
    setShowDamageForm(false);
  };

  const removeDamageItem = (id: string) => {
    const item = damages.find((d) => d.id === id);
    if (item?.photos.length) {
      item.photos.forEach((photo) => deleteDamageImageMutation.mutate(photo.publicId));
    }
    setDamages((prev) => prev.filter((d) => d.id !== id));
  };

  const handleSubmitDamage = () => {
    if (damages.length === 0) {
      toast.error("Please add at least one damage entry");
      return;
    }
    if (!damageChargeType) {
      toast.error("Please select a damage type (Penalty or Compensation)");
      return;
    }
    reportDamageMutation.mutate({
      bookingId,
      odo: parseFloat(endOdometer) || 0,
      fuelLevel: FUEL_LEVEL_TO_PCT[returnFuelLevel] ?? 100,
      severity: damages.some((d) => d.severity === "Severe")
        ? "Severe"
        : damages.some((d) => d.severity === "Moderate")
          ? "Moderate"
          : "Minor",
      chargeType: damageChargeType,
      damageImageIds: damages.flatMap((d) => d.photos.map((p) => p.publicId)),
      notes: { damages },
      returnImageIds: returnPhotos.map((p) => p.publicId),
    });
  };

  const isTwoWheeler = vehicle?.category?.toLowerCase().includes("two");
  const damageZones = isTwoWheeler
    ? ["Front", "Rear", "Left Side", "Right Side"]
    : [
        "Front Bumper", "Rear Bumper", "Left Front Door", "Left Rear Door",
        "Right Front Door", "Right Rear Door", "Hood", "Roof", "Trunk", "Wheels", "Interior",
      ];

  // ── Legacy flow hooks (must be unconditional — declared before any early return) ──
  const [legacyShowCompleteDialog, setLegacyShowCompleteDialog] = useState(false);
  const [legacyShowReportDialog, setLegacyShowReportDialog] = useState(false);
  const [legacyHasDamage, setLegacyHasDamage] = useState(false);
  const [legacyDamages] = useState<DamageItem[]>([]);
  const [legacySubmissionResult, setLegacySubmissionResult] = useState<{ success: boolean; message: string } | null>(null);

  const completeReturnMutation = useMutation({
    mutationFn: (data: { returnImageIds: string[]; requireManagerConfirmation?: boolean }) =>
      bookingService.completeReturn(bookingId!, data),
    onSuccess: (data: any) => {
      setLegacySubmissionResult({ success: true, message: data.message || "Return completed" });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || "Failed to complete return"),
  });

  const legacyReportDamageMutation = useMutation({
    mutationFn: (data: any) => bookingService.reportDamage(data),
    onSuccess: (data: any) => {
      setLegacySubmissionResult({ success: true, message: data.message || "Damage report submitted" });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || "Failed to submit damage report"),
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
  const shellProps = {
    isCompleted,
    bookingStatus: booking.status,
    bookingPublicId: booking.publicId,
    customerName: booking.customer.user.name,
    vehicleRegNo: vehicle?.regNo,
    onBack: () => navigate("/employee/dashboard"),
  };

  // ══════════════════════════════════════════════════════════════════════════
  // SESSION FLOW (usePaymentSessions = true)
  // ══════════════════════════════════════════════════════════════════════════
  if (useSessionFlow) {
    return (
      <ReturnPageShell {...shellProps}>
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
                {pickupCaptures.map((photo) => (
                  <div key={photo.publicId} className="rounded-lg overflow-hidden border bg-gray-50">
                    <img
                      src={photo.url}
                      alt={photo.captureLabel ?? "Pickup photo"}
                      className="w-full h-28 object-cover cursor-pointer"
                      loading="lazy"
                      onClick={() => setPreviewImage(photo.url)}
                    />
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
          stepNum={pickupCaptures.length > 0 ? 2 : 1}
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
                    onClick={() => setPreviewImage(img.url)}
                  >
                    <img src={img.url} alt={`Return ${idx}`} className="w-full h-full object-cover" />
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
          stepNum={pickupCaptures.length > 0 ? 3 : 2}
          title="Charge Details"
          subtitle="Review vehicle readings and enter any additional charges"
          isCompleted={step3Complete}
          isLocked={!step2Complete || isCompleted}
        >
          <CardContent className="pt-4 space-y-5">
            {/* ── Odometer ── */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                End Odometer Reading (km)
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g. 12850"
                className="h-11 max-w-xs"
                value={endOdometer}
                onChange={(e) => {
                  const val = e.target.value;
                  setEndOdometer(val);
                  setReturnSession(null);
                  // Auto-detect km overage when value changes
                  if (val && booking?.startOdometer != null && freeKmLimit != null) {
                    const driven = Math.max(0, parseFloat(val) - booking.startOdometer);
                    const over = Math.max(0, driven - freeKmLimit);
                    if (over > 0) {
                      setKmExceeded(true);
                      if (extraKmRate != null) setExtraKmCharge(String(Math.ceil(over * extraKmRate)));
                    } else {
                      setKmExceeded(false);
                      setExtraKmCharge("");
                    }
                  }
                }}
                disabled={step3Complete}
              />
              {booking.startOdometer != null && kmDriven != null && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    Driven: <span className="font-semibold text-foreground">{kmDriven.toFixed(0)} km</span>
                    <span className="text-xs ml-1">(start: {booking.startOdometer} km)</span>
                  </span>
                  {freeKmLimit != null && (
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      kmDriven > freeKmLimit
                        ? "bg-red-100 text-red-700"
                        : "bg-green-100 text-green-700",
                    )}>
                      Limit: {freeKmLimit} km
                      {kmDriven > freeKmLimit && ` — ${kmOverLimit.toFixed(0)} km over`}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Km Exceeded ── */}
            <div className="space-y-3 p-4 rounded-lg border bg-orange-50/40 border-orange-200">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="kmExceeded"
                  checked={kmExceeded}
                  onCheckedChange={(v) => { setKmExceeded(!!v); setExtraKmCharge(""); setReturnSession(null); }}
                  disabled={step3Complete}
                />
                <Label htmlFor="kmExceeded" className="text-sm font-semibold cursor-pointer text-orange-900 flex items-center gap-2">
                  <Gauge className="h-4 w-4" /> Km Limit Exceeded — charge customer
                </Label>
              </div>
              {kmExceeded && (
                <div className="space-y-1.5 ml-7">
                  <Label className="text-xs text-neutral-600">
                    Extra Km Charge (₹)
                    {suggestedExtraKmCharge != null && (
                      <span className="ml-2 text-orange-600">
                        — suggested ₹{suggestedExtraKmCharge} ({kmOverLimit.toFixed(0)} km × ₹{extraKmRate}/km)
                      </span>
                    )}
                  </Label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      type="number"
                      min="0"
                      className="pl-7 h-10"
                      placeholder="e.g. 500"
                      value={extraKmCharge}
                      onChange={(e) => { setExtraKmCharge(e.target.value); setReturnSession(null); }}
                      disabled={step3Complete}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Fuel Level ── */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Fuel className="h-4 w-4 text-muted-foreground" />
                Return Fuel Level
              </Label>
              {pickupFuelLevel && (
                <p className="text-xs text-muted-foreground">
                  Pickup level: <span className="font-medium text-foreground">{FUEL_LEVEL_OPTIONS.find((o) => o.value === pickupFuelLevel)?.label ?? pickupFuelLevel}</span>
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
                  <Label className="text-xs text-neutral-600">Fuel Deficit Charge (₹)</Label>
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
                  {otherChargeItems.map((item) => (
                    <div key={item.id} className="flex gap-2 items-center">
                      <Input
                        className="h-10 flex-1"
                        placeholder="Description (e.g. Late return fine)"
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
                disabled={!endOdometer || parseFloat(endOdometer) < 0 || computeChargesMutation.isPending}
                onClick={() => computeChargesMutation.mutate()}
              >
                {computeChargesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="h-4 w-4" />
                )}
                Compute Charges
              </Button>
            )}

            {/* Recompute hint when session exists */}
            {step3Complete && !paymentSettled && (
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

        {/* ── STEP 4: Safety Deposit Info ──────────────────────────────────── */}
        {safetyDeposit > 0 && (
          <StepCard
            stepNum={pickupCaptures.length > 0 ? 4 : 3}
            title="Safety Deposit"
            subtitle="The deposit collected at pickup has been applied as a credit"
            isCompleted={step3Complete}
            isLocked={!step3Complete}
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

        {/* ── STEP 5: Collect Payment / Issue Refund ───────────────────────── */}
        <StepCard
          stepNum={pickupCaptures.length > 0 ? (safetyDeposit > 0 ? 5 : 4) : (safetyDeposit > 0 ? 4 : 3)}
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
          isCompleted={step5Complete}
          isLocked={!step3Complete}
        >
          <CardContent className="pt-4 space-y-4">
            {returnSession && !paymentSettled && (
              <>
                {/* Show ledger when no separate deposit step */}
                {safetyDeposit <= 0 && (
                  <LedgerSummaryCard session={returnSession.session} />
                )}

                {/* Zero balance — deposit exactly covered charges */}
                {isZeroBalance && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <p className="text-sm font-medium">
                        The safety deposit covers all charges exactly. No additional payment is needed.
                      </p>
                    </div>
                    <Button
                      className="w-full bg-[#28A745] hover:bg-green-700 text-white h-12 text-sm font-semibold"
                      disabled={zeroBalanceMutation.isPending}
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

                {/* Payment or refund */}
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
                  />
                )}
              </>
            )}

            {paymentSettled && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">Payment settled. Booking marked as Returned.</p>
              </div>
            )}

            {!returnSession && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Compute charges in the previous step to proceed.
              </p>
            )}
          </CardContent>
        </StepCard>

        {/* ── STEP 6: Vehicle Condition ────────────────────────────────────── */}
        <StepCard
          stepNum={pickupCaptures.length > 0 ? (safetyDeposit > 0 ? 6 : 5) : (safetyDeposit > 0 ? 5 : 4)}
          title="Vehicle Condition"
          subtitle="Report any new damage found during return inspection"
          isCompleted={paymentSettled && hasDamage !== null}
          isLocked={!paymentSettled}
        >
          <CardContent className="pt-4 space-y-4">
            {damageSubmitted ? (
              <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 p-4 text-orange-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  Damage report submitted. The branch manager will review and determine any fine.
                </p>
              </div>
            ) : hasDamage === null && paymentSettled ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">Does the vehicle have any new damage?</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setHasDamage(false)}
                    className="flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700"
                  >
                    No Damage
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHasDamage(true); setShowDamageForm(true); }}
                    className="flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all bg-white border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-700"
                  >
                    Damage Found
                  </button>
                </div>
              </div>
            ) : hasDamage === false ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 p-4 text-green-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">No damage reported. Return process is complete.</p>
                </div>
                <button
                  type="button"
                  className="text-xs text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0 ml-3"
                  onClick={() => setHasDamage(null)}
                >
                  Change
                </button>
              </div>
            ) : hasDamage === true && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-orange-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Damage Report
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground text-xs h-8"
                      onClick={() => {
                        // Clean up any uploaded photos before resetting
                        damages.forEach((item) =>
                          item.photos.forEach((p) => deleteDamageImageMutation.mutate(p.publicId)),
                        );
                        activeDamage.photos?.forEach((p) => deleteDamageImageMutation.mutate(p.publicId));
                        setDamages([]);
                        setActiveDamage({ severity: "Minor", photos: [] });
                        setShowDamageForm(false);
                        setDamageChargeType(null);
                        setHasDamage(null);
                      }}
                    >
                      ← No Damage
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDamageForm(true)}>
                      + Add Damage
                    </Button>
                  </div>
                </div>

                {showDamageForm && (
                  <div className="p-4 border rounded-lg space-y-4 bg-background animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Area</Label>
                        <Select onValueChange={(v) => setActiveDamage({ ...activeDamage, area: v })}>
                          <SelectTrigger><SelectValue placeholder="Select Area" /></SelectTrigger>
                          <SelectContent>
                            {damageZones.map((z) => (
                              <SelectItem key={z} value={z}>{z}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Severity</Label>
                        <Select defaultValue="Minor" onValueChange={(v) => setActiveDamage({ ...activeDamage, severity: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Minor">Minor</SelectItem>
                            <SelectItem value="Moderate">Moderate</SelectItem>
                            <SelectItem value="Severe">Severe</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input
                        placeholder="Describe the damage (e.g. 5cm scratch)"
                        onChange={(e) => setActiveDamage({ ...activeDamage, description: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Photos</Label>
                      <div {...getDamageRootProps()} className="border border-dashed p-4 rounded text-center text-sm cursor-pointer hover:bg-muted">
                        <input {...getDamageInputProps()} />
                        <p>Click to upload damage photos</p>
                      </div>
                      {activeDamage.photos && activeDamage.photos.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mt-2">
                          {activeDamage.photos.map((img, idx) => (
                            <div key={img.publicId} className="relative aspect-square rounded overflow-hidden border bg-muted group cursor-pointer" onClick={() => setPreviewImage(img.url)}>
                              <img src={img.url} alt={`Damage ${idx}`} className="w-full h-full object-cover" />
                              <Button
                                size="icon" variant="destructive"
                                className="absolute top-1 right-1 h-5 w-5 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteDamageImageMutation.mutate(img.publicId);
                                  setActiveDamage((prev) => ({ ...prev, photos: prev.photos?.filter((p) => p.publicId !== img.publicId) }));
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" size="sm" onClick={() => setShowDamageForm(false)}>Cancel</Button>
                      <Button size="sm" onClick={addDamageItem}>Save Entry</Button>
                    </div>
                  </div>
                )}

                {damages.length > 0 && (
                  <div className="space-y-3">
                    {damages.map((item) => (
                      <div key={item.id} className="flex items-start justify-between p-3 border rounded-md bg-white shadow-sm">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{item.area}</span>
                            <Badge variant={item.severity === "Severe" ? "destructive" : "outline"}>{item.severity}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                          {item.photos.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mt-2">
                              {item.photos.map((img, idx) => (
                                <div key={img.publicId} className="relative aspect-square rounded overflow-hidden border bg-muted cursor-pointer" onClick={() => setPreviewImage(img.url)}>
                                  <img src={img.url} alt={`Damage ${idx}`} className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeDamageItem(item.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {damages.length > 0 && (
                  <div className="rounded-lg border-2 border-dashed border-orange-200 bg-orange-50/40 p-4 space-y-3">
                    <p className="text-sm font-semibold text-orange-900">
                      Damage Type <span className="text-red-500">*</span>
                    </p>
                    <p className="text-xs text-orange-700">
                      Select how this damage will be charged. This cannot be changed after submission.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setDamageChargeType("PENALTY")}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                          damageChargeType === "PENALTY"
                            ? "border-red-500 bg-red-50 text-red-800"
                            : "border-gray-200 bg-white text-gray-600 hover:border-red-300"
                        )}
                      >
                        <span className="text-sm font-semibold">Damage Penalty</span>
                        <span className="text-xs opacity-80">Customer at fault — GST applicable</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDamageChargeType("COMPENSATION")}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                          damageChargeType === "COMPENSATION"
                            ? "border-blue-500 bg-blue-50 text-blue-800"
                            : "border-gray-200 bg-white text-gray-600 hover:border-blue-300"
                        )}
                      >
                        <span className="text-sm font-semibold">Damage Compensation</span>
                        <span className="text-xs opacity-80">Insurance / coverage — no GST</span>
                      </button>
                    </div>
                  </div>
                )}

                {damages.length > 0 && (
                  <Button
                    className="w-full bg-[#FF5F00] hover:bg-[#e65600] text-white"
                    disabled={reportDamageMutation.isPending || !damageChargeType}
                    onClick={handleSubmitDamage}
                  >
                    {reportDamageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                    Submit Damage Report to Manager
                  </Button>
                )}
              </div>
            )}

            {!paymentSettled && (
              <p className="text-sm text-muted-foreground text-center py-2">
                Complete payment in the previous step to unlock this section.
              </p>
            )}
          </CardContent>
        </StepCard>

        {/* ── Navigate to dashboard after completion ──────────────────────── */}
        {paymentSettled && (hasDamage === false || damageSubmitted) && (
          <Button
            className="w-full bg-[#1A1A1A] hover:bg-black text-white h-12"
            onClick={() => navigate("/employee/dashboard")}
          >
            Return to Dashboard
          </Button>
        )}

        {/* ── Image preview dialog ─────────────────────────────────────────── */}
        <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden bg-zinc-100/80 border-none sm:rounded-lg">
            <div className="relative w-full h-[80vh] flex items-center justify-center">
              <img src={previewImage!} alt="Preview" className="max-w-full max-h-full object-contain" />
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-900" onClick={() => setPreviewImage(null)}>
                <X className="h-6 w-6" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </ReturnPageShell>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY FLOW (usePaymentSessions = false)
  // ══════════════════════════════════════════════════════════════════════════
  const chargeModulesActive = !!(
    frozenConfig?.extraKmEnabled ||
    frozenConfig?.extraTimeEnabled ||
    frozenConfig?.fuelModuleEnabled ||
    frozenConfig?.fastagModuleEnabled ||
    booking?.effectiveFreeKmLimit !== null  // km charges via pricing rules even without frozenConfig
  );

  if (legacySubmissionResult?.success) {
    return (
      <ReturnPageShell {...shellProps}>
        <Card className="max-w-md mx-auto text-center p-6 border-green-200 bg-green-50/50">
          <CardContent className="space-y-4 pt-6">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <FileCheck className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-green-800">{legacySubmissionResult.message}</h2>
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
              {pickupCaptures.map((photo) => (
                <div key={photo.publicId} className="rounded-lg overflow-hidden border bg-gray-50">
                  <img src={photo.url} alt={photo.captureLabel ?? "Pickup photo"} className="w-full h-28 object-cover" loading="lazy" />
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
                <div key={img.publicId} className="relative aspect-square rounded-md overflow-hidden border bg-muted group cursor-pointer" onClick={() => setPreviewImage(img.url)}>
                  <img src={img.url} alt={`Return ${idx}`} className="w-full h-full object-cover" />
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

      {/* Charge Details — legacy */}
      {!isCompleted && returnPhotos.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="text-2xl">2. Charge Details</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" /> End Odometer (km)
              </Label>
              <Input type="number" min="0" placeholder="e.g. 12850" className="h-11 max-w-xs" value={endOdometer}
                onChange={(e) => { setEndOdometer(e.target.value); setReturnSession(null); }} />
              {/* Km overrun summary */}
              {freeKmLimit !== null && endOdometer && kmDriven !== null && (
                <div className={`mt-2 p-3 rounded-lg border text-sm ${kmOverLimit > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}`}>
                  <p className="font-medium">{kmDriven.toFixed(1)} km driven &nbsp;·&nbsp; {freeKmLimit} km included</p>
                  {kmOverLimit > 0 ? (
                    <p className="text-orange-700 font-semibold mt-0.5">
                      +{kmOverLimit.toFixed(1)} km over limit
                      {suggestedExtraKmCharge !== null && ` · suggested ₹${suggestedExtraKmCharge}`}
                    </p>
                  ) : (
                    <p className="text-green-700 mt-0.5">Within free km limit ✓</p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Fuel className="h-4 w-4 text-muted-foreground" /> Return Fuel Level
              </Label>
              <Select value={returnFuelLevel} onValueChange={(v) => { setReturnFuelLevel(v); setReturnSession(null); }}>
                <SelectTrigger className="h-11 max-w-xs"><SelectValue placeholder="Select fuel level" /></SelectTrigger>
                <SelectContent>
                  {FUEL_LEVEL_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {frozenConfig?.fuelModuleEnabled && returnFuelLevel && FUEL_LEVEL_ORDER[returnFuelLevel] < FUEL_LEVEL_ORDER["FULL"] && (
              <div className="space-y-3 p-4 rounded-lg border bg-amber-50/40 border-amber-200">
                <p className="text-sm font-semibold text-amber-900">Fuel Deficit Charge</p>
                <div className="flex items-center gap-3">
                  <Checkbox id="fuelDeficitLegacy" checked={fuelDeficit} onCheckedChange={(v) => { setFuelDeficit(!!v); setFuelCharge(""); }} />
                  <Label htmlFor="fuelDeficitLegacy" className="text-sm cursor-pointer">Charge fuel deficit</Label>
                </div>
                {fuelDeficit && (
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input type="number" min="0" className="pl-7 h-10" placeholder="e.g. 300" value={fuelCharge}
                      onChange={(e) => { setFuelCharge(e.target.value); setReturnSession(null); }} />
                  </div>
                )}
              </div>
            )}
            {frozenConfig?.fastagModuleEnabled && vehicle?.hasFastag && (
              <div className="space-y-3 p-4 rounded-lg border bg-green-50/40 border-green-200">
                <p className="text-sm font-semibold text-green-900">Fastag Toll Charges</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input type="number" min="0" className="pl-7 h-10" placeholder="e.g. 150" value={fastagAmount}
                      onChange={(e) => { setFastagAmount(e.target.value); setReturnSession(null); }} />
                  </div>
                  <Input className="h-10" placeholder="Route / toll plaza..." value={fastagNotes} onChange={(e) => setFastagNotes(e.target.value)} />
                </div>
              </div>
            )}
            {chargeModulesActive && (
              <Button className="bg-[#FF5F00] hover:bg-[#e65600] text-white gap-2"
                disabled={!endOdometer || computeChargesMutation.isPending}
                onClick={() => computeChargesMutation.mutate()}>
                {computeChargesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                Compute Charges
              </Button>
            )}
            {returnSession && (
              <div className="space-y-4">
                <LedgerSummaryCard session={returnSession.session} />
                <RecordPaymentPanel
                  session={returnSession.session}
                  onSuccess={(updatedSession) => {
                    setReturnSession((prev) => prev ? { ...prev, session: updatedSession } : null);
                    if (updatedSession.status === "COMPLETED") {
                      toast.success("Return settled! Booking marked as Returned.");
                      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                      navigate("/employee/dashboard");
                    }
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Condition Check — legacy */}
      {returnPhotos.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="px-6 pt-6"><CardTitle className="text-2xl">3. Vehicle Condition</CardTitle></CardHeader>
          <CardContent className="p-6">
            <div className="flex items-start space-x-4 p-6 border rounded-lg bg-white hover:border-orange-200 transition-colors cursor-pointer"
              onClick={() => !isCompleted && setLegacyHasDamage(!legacyHasDamage)}>
              <Checkbox id="damage-check" checked={legacyHasDamage} onCheckedChange={(c) => setLegacyHasDamage(!!c)} disabled={isCompleted} />
              <div>
                <Label htmlFor="damage-check" className="text-base font-medium">Does the vehicle have any new damage?</Label>
                <p className="text-sm text-muted-foreground">Enable if you identify scratches, dents, or other issues.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sidebar with action buttons — legacy */}
      {returnPhotos.length > 0 && !isCompleted && (
        <div className="flex flex-col gap-3">
          {!legacyHasDamage ? (
            <>
              <Dialog open={legacyShowCompleteDialog} onOpenChange={setLegacyShowCompleteDialog}>
                <Button className="w-full bg-[#28A745] hover:bg-green-700 text-white"
                  onClick={() => setLegacyShowCompleteDialog(true)} disabled={chargeModulesActive && !returnSession}>
                  <FileCheck className="mr-2 h-4 w-4" /> Complete Return
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Complete Return</DialogTitle>
                    <DialogDescription>Confirm the vehicle is in good condition with no new damage.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setLegacyShowCompleteDialog(false)}>Cancel</Button>
                    <Button className="bg-[#28A745] hover:bg-green-700 text-white"
                      onClick={() => completeReturnMutation.mutate({ returnImageIds: returnPhotos.map((p) => p.publicId) })}>
                      Confirm Complete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <Dialog open={legacyShowReportDialog} onOpenChange={setLegacyShowReportDialog}>
              <Button className="w-full bg-[#FF5F00] hover:bg-[#E05200] text-white"
                onClick={() => setLegacyShowReportDialog(true)}>
                <AlertTriangle className="mr-2 h-4 w-4" /> Report Damage to Manager
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Damage Report</DialogTitle>
                  <DialogDescription>This will submit the return for manager review.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLegacyShowReportDialog(false)}>Cancel</Button>
                  <Button variant="destructive"
                    onClick={() => legacyReportDamageMutation.mutate({
                      bookingId,
                      odo: parseFloat(endOdometer) || 0,
                      fuelLevel: FUEL_LEVEL_TO_PCT[returnFuelLevel] ?? 100,
                      severity: legacyDamages.some((d) => d.severity === "Severe") ? "Severe" : legacyDamages.some((d) => d.severity === "Moderate") ? "Moderate" : "Minor",
                      damageImageIds: legacyDamages.flatMap((d) => d.photos.map((p) => p.publicId)),
                      notes: { damages: legacyDamages },
                      returnImageIds: returnPhotos.map((p) => p.publicId),
                    })}>
                    Confirm & Report
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}

      {/* Prevent unused var warning */}
      {legacyDamages.length === 0 && null}

      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-zinc-100/80 border-none sm:rounded-lg">
          <div className="relative w-full h-[80vh] flex items-center justify-center">
            <img src={previewImage!} alt="Preview" className="max-w-full max-h-full object-contain" />
            <Button variant="ghost" size="icon" className="absolute top-2 right-2" onClick={() => setPreviewImage(null)}>
              <X className="h-6 w-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ReturnPageShell>
  );
}
