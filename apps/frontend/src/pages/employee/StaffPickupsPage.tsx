import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Loader2,
  ChevronRight,
  User,
  Calendar,
  Car,
  CheckCircle2,
  AlertCircle,
  FileText,
  Eye,
  X,
  Image as ImageIcon,
  ArrowLeftRight,
  RefreshCw,
  Tag,
  ShieldAlert,
} from "lucide-react";

import { cn, compressImage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, } from "@/components/ui/card";
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
  DialogClose,
} from "@/components/ui/dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { StepCard } from "@/components/employee/StepCard";
// import {
//   ExtendBookingModal,
//   type ExtendBookingModalSuccessResult,
// } from "@/components/employee/extension/ExtendBookingModal";
// import { ExtensionHistoryPanel } from "@/components/employee/extension/ExtensionHistoryPanel";
import { AvailableVehiclesList } from "@/components/manager/vehicle-swap/AvailableVehiclesList";
import { SwapConfirmationModal } from "@/components/manager/vehicle-swap/SwapConfirmationModal";

import apiClient from "@/lib/axios";
import { bookingService } from "@/services/booking.service";
import { kycService } from "@/services/kyc.service";
// import { extensionService } from "@/services/extension.service";
import { employeeVehicleSwapService } from "@/services/vehicleSwap.service";
import { paymentSessionService, type PaymentSession } from "@/services/paymentSession.service";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import {
  PickupImageCard,
  type UploadedImage,
} from "@/components/employee/PickupImageCard";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";

interface CaptureField {
  name: string;
  required: boolean;
}
interface CaptureConfig {
  publicId: string;
  fields: CaptureField[];
  category: { name: string };
}

// --- HELPERS ---
const getDocumentTypeName = (type: string): string => {
  switch (type) {
    case "DL":
      return "Driver's License";
    case "AADHAAR":
      return "Aadhaar";
    case "PAN":
      return "PAN Card";
    default:
      return type;
  }
};

const isImageFile = (mime: string): boolean => mime.startsWith("image/");

// --- FUEL LEVEL CONSTANTS ---
const FUEL_LEVEL_OPTIONS = [
  { value: "EMPTY", label: "Empty (0%)" },
  { value: "QUARTER", label: "Quarter (25%)" },
  { value: "HALF", label: "Half (50%)" },
  { value: "THREE_QUARTER", label: "Three Quarter (75%)" },
  { value: "FULL", label: "Full (100%)" },
] as const;

const FUEL_LEVEL_TO_NUM: Record<string, number> = {
  EMPTY: 0,
  QUARTER: 25,
  HALF: 50,
  THREE_QUARTER: 75,
  FULL: 100,
};

// --- VALIDATION SCHEMA ---
const handoverSchema = z.object({
  odo: z
    .number({ invalid_type_error: "Must be a number" })
    .min(0, "Odometer must be positive"),
  fuelLevel: z.string({ required_error: "Fuel level is required" }),
  requireManagerConfirmation: z.boolean().optional(),
});

type HandoverFormValues = z.infer<typeof handoverSchema>;

// StepCard is imported from @/components/employee/StepCard

// --- YES/NO TOGGLE ---
interface YesNoToggleProps {
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  yesLabel?: string;
  noLabel?: string;
}

function YesNoToggle({
  value,
  onChange,
  disabled = false,
  yesLabel = "Yes",
  noLabel = "No",
}: YesNoToggleProps) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={cn(
          "flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all",
          value === true
            ? "bg-green-500 border-green-500 text-white"
            : "bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={cn(
          "flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all",
          value === false
            ? "bg-red-500 border-red-500 text-white"
            : "bg-white border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-700",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {noLabel}
      </button>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function StaffPickupsPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- STEP 0: Vehicle Available ---
  const [vehicleAvailable, setVehicleAvailable] = useState<boolean | null>(null);
  const [swapCompleted, setSwapCompleted] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<AvailableVehicle | null>(null);
  const [showSwapConfirmModal, setShowSwapConfirmModal] = useState(false);

  // --- STEP 1: Extension --- (temporarily disabled)
  // const [extensionChosen, setExtensionChosen] = useState<boolean | null>(null);
  // const [extensionCompleted, setExtensionCompleted] = useState(false);
  // const [showExtendModal, setShowExtendModal] = useState(false);
  // const [pendingExtensionPublicId, setPendingExtensionPublicId] = useState<string | null>(null);

  // --- STEP 2: Payment ---
  // Session-based pickup: set when InitiatePickupSession succeeds or restored on mount
  const [pickupSession, setPickupSession] = useState<PaymentSession | null>(null);

  // --- STEP 6: Safety Deposit (managed after session is initiated) ---
  // safetyDepositAmount / safetyDepositReason / requestSafetyDeposit already declared below

  // --- STEP 7: Discount ---
  const [discountInput, setDiscountInput] = useState("");
  const [pendingDiscountCode, setPendingDiscountCode] = useState<string | null>(null);

  // --- STEP 3: KYC ---
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);

  // --- STEP 4: Inspection ---
  const [requestSafetyDeposit, setRequestSafetyDeposit] = useState(false);
  const [safetyDepositAmount, setSafetyDepositAmount] = useState<string>("");
  const [safetyDepositReason, setSafetyDepositReason] = useState<string>("");

  // --- STEP 5: Photos ---
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [captureSlots, setCaptureSlots] = useState<Record<string, UploadedImage | null>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);

  // --- CONFIRM DIALOG ---
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // --- DATA FETCHING ---
  const {
    data: booking,
    isLoading: isLoadingBooking,
    error: bookingError,
  } = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () =>
      bookingId ? bookingService.getPickupDetails(bookingId) : null,
    enabled: !!bookingId,
    retry: false,
  });

  const { data: kycData, isLoading: isLoadingKyc } = useQuery({
    queryKey: ["booking-kyc", bookingId],
    queryFn: () => (bookingId ? kycService.getBookingKyc(bookingId) : null),
    enabled: !!bookingId,
    retry: false,
  });

  const { data: captureConfigData } = useQuery<{ config: CaptureConfig | null }>({
    queryKey: ["capture-config", bookingId],
    queryFn: () =>
      apiClient
        .get(`/employee/pickup/${bookingId}/capture-config`)
        .then((r) => r.data),
    enabled: !!bookingId,
    retry: false,
  });
  const captureConfig = captureConfigData?.config ?? null;

  // Available vehicles for swap (only when vehicleAvailable === false)
  const {
    data: availableVehicles,
    isLoading: isLoadingVehicles,
    refetch: refetchVehicles,
  } = useQuery({
    queryKey: ["employee-swap-vehicles", bookingId],
    queryFn: () =>
      bookingId
        ? employeeVehicleSwapService.getAvailableVehicles(bookingId)
        : Promise.resolve([]),
    enabled: vehicleAvailable === false,
  });

  // Pricing rules (lazy — only when confirm dialog opens)
  const { data: pricingRules, isLoading: isLoadingPricing } = useQuery({
    queryKey: ["pickup-pricing-rules", bookingId],
    queryFn: () =>
      bookingId ? bookingService.getPickupPricingRules(bookingId) : null,
    enabled: isConfirmOpen,
  });

  // Extension query — temporarily disabled
  // const { data: extensionsData } = useQuery({
  //   queryKey: ["extensions", booking?.publicId],
  //   queryFn: () =>
  //     booking?.publicId
  //       ? extensionService.listEmployeeExtensions(1, 50, booking.publicId)
  //       : null,
  //   enabled: !!booking?.publicId,
  // });

  // Auto-select "Yes" on the extension step if an extension already exists
  // useEffect(() => {
  //   const extensions = extensionsData?.data?.extensions;
  //   if (!extensions?.length) return;
  //   const active = extensions.find((e) =>
  //     ["PAYMENT_COLLECTED", "CONFIRMED", "PENDING_PAYMENT"].includes(e.extensionStatus),
  //   );
  //   if (!active) return;
  //   setExtensionChosen(true);
  //   setExtensionCompleted(true);
  //   if (active.extensionStatus === "PENDING_PAYMENT") {
  //     setPendingExtensionPublicId((prev) => prev ?? active.publicId);
  //   }
  // }, [extensionsData]);

  // --- FORM ---
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<HandoverFormValues>({
    resolver: zodResolver(handoverSchema),
    defaultValues: { fuelLevel: "", requireManagerConfirmation: false },
    mode: "onChange",
  });

  // Auto-populate odometer from the vehicle's current odo reading
  useEffect(() => {
    const odo = booking?.items?.[0]?.vehicle?.odo;
    if (odo != null && odo > 0) {
      setValue("odo", odo, { shouldValidate: true });
    }
  }, [booking, setValue]);

  // --- MUTATIONS ---
  const verifyKycMutation = useMutation({
    mutationFn: ({ kycId, status }: { kycId: string; status: "APPROVED" | "REJECTED" }) =>
      kycService.verifyKyc(kycId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-kyc", bookingId] });
      toast.success("Document status updated");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to update status");
    },
  });

  const handoverMutation = useMutation({
    mutationFn: (data: {
      odo: number;
      fuelLevel: number;
      pickupImageIds?: string[];
      requireManagerConfirmation?: boolean;
    }) => bookingService.approvePickup(bookingId!, data),
    onSuccess: (response: any) => {
      toast.success(response?.message || "Vehicle Handover Confirmed!");
      setIsConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      navigate("/employee/dashboard");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to confirm handover");
      setIsConfirmOpen(false);
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return bookingService.uploadPickupImage(formData);
    },
    onSuccess: (data) => {
      setUploadedImages((prev) => [...prev, data]);
      setUploadError(null);
      toast.success("Image uploaded successfully");
    },
    onError: (error: any) => {
      setUploadError(error.response?.data?.message || "Failed to upload image");
      toast.error(error.response?.data?.message || "Failed to upload image");
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: (fileId: string) => bookingService.deletePickupImage(fileId),
    onSuccess: (_, fileId) => {
      setUploadedImages((prev) => prev.filter((img) => img.fileId !== fileId));
      toast.success("Image deleted");
      setDeletingImageId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to delete image");
      setDeletingImageId(null);
    },
  });

  const initiatePickupSessionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof paymentSessionService.initiatePickupSession>[1]) =>
      paymentSessionService.initiatePickupSession(bookingId!, payload),
    onSuccess: (session) => {
      setPickupSession(session);
      setTimeout(() => {
        document.getElementById("pickup-payment-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 409) {
        setIsConfirmOpen(true);
      } else {
        toast.error(error?.response?.data?.message || "Failed to initiate payment session");
      }
    },
  });

  const applyDiscountMutation = useMutation({
    mutationFn: (code: string) => paymentSessionService.applyDiscountToPickupSession(bookingId!, code),
    onSuccess: (session) => {
      setPickupSession(session);
      setDiscountInput("");
      toast.success("Discount applied");
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || "Invalid discount code"),
  });

  const removeDiscountMutation = useMutation({
    mutationFn: () => paymentSessionService.removeDiscountFromPickupSession(bookingId!),
    onSuccess: (session) => {
      setPickupSession(session);
      setPendingDiscountCode(null);
      toast.success("Discount removed");
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || "Failed to remove discount"),
  });

  const addDepositMutation = useMutation({
    mutationFn: (payload: { amount: number; reason: string }) =>
      paymentSessionService.addDepositToPickupSession(bookingId!, payload),
    onSuccess: (session) => {
      setPickupSession(session);
      toast.success("Safety deposit updated");
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || "Failed to update deposit"),
  });

  const removeDepositMutation = useMutation({
    mutationFn: () => paymentSessionService.removeDepositFromPickupSession(bookingId!),
    onSuccess: (session) => {
      setPickupSession(session);
      setRequestSafetyDeposit(false);
      setSafetyDepositAmount("");
      setSafetyDepositReason("");
      toast.success("Safety deposit removed");
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || "Failed to remove deposit"),
  });

  const swapMutation = useMutation({
    mutationFn: (swapData: {
      reason: any;
      reasonNotes?: string;
      markOriginalForMaintenance?: boolean;
      originalVehicleNotes?: string;
    }) =>
      employeeVehicleSwapService.performSwap(bookingId!, {
        newVehicleId: selectedVehicle!.id,
        ...swapData,
      }),
    onSuccess: () => {
      toast.success("Vehicle swapped successfully!");
      setSwapCompleted(true);
      setShowSwapConfirmModal(false);
      setSelectedVehicle(null);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to swap vehicle");
    },
  });

  // --- DERIVED STATE ---
  const kycDocs = kycData?.kyc || [];
  const areAllDocsApproved =
    kycDocs.length > 0 && kycDocs.every((doc) => doc.status === "APPROVED");
  const isPickedUp = booking?.status === "PICKED_UP";
  // useSessionFlow is true whenever the branch has usePaymentSessions enabled —
  // regardless of whether this is an advance-payment booking. Extension-only and
  // deposit-only pickups also use the session flow.
  const useSessionFlow = booking?.usePaymentSessions === true;

  // Restore active session on page reload (must be after useSessionFlow is declared)
  useEffect(() => {
    if (!bookingId || !useSessionFlow || pickupSession) return;
    paymentSessionService.getActivePickupSession(bookingId).then((session) => {
      if (session) setPickupSession(session);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, useSessionFlow]);

  const canProceedFromStep0 = vehicleAvailable === true || swapCompleted;
  // Extension step disabled — step 1 passes through automatically
  const canProceedFromStep1 = canProceedFromStep0;
  const canProceedFromStep2 = canProceedFromStep1;
  const isHandoverReady =
    canProceedFromStep2 &&
    areAllDocsApproved &&
    (watch("odo") ?? 0) > 0 &&
    watch("fuelLevel") !== "";

  // --- HANDLERS ---
  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setIsUploading(true);
    try {
      const processedFile = await compressImage(file);
      await uploadImageMutation.mutateAsync(processedFile);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteImage = (fileId: string) => {
    setDeletingImageId(fileId);
    deleteImageMutation.mutate(fileId);
  };

  const handleCaptureSlotUpload = async (fieldName: string, file: File) => {
    setUploadingSlot(fieldName);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const data = await bookingService.uploadPickupImage(formData);
      setCaptureSlots((prev) => ({ ...prev, [fieldName]: data }));
    } catch {
      toast.error(`Failed to upload photo for ${fieldName}`);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleCaptureSlotDelete = async (fieldName: string, fileId: string) => {
    try {
      await bookingService.deletePickupImage(fileId);
      setCaptureSlots((prev) => ({ ...prev, [fieldName]: null }));
    } catch {
      toast.error(`Failed to remove photo for ${fieldName}`);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatPrice = (amount: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
    }).format(Number(amount));

  const buildHandoverPayload = (data: HandoverFormValues) => {
    const fuelNumeric = FUEL_LEVEL_TO_NUM[data.fuelLevel] ?? 0;
    const chargeConfig = booking?.frozenChargeConfig;
    const safetyDepositPayload =
      requestSafetyDeposit && safetyDepositAmount && safetyDepositReason
        ? {
            requestedAmount: parseFloat(safetyDepositAmount),
            reason: safetyDepositReason,
          }
        : undefined;

    const base = {
      odo: data.odo,
      fuelLevel: fuelNumeric,
      pickupFuelLevel: chargeConfig?.fuelModuleEnabled ? data.fuelLevel : undefined,
      requireManagerConfirmation: data.requireManagerConfirmation,
      payRemainingAtPickup: true,
      safetyDepositRequest: safetyDepositPayload,
    };

    if (captureConfig) {
      const captureImages = Object.entries(captureSlots)
        .filter(([, img]) => img !== null)
        .map(([label, img]) => ({ fileId: img!.fileId, label }));
      return { ...base, captureImages: captureImages.length > 0 ? captureImages : undefined };
    } else {
      const imageIds = uploadedImages.map((img) => img.fileId);
      return { ...base, pickupImageIds: imageIds.length > 0 ? imageIds : undefined };
    }
  };

  const onConfirmHandover = (data: HandoverFormValues) => {
    // const chargeConfig = booking?.frozenChargeConfig;

    // Validate required capture photos
    if (captureConfig) {
      const missing = captureConfig.fields
        .filter((f) => f.required && !captureSlots[f.name])
        .map((f) => f.name);
      if (missing.length > 0) {
        toast.error(`Missing required photos: ${missing.join(", ")}`);
        return;
      }
    }

    const payload = buildHandoverPayload(data);

    if (useSessionFlow) {
      initiatePickupSessionMutation.mutate({
        odo: payload.odo,
        fuelLevel: payload.fuelLevel,
        pickupFuelLevel: payload.pickupFuelLevel,
        pickupImageIds: (payload as any).pickupImageIds,
        captureImages: (payload as any).captureImages,
        safetyDepositAmount: requestSafetyDeposit && safetyDepositAmount
          ? parseFloat(safetyDepositAmount)
          : undefined,
        safetyDepositReason: requestSafetyDeposit && safetyDepositReason
          ? safetyDepositReason
          : undefined,
        // extensionPublicId: pendingExtensionPublicId ?? undefined, // extension disabled
        discountCode: pendingDiscountCode ?? undefined,
      });
    } else {
      setIsConfirmOpen(true);
    }
  };

  const onConfirmHandoverLegacy = (data: HandoverFormValues) => {
    const payload = buildHandoverPayload(data);
    handoverMutation.mutate(payload as any);
  };

  // --- LOADING / ERROR STATES ---
  if (isLoadingBooking || isLoadingKyc) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <DashboardNavbar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#FF5F00]" />
        </div>
      </div>
    );
  }

  if (bookingError || !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <DashboardNavbar />
        <div className="flex-1 container py-10">
          <Card className="max-w-md mx-auto text-center py-10">
            <CardContent>
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Booking Not Found</h2>
              <p className="text-muted-foreground mb-6">
                Make sure the Booking ID is correct.
              </p>
              <Button onClick={() => navigate("/employee/dashboard")}>
                Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const vehicle = booking.items[0]?.vehicle;
  const customer = booking.customer.user;

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />

      <main className="container max-w-3xl mx-auto py-6 px-4 space-y-5">
        {/* Breadcrumb */}
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
              <BreadcrumbPage>Pickup</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{booking.publicId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Vehicle Handover
          </h1>
          <p className="text-sm text-muted-foreground">
            Complete each step in order to process the pickup
          </p>
        </div>

        {/* Booking Summary Card */}
        <Card className="shadow-sm border-gray-200 bg-white">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  Customer
                </p>
                <p className="font-semibold text-gray-900 flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {customer.name}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  Vehicle
                </p>
                <p className="font-semibold text-gray-900 flex items-center gap-1">
                  <Car className="h-3.5 w-3.5 text-muted-foreground" />
                  {vehicle?.make} {vehicle?.model}
                </p>
                <p className="text-xs text-muted-foreground">{vehicle?.regNo}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  Start
                </p>
                <p className="font-medium text-gray-700 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(booking.startAt)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  End
                </p>
                <p className="font-medium text-gray-700 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(booking.endAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Already Picked Up Banner */}
        {isPickedUp && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Status: PICKED UP</span>
            <span className="ml-auto text-sm">Vehicle has been handed over.</span>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 0: VEHICLE AVAILABLE?                                  */}
        {/* ─────────────────────────────────────────────────────────── */}
        <StepCard
          stepNum={1}
          title="Is the vehicle available and ready?"
          subtitle="Confirm the vehicle is on-site and in good condition"
          isCompleted={canProceedFromStep0}
          isLocked={isPickedUp}
        >
          <CardContent className="pt-4 space-y-4">
            <YesNoToggle
              value={vehicleAvailable}
              onChange={(v) => {
                setVehicleAvailable(v);
                if (v && swapCompleted) {
                  // They previously swapped but now say yes — allow
                }
              }}
              disabled={isPickedUp || swapCompleted}
            />

            {/* Swap completed success message */}
            {swapCompleted && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  Vehicle swapped. You may now proceed with the replacement
                  vehicle.
                </p>
              </div>
            )}

            {/* Inline swap panel */}
            {vehicleAvailable === false && !swapCompleted && (
              <div className="mt-2 space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p className="text-sm">
                    Select a replacement vehicle to continue the pickup.
                  </p>
                </div>

                {isLoadingVehicles ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Loading available vehicles…
                    </span>
                  </div>
                ) : availableVehicles && availableVehicles.length > 0 ? (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 border-b flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                        <ArrowLeftRight className="h-4 w-4 text-[#FF5F00]" />
                        Available for Swap ({availableVehicles.length})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchVehicles()}
                        className="h-7 gap-1 text-xs"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Refresh
                      </Button>
                    </div>
                    <div className="p-3">
                      <AvailableVehiclesList
                        vehicles={availableVehicles}
                        onSelectVehicle={(v) => {
                          setSelectedVehicle(v);
                          setShowSwapConfirmModal(true);
                        }}
                        selectedVehicleId={selectedVehicle?.id}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center">
                    <AlertCircle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-yellow-800 mb-1">
                      No vehicles available for swap
                    </p>
                    <p className="text-xs text-yellow-700">
                      All vehicles are in use or not eligible. Contact the
                      branch manager.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchVehicles()}
                      className="mt-3 gap-1"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </StepCard>

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 1: EXTENSION — temporarily disabled                    */}
        {/* ─────────────────────────────────────────────────────────── */}
        {/* <StepCard
          stepNum={2}
          title="Does the customer need an extension?"
          subtitle="Extend the booking duration before proceeding"
          isCompleted={canProceedFromStep1}
          isLocked={!canProceedFromStep0 || isPickedUp}
        >
          <CardContent className="pt-4 space-y-4">
            <YesNoToggle
              value={extensionChosen}
              onChange={(v) => {
                setExtensionChosen(v);
                if (v) setShowExtendModal(true);
              }}
              disabled={!canProceedFromStep0 || isPickedUp || extensionCompleted}
              yesLabel="Yes — Extend"
              noLabel="No — Continue"
            />
            {extensionCompleted && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  {pendingExtensionPublicId
                    ? "Extension committed — charge will be collected at payment."
                    : "Extension processed. Booking dates updated."}
                </p>
              </div>
            )}
            {extensionChosen === true && !extensionCompleted && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-blue-800">
                <Clock className="h-4 w-4 shrink-0" />
                <p className="text-sm">
                  Extension modal is open. {useSessionFlow ? "Confirm to add charge to payment." : "Complete the payment to proceed."}
                </p>
              </div>
            )}
            {canProceedFromStep0 && (
              <ExtensionHistoryPanel bookingPublicId={booking.publicId} role="employee" />
            )}
          </CardContent>
        </StepCard> */}

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEPS 3–7: only shown/unlocked when step 2 is resolved      */}
        {/* ─────────────────────────────────────────────────────────── */}

        {/* STEP 3: KYC VERIFICATION */}
        <StepCard
          stepNum={3}
          title="KYC Verification"
          subtitle="Approve all customer documents before handover"
          isCompleted={areAllDocsApproved}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4">
            {kycDocs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No documents uploaded yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {kycDocs.map((doc) => {
                  const isImage = isImageFile(doc.file.mime);
                  const fileName =
                    doc.file.url.split("/").pop()?.split("?")[0] || "Document";

                  return (
                    <div
                      key={doc.publicId}
                      className="group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:shadow-md transition-all"
                    >
                      <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                        {isImage ? (
                          <img
                            src={doc.file.url}
                            alt={doc.type}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <FileText className="w-12 h-12 opacity-50" />
                            <span className="text-xs font-medium">
                              PDF Document
                            </span>
                          </div>
                        )}
                        <span
                          className={cn(
                            "absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full z-10",
                            doc.status === "APPROVED"
                              ? "bg-emerald-100 text-emerald-700"
                              : doc.status === "REJECTED"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-600",
                          )}
                        >
                          {doc.status}
                        </span>
                        <div className="absolute inset-0 bg-zinc-900/0 group-hover:bg-zinc-900/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-9 bg-white/90 hover:bg-white text-xs"
                            onClick={() => setSelectedDoc(doc)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1.5" /> View
                          </Button>
                        </div>
                      </div>

                      <div className="p-3 bg-white flex flex-col gap-3">
                        <div>
                          <p className="font-medium text-sm truncate">
                            {getDocumentTypeName(doc.type)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                            {isImage ? (
                              <ImageIcon className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {fileName}
                          </p>
                        </div>
                        {!isPickedUp && doc.status !== "APPROVED" && (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 flex-1 bg-green-50 text-green-700 hover:bg-green-100 border-green-200"
                              variant="outline"
                              onClick={() =>
                                verifyKycMutation.mutate({
                                  kycId: doc.publicId,
                                  status: "APPROVED",
                                })
                              }
                              disabled={verifyKycMutation.isPending}
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 flex-1 bg-red-50 text-red-700 hover:bg-red-100 border-red-200"
                              variant="outline"
                              onClick={() =>
                                verifyKycMutation.mutate({
                                  kycId: doc.publicId,
                                  status: "REJECTED",
                                })
                              }
                              disabled={verifyKycMutation.isPending}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </StepCard>

        {/* STEP 4: VEHICLE INSPECTION */}
        <StepCard
          stepNum={4}
          title="Vehicle Inspection"
          subtitle="Record odometer and fuel level at handover"
          isCompleted={
            canProceedFromStep2 &&
            (watch("odo") ?? 0) > 0 &&
            watch("fuelLevel") !== ""
          }
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4">
            <form className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="odo" className="text-sm font-medium">
                  Odometer Reading (KM)
                </Label>
                <Controller
                  name="odo"
                  control={control}
                  render={({ field }) => (
                    <Input
                      id="odo"
                      type="number"
                      placeholder="e.g. 12500"
                      className="h-12"
                      disabled={isPickedUp}
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    />
                  )}
                />
                {errors.odo && (
                  <p className="text-xs text-red-500">{errors.odo.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="fuelLevel" className="text-sm font-medium">
                  {booking?.frozenChargeConfig?.fuelModuleEnabled
                    ? "Pickup Fuel Level"
                    : "Fuel Level"}
                </Label>
                <Controller
                  name="fuelLevel"
                  control={control}
                  render={({ field }) => (
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={isPickedUp}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select Fuel Level" />
                      </SelectTrigger>
                      <SelectContent>
                        {FUEL_LEVEL_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.fuelLevel && (
                  <p className="text-xs text-red-500">
                    {errors.fuelLevel.message}
                  </p>
                )}
              </div>

            </form>
          </CardContent>
        </StepCard>

        {/* STEP 5: PICKUP PHOTOS */}
        <StepCard
          stepNum={5}
          title="Pickup Photos"
          subtitle={
            captureConfig
              ? `${captureConfig.category.name} — capture required angles`
              : "Upload photos of the vehicle before handover"
          }
          isCompleted={false}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4">
            {captureConfig ? (
              <div className="grid grid-cols-2 gap-3">
                {captureConfig.fields.map((field) => {
                  const slot = captureSlots[field.name] ?? null;
                  const isUploadingThis = uploadingSlot === field.name;
                  return (
                    <div
                      key={field.name}
                      className="border rounded-lg overflow-hidden bg-gray-50"
                    >
                      {slot ? (
                        <div className="relative">
                          <img
                            src={slot.url}
                            alt={field.name}
                            className="w-full h-28 object-cover"
                          />
                          {!isPickedUp && (
                            <button
                              type="button"
                              onClick={() =>
                                handleCaptureSlotDelete(field.name, slot.fileId)
                              }
                              className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <label
                          className={cn(
                            "flex flex-col items-center justify-center h-28 cursor-pointer gap-1 text-muted-foreground hover:bg-gray-100 transition-colors",
                            isPickedUp && "cursor-default opacity-50",
                          )}
                        >
                          {isUploadingThis ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <ImageIcon className="h-5 w-5 opacity-50" />
                          )}
                          <span className="text-xs">
                            {isUploadingThis ? "Uploading…" : "Tap to upload"}
                          </span>
                          {!isPickedUp && (
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f)
                                  handleCaptureSlotUpload(field.name, f);
                                e.target.value = "";
                              }}
                            />
                          )}
                        </label>
                      )}
                      <div className="px-2 py-1.5 bg-white border-t flex items-center gap-1">
                        <span className="text-xs font-medium truncate">
                          {field.name}
                        </span>
                        {field.required && (
                          <span className="text-orange-500 text-xs shrink-0">
                            *
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {!isPickedUp && (
                  <DocumentUploadZone
                    onFileSelect={handleFileSelect}
                    isUploading={isUploading}
                    disabled={isPickedUp}
                    error={uploadError}
                  />
                )}
                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    {uploadedImages.map((image) => (
                      <PickupImageCard
                        key={image.fileId}
                        image={image}
                        onDelete={handleDeleteImage}
                        isDeleting={deletingImageId === image.fileId}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </StepCard>

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 6: SAFETY DEPOSIT                                      */}
        {/* ─────────────────────────────────────────────────────────── */}
        <StepCard
          stepNum={6}
          title="Safety Deposit"
          subtitle="Optional — collect a refundable deposit before handover"
          isCompleted={requestSafetyDeposit === false || (requestSafetyDeposit && !!safetyDepositAmount && !!safetyDepositReason)}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox
                id="requestDeposit"
                checked={requestSafetyDeposit}
                onCheckedChange={(v) => {
                  const checked = !!v;
                  setRequestSafetyDeposit(checked);
                  // If session is open and employee unchecks, remove deposit from session
                  if (!checked && pickupSession) {
                    removeDepositMutation.mutate();
                  }
                }}
                disabled={isPickedUp || removeDepositMutation.isPending}
              />
              <Label htmlFor="requestDeposit" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                Request Safety Deposit
              </Label>
            </div>

            {requestSafetyDeposit && (
              <div className="space-y-3 pl-7">
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">Amount (₹)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      type="number"
                      min="0"
                      className="pl-7 h-10"
                      placeholder="e.g. 2000"
                      value={safetyDepositAmount}
                      onChange={(e) => setSafetyDepositAmount(e.target.value)}
                      disabled={isPickedUp}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-600">Reason</Label>
                  <Input
                    className="h-10"
                    placeholder="Reason for safety deposit..."
                    value={safetyDepositReason}
                    onChange={(e) => setSafetyDepositReason(e.target.value)}
                    disabled={isPickedUp}
                  />
                </div>
                {/* If session is open, show Update button to sync deposit into ledger */}
                {pickupSession && safetyDepositAmount && safetyDepositReason && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={addDepositMutation.isPending}
                    onClick={() =>
                      addDepositMutation.mutate({
                        amount: parseFloat(safetyDepositAmount),
                        reason: safetyDepositReason,
                      })
                    }
                  >
                    {addDepositMutation.isPending ? (
                      <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Updating…</>
                    ) : (
                      "Update Deposit in Session"
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </StepCard>

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 7: DISCOUNT / COUPON CODE                             */}
        {/* ─────────────────────────────────────────────────────────── */}
        <StepCard
          stepNum={7}
          title="Discount / Coupon Code"
          subtitle="Optional — apply a coupon to reduce the total"
          isCompleted={false}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4 space-y-3">
            {pickupSession ? (
              // Session is open — apply/remove discount live
              (() => {
                const discountEntry = pickupSession.entries.find((e) => e.classification === "DISCOUNT");
                return discountEntry ? (
                  <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                    <div className="flex items-center gap-2 text-green-800">
                      <Tag className="h-4 w-4" />
                      <span className="text-sm font-medium">{discountEntry.description}</span>
                      <span className="text-sm font-semibold">
                        −{formatPrice(Math.abs(parseFloat(discountEntry.amount)).toString())}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50 px-2"
                      disabled={removeDiscountMutation.isPending}
                      onClick={() => removeDiscountMutation.mutate()}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9 h-10 uppercase"
                        placeholder="Enter coupon code"
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
                        disabled={applyDiscountMutation.isPending}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-10 px-4 bg-[#FF5F00] hover:bg-[#e65600]"
                      disabled={!discountInput.trim() || applyDiscountMutation.isPending}
                      onClick={() => applyDiscountMutation.mutate(discountInput.trim())}
                    >
                      {applyDiscountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                    </Button>
                  </div>
                );
              })()
            ) : (
              // Pre-session — store code locally, will be sent at initiation
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9 h-10 uppercase"
                      placeholder="Enter coupon code"
                      value={pendingDiscountCode ?? discountInput}
                      onChange={(e) => {
                        setDiscountInput(e.target.value.toUpperCase());
                        setPendingDiscountCode(null);
                      }}
                      disabled={!!pendingDiscountCode}
                    />
                  </div>
                  {pendingDiscountCode ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10 text-red-600"
                      onClick={() => { setPendingDiscountCode(null); setDiscountInput(""); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-10 px-4 bg-[#FF5F00] hover:bg-[#e65600]"
                      disabled={!discountInput.trim()}
                      onClick={() => { setPendingDiscountCode(discountInput.trim()); }}
                    >
                      Save
                    </Button>
                  )}
                </div>
                {pendingDiscountCode && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <Tag className="h-3.5 w-3.5" />
                    <span>Coupon <strong>{pendingDiscountCode}</strong> will be applied at payment</span>
                  </div>
                )}
                {!pendingDiscountCode && (
                  <p className="text-xs text-muted-foreground">
                    Discount will be validated and applied when you proceed to payment.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </StepCard>

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 8: COLLECT PAYMENT (session) / CONFIRM HANDOVER       */}
        {/* ─────────────────────────────────────────────────────────── */}
        {!isPickedUp && useSessionFlow && (
          <div id="pickup-payment-section">
            <StepCard
              stepNum={8}
              title="Collect Payment"
              subtitle="Review charges and collect payment from the customer"
              isCompleted={pickupSession?.status === "COMPLETED"}
              isLocked={!isHandoverReady}
            >
              <CardContent className="pt-4 space-y-4">
                {!pickupSession ? (
                  <>
                    {/* Pre-session charge preview */}
                    <div className="rounded-lg border divide-y text-sm">
                      {booking.remainingBalance && parseFloat(booking.remainingBalance) > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-muted-foreground">Remaining rental balance</span>
                          <span className="font-medium">{formatPrice(booking.remainingBalance)}</span>
                        </div>
                      )}
                      {/* Extension charge preview — disabled
                      {pendingExtensionPublicId && extensionsData?.data?.extensions && (() => {
                        const ext = extensionsData.data.extensions.find(
                          (e) => e.publicId === pendingExtensionPublicId,
                        );
                        return ext ? (
                          <div className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-muted-foreground">Extension charge</span>
                            <span className="font-medium">{formatPrice(ext.additionalAmount)}</span>
                          </div>
                        ) : null;
                      })()}
                      */}
                      {requestSafetyDeposit && safetyDepositAmount && parseFloat(safetyDepositAmount) > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-muted-foreground">Safety deposit</span>
                          <span className="font-medium">{formatPrice(safetyDepositAmount)}</span>
                        </div>
                      )}
                      {pendingDiscountCode && (
                        <div className="flex items-center justify-between px-4 py-2.5 text-green-700">
                          <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Coupon ({pendingDiscountCode})</span>
                          <span className="text-xs">Applied at payment</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                        <span className="font-semibold text-sm">Estimated total</span>
                        <span className="font-bold text-base">
                          {formatPrice(
                            (parseFloat(booking.remainingBalance ?? "0") || 0) +
                            // extension charge removed (feature disabled)
                            (requestSafetyDeposit ? parseFloat(safetyDepositAmount || "0") || 0 : 0),
                          )}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground text-center">
                      GST and discounts will be computed on the next step
                    </p>

                    <Button
                      type="button"
                      className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-12 text-sm font-semibold rounded-xl"
                      disabled={!isHandoverReady || initiatePickupSessionMutation.isPending}
                      onClick={handleSubmit(onConfirmHandover)}
                    >
                      {initiatePickupSessionMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Computing charges…</>
                      ) : (
                        "Confirm & Proceed to Payment →"
                      )}
                    </Button>
                    {!isHandoverReady && (
                      <p className="text-xs text-center text-muted-foreground">
                        Complete all steps above to proceed
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <LedgerSummaryCard
                      session={pickupSession}
                      onRemoveDiscount={() => removeDiscountMutation.mutate()}
                    />
                    <RecordPaymentPanel
                      session={pickupSession}
                      onSuccess={(updatedSession) => {
                        setPickupSession(updatedSession);
                        if (updatedSession.status === "COMPLETED") {
                          toast.success("Payment collected! Booking marked as Picked Up.");
                          queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                          navigate("/employee/dashboard");
                        }
                      }}
                    />
                  </>
                )}
              </CardContent>
            </StepCard>
          </div>
        )}

        {!isPickedUp && !useSessionFlow && (
          <div className="pt-2">
            <Button
              type="button"
              className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-14 text-base font-semibold rounded-xl shadow-md"
              disabled={!isHandoverReady || handoverMutation.isPending}
              onClick={handleSubmit(onConfirmHandoverLegacy)}
            >
              {handoverMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                "Confirm Handover"
              )}
            </Button>
            {!isHandoverReady && (
              <p className="text-xs text-center text-muted-foreground mt-2">
                Complete all steps above to enable handover
              </p>
            )}
          </div>
        )}
      </main>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* MODALS & DIALOGS                                               */}
      {/* ─────────────────────────────────────────────────────────────── */}

      {/* Swap Confirmation Modal */}
      {selectedVehicle && (
        <SwapConfirmationModal
          isOpen={showSwapConfirmModal}
          onClose={() => {
            if (!swapMutation.isPending) {
              setShowSwapConfirmModal(false);
              setSelectedVehicle(null);
            }
          }}
          onConfirm={(swapData) => swapMutation.mutate(swapData)}
          currentVehicle={{
            make: vehicle?.make ?? "",
            model: vehicle?.model ?? "",
            regNo: vehicle?.regNo ?? "",
            image: vehicle?.images?.[0]?.file?.url ?? null,
          }}
          newVehicle={selectedVehicle}
          isLoading={swapMutation.isPending}
        />
      )}

      {/* Extension Modal — temporarily disabled */}
      {/* {showExtendModal && (
        <ExtendBookingModal
          open={showExtendModal}
          bookingPublicId={booking.publicId}
          currentEndAt={booking.endAt}
          role="employee"
          mode={useSessionFlow ? "pickup-session" : "standalone"}
          onClose={() => {
            setShowExtendModal(false);
            if (!extensionCompleted) setExtensionChosen(null);
          }}
          onSuccess={async (result?: ExtendBookingModalSuccessResult) => {
            setShowExtendModal(false);
            setExtensionCompleted(true);
            if (result?.usePaymentSession && result.extensionPublicId) {
              setPendingExtensionPublicId(result.extensionPublicId);
            }
            queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
            queryClient.invalidateQueries({ queryKey: ["extensions", booking.publicId] });
            if (pickupSession && !result?.usePaymentSession) {
              try {
                const refreshed = await paymentSessionService.getSession(pickupSession.publicId);
                if (refreshed) setPickupSession(refreshed);
              } catch {}
            }
          }}
        />
      )} */}

      {/* Confirm Handover Dialog (with pricing rules) */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Vehicle Handover</DialogTitle>
            <DialogDescription>
              Review the rental terms before completing the handover.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Vehicle Summary */}
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Car className="h-4 w-4 text-[#FF5F00]" />
                <span className="text-sm font-semibold text-gray-800">
                  {vehicle?.make} {vehicle?.model}
                </span>
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {vehicle?.regNo}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>
                  Start odometer:{" "}
                  <strong>{watch("odo") || "—"} km</strong>
                </span>
                <span>
                  Fuel:{" "}
                  <strong>
                    {FUEL_LEVEL_OPTIONS.find(
                      (o) => o.value === watch("fuelLevel"),
                    )?.label || "—"}
                  </strong>
                </span>
              </div>
            </div>

            {/* Pricing Rules */}
            {isLoadingPricing ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-[#FF5F00]" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Loading pricing rules…
                </span>
              </div>
            ) : pricingRules?.pricing ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide mb-2">
                  Rental Terms
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Free KM (24hr)</p>
                    <p className="font-semibold text-gray-800">
                      {pricingRules.pricing.freeKm24Hour} km
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Extra KM Rate</p>
                    <p className="font-semibold text-gray-800">
                      ₹{pricingRules.pricing.extraKmRate}/km
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Extra Hour Rate</p>
                    <p className="font-semibold text-gray-800">
                      ₹{pricingRules.pricing.extraHourRate}/hr
                    </p>
                  </div>
                  {pricingRules.frozenChargeConfig?.fuelModuleEnabled && (
                    <div>
                      <p className="text-muted-foreground">Fuel Tracking</p>
                      <p className="font-semibold text-green-700">Enabled</p>
                    </div>
                  )}
                  {pricingRules.frozenChargeConfig?.fastagModuleEnabled && (
                    <div>
                      <p className="text-muted-foreground">Fastag Charges</p>
                      <p className="font-semibold text-green-700">Enabled</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground text-center">
              This action cannot be undone. The booking will be marked as
              PICKED UP.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsConfirmOpen(false)}
              disabled={handoverMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-[#FF5F00] hover:bg-[#e65600]"
              onClick={handleSubmit(onConfirmHandoverLegacy)}
              disabled={handoverMutation.isPending}
            >
              {handoverMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Confirm Handover"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog */}
      {selectedDoc && (
        <Dialog
          open={!!selectedDoc}
          onOpenChange={(open) => !open && setSelectedDoc(null)}
        >
          <DialogContent className="max-w-3xl w-[95vw] p-0 overflow-hidden">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="text-lg font-semibold">
                {getDocumentTypeName(selectedDoc.type)}
              </DialogTitle>
              <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </DialogHeader>
            <div className="relative w-full max-h-[70vh] overflow-auto bg-muted">
              {isImageFile(selectedDoc.file.mime) ? (
                <img
                  src={selectedDoc.file.url}
                  alt={getDocumentTypeName(selectedDoc.type)}
                  className="w-full h-auto object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <FileText className="w-16 h-16 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    PDF Preview not available
                  </p>
                  <Button asChild variant="outline">
                    <a
                      href={selectedDoc.file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open PDF in new tab
                    </a>
                  </Button>
                </div>
              )}
            </div>
            <div className="p-4 pt-2 border-t bg-card">
              <p className="text-sm text-muted-foreground truncate">
                {selectedDoc.file.url.split("/").pop()?.split("?")[0] ||
                  "Document"}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
