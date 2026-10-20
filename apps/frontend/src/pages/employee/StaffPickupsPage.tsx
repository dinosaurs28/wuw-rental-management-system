import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { isAxiosError } from "axios";
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
  CalendarClock,
  Timer,
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
// Before the handover (CONFIRMED, no pickup session yet): move the booking or extend it (P4b / P4c)
import { ExtendBookingModal as UpcomingExtendModal } from "@/components/employee/extension/ExtendBookingModal";
import { RescheduleBookingSheet } from "@/components/booking/RescheduleBookingSheet";
import { SwapVehiclePickerField } from "@/components/swap/SwapVehiclePickerField";
import { SwapExcludedList } from "@/components/swap/SwapExcludedList";
import { SwapConfirmationModal } from "@/components/manager/vehicle-swap/SwapConfirmationModal";
import { SWAP_PICK_AGAIN_CODES, swapErrorCode } from "@/components/manager/vehicle-swap/swapFormat";

import apiClient from "@/lib/axios";
import { bookingService, type EmployeeBooking } from "@/services/booking.service";
import { kycService } from "@/services/kyc.service";
import { UploadKycDialog } from "@/components/booking/UploadKycDialog";
import { describeDlPhotoSides, FUEL_BAR_OPTIONS, fuelBarOptionLabel } from "@repo/schemas";
// import { extensionService } from "@/services/extension.service";
import { employeeVehicleSwapService } from "@/services/vehicleSwap.service";
import { paymentSessionService, type PaymentSession } from "@/services/paymentSession.service";
import type { DlStatus } from "@/services/dlStatus.service";
import { DlStatusPanel, DlStatusSelector } from "@/components/booking/DlStatus";
import { OperationNoteField, OperationNotesCard, OPERATION_NOTE_MAX, noteForRequest } from "@/components/employee/OperationNotes";
import { dlChoicePayload, dlStatusLabel, pickupDlChoiceError } from "@/lib/dlStatus";
import { formatRupees } from "@/lib/counterPayment";
import { fastagInr, readFastagBalance } from "@/components/employee/drop/fastag";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import {
  PickupImageCard,
  type UploadedImage,
} from "@/components/employee/PickupImageCard";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";
import { insertInCaptureOrder, nextCaptureAt, sortByCaptureOrder } from "@/lib/photoOrder";
import { CompletedOperationPage } from "@/components/employee/completed/CompletedOperation";
import {
  errorMessage,
  isMoneyInput,
  photoDiff,
  photosOf,
  sameMoney,
  useEditUploads,
  useSummary,
} from "@/components/employee/completed/completedEdit";
import { EditSaveBar, EditSavedCard, PendingAdjustmentCard } from "@/components/employee/completed/OperationEditFlow";
import { useEditSaveFlow } from "@/components/employee/completed/useEditSaveFlow";
import { PhotoEditor, type EditablePhoto } from "@/components/employee/completed/PhotoEditor";
import {
  completedOperationService,
  isCompletedForPhase,
  type EditPickupBody,
  type PickupSummary,
} from "@/services/completedOperation.service";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { PickupDiscountPanel, cleanDiscountInput, pickupDiscountInputError } from "@/components/payment/PickupDiscountPanel";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";
import { LegacyRemainingPaymentCard } from "@/components/payment/counter/LegacyRemainingPaymentCard";

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
// Bars "0".."10" — "0" is an empty tank (a real reading).
const FUEL_LEVEL_OPTIONS = FUEL_BAR_OPTIONS.map((value) => ({
  value,
  label: fuelBarOptionLabel(value),
}));

// Bars → the vehicle's fuel percent
const FUEL_LEVEL_TO_NUM: Record<string, number> = Object.fromEntries(
  FUEL_BAR_OPTIONS.map((value) => [value, Number(value) * 10])
);

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

// --- RENTAL TERMS (#21) ---
type PickupPricingRules = Awaited<ReturnType<typeof bookingService.getPickupPricingRules>>;

/**
 * This booking's free km and overage rates — what staff tell the customer at
 * handover. Uses the booking's plan-based allowance (the figures the drop bills
 * with), never the 24-hour rate-card value or a 0 placeholder.
 */
function RentalTermsBox({
  pricingRules,
  isLoading,
  hasFastag = false,
}: {
  pricingRules: PickupPricingRules | null | undefined;
  isLoading: boolean;
  /** The car has a FASTag — its usage is charged at the drop whatever the branch module. */
  hasFastag?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-[#FF5F00]" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading rental terms…
        </span>
      </div>
    );
  }
  if (!pricingRules?.pricing && !pricingRules?.kmAllowance) return null;

  const includedKm =
    pricingRules.pricing?.includedKm ?? pricingRules.kmAllowance?.includedKm ?? null;
  const extraKmEnabled =
    pricingRules.pricing?.extraKmEnabled ?? pricingRules.kmAllowance?.extraKmEnabled;
  const extraKmRate =
    pricingRules.pricing?.extraKmRate ?? pricingRules.kmAllowance?.extraKmRate ?? null;
  // The free km an extension added (#7), as the server split the allowance
  const freeKmOriginal = pricingRules.kmAllowance?.freeKmOriginal;
  const freeKmExtensions = pricingRules.kmAllowance?.freeKmExtensions ?? 0;
  const extensionCount = pricingRules.kmAllowance?.extensionCount ?? 1;

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
      <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide mb-2">
        Rental Terms
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {includedKm != null && (
          <div>
            <p className="text-muted-foreground">Free km (this booking)</p>
            <p className="font-semibold text-gray-800">
              {includedKm.toLocaleString("en-IN")} km
            </p>
            {freeKmOriginal != null && freeKmExtensions > 0 && (
              <p className="text-muted-foreground">
                {freeKmOriginal.toLocaleString("en-IN")} + {freeKmExtensions.toLocaleString("en-IN")} from{" "}
                {extensionCount > 1 ? "extensions" : "extension"}
              </p>
            )}
          </div>
        )}
        {(extraKmEnabled === false || extraKmRate != null) && (
          <div>
            <p className="text-muted-foreground">Extra km rate</p>
            <p className="font-semibold text-gray-800">
              {extraKmEnabled === false ? "Not charged" : `₹${extraKmRate}/km`}
            </p>
          </div>
        )}
        {pricingRules.pricing && (
          <div>
            <p className="text-muted-foreground">Extra hour rate</p>
            <p className="font-semibold text-gray-800">
              ₹{pricingRules.pricing.extraHourRate}/hr
            </p>
          </div>
        )}
        {pricingRules.frozenChargeConfig?.fuelModuleEnabled && (
          <div>
            <p className="text-muted-foreground">Fuel Tracking</p>
            <p className="font-semibold text-green-700">Enabled</p>
          </div>
        )}
        {(pricingRules.frozenChargeConfig?.fastagModuleEnabled || hasFastag) && (
          <div>
            <p className="text-muted-foreground">Fastag Charges</p>
            <p className="font-semibold text-green-700">Enabled</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- BOOKING FACTS ---
const formatBookingTime = (dateStr: string) =>
  new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Customer, vehicle and booked times — the top of the pickup page. */
function PickupBookingFacts({ booking }: { booking: EmployeeBooking }) {
  const vehicle = booking.items[0]?.vehicle;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
          Customer
        </p>
        <p className="font-semibold text-gray-900 flex items-center gap-1">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {booking.customer.user.name}
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
          {formatBookingTime(booking.startAt)}
        </p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
          End
        </p>
        <p className="font-medium text-gray-700 flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          {formatBookingTime(booking.endAt)}
        </p>
      </div>
    </div>
  );
}

// --- ORIGINAL LICENCE (#3) ---
// Server codes for a bad DL choice; shown under the selector rather than only as a toast.
const DL_ERROR_CODES = ["INVALID_DL_STATUS", "DL_STATUS_INVALID"];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function StaffPickupsPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Edit Pickup (client item 1): ?edit=1 on a completed pickup opens this workflow again
  const [searchParams] = useSearchParams();
  const editRequested = searchParams.get("edit") === "1";

  // --- STEP 0: Vehicle Available ---
  const [pickupViewerIndex, setPickupViewerIndex] = useState<number | null>(null);
  const [vehicleAvailable, setVehicleAvailable] = useState<boolean | null>(null);
  const [swapCompleted, setSwapCompleted] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<AvailableVehicle | null>(null);
  const [showSwapConfirmModal, setShowSwapConfirmModal] = useState(false);

  // --- STEP 1: Extension --- (temporarily disabled)
  // const [extensionChosen, setExtensionChosen] = useState<boolean | null>(null);
  // const [extensionCompleted, setExtensionCompleted] = useState(false);
  // const [showExtendModal, setShowExtendModal] = useState(false);
  // const [pendingExtensionPublicId, setPendingExtensionPublicId] = useState<string | null>(null);

  // --- Before the handover: reschedule (P4c) / extend a confirmed booking (P4b) ---
  const [showReschedule, setShowReschedule] = useState(false);
  const [showUpcomingExtend, setShowUpcomingExtend] = useState(false);

  // --- STEP 2: Payment ---
  // Session-based pickup: set when InitiatePickupSession succeeds or restored on mount
  const [pickupSession, setPickupSession] = useState<PaymentSession | null>(null);

  // --- STEP 6: Safety Deposit (managed after session is initiated) ---
  // safetyDepositAmount / safetyDepositReason / requestSafetyDeposit already declared below

  // --- STEP 7: Discount ---
  const [discountInput, setDiscountInput] = useState("");
  const [pendingDiscountCode, setPendingDiscountCode] = useState<string | null>(null);
  /** Last counter-coupon refusal (server message), shown under the coupon field. */
  const [couponError, setCouponError] = useState<string | null>(null);
  // Manual pickup discount: staged before the session (sent with the initiate), and
  // the last server refusal
  const [pendingManualDiscount, setPendingManualDiscount] = useState<{ amount: number; reason: string | null } | null>(null);
  const [manualDiscountError, setManualDiscountError] = useState<string | null>(null);

  // --- STEP 3: DL photos (required, Oct 17 2026); the DL number is no longer asked ---
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [showDlPhotoUpload, setShowDlPhotoUpload] = useState(false);
  const [kycViewerIndex, setKycViewerIndex] = useState<number | null>(null);
  const [brokenKycImages, setBrokenKycImages] = useState<Set<string>>(new Set());

  // --- STEP 4: Inspection ---
  const [requestSafetyDeposit, setRequestSafetyDeposit] = useState(false);
  // ₹ balance on the car's FASTag — required when the car has one (the drop bills the usage)
  const [fastagBalance, setFastagBalance] = useState("");
  const [safetyDepositAmount, setSafetyDepositAmount] = useState<string>("");
  const [safetyDepositReason, setSafetyDepositReason] = useState<string>("");

  // --- STEP 5: Photos ---
  // In the order picked (capturedAt), whatever order the uploads finish in
  const [uploadedImages, setUploadedImages] = useState<(UploadedImage & { capturedAt?: number })[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  // capturedAt: when the slot's photo was picked — the photos are saved and shown in that order
  const [captureSlots, setCaptureSlots] = useState<Record<string, (UploadedImage & { capturedAt?: number }) | null>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);

  // --- ORIGINAL LICENCE (#3): optional choice (X1), nothing pre-selected ---
  const [dlStatus, setDlStatus] = useState<DlStatus>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  // --- CONFIRM DIALOG ---
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // --- PICKUP NOTE (optional, Oct 20 2026) ---
  const [pickupNote, setPickupNote] = useState("");
  const pickupNoteTooLong = pickupNote.trim().length > OPERATION_NOTE_MAX;

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
    // Document links are presigned for 15 minutes — keep them fresh while the
    // pickup stays open.
    refetchInterval: 12 * 60_000,
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
  // Captured angle photos in config order, for the multi-photo viewer
  // In the order the photos were taken (#1, #2… — the numbers the drop compares by)
  const filledCaptureSlots = sortByCaptureOrder(
    (captureConfig?.fields ?? []).flatMap((f) => {
      const slot = captureSlots[f.name];
      return slot ? [{ url: slot.url, label: f.name, fileId: slot.fileId, capturedAt: slot.capturedAt }] : [];
    }),
  );

  // Available vehicles for swap (only when vehicleAvailable === false), plus
  // the same-type cars that can't take the booking, with the reason
  const {
    data: swapCandidates,
    isLoading: isLoadingVehicles,
    refetch: refetchVehicles,
  } = useQuery({
    queryKey: ["employee-swap-vehicles", bookingId],
    queryFn: () =>
      bookingId
        ? employeeVehicleSwapService.getSwapCandidates(bookingId)
        : Promise.resolve({ vehicles: [], excluded: [], swapContext: null }),
    enabled: vehicleAvailable === false,
  });
  const availableVehicles = swapCandidates?.vehicles;

  // Rental terms — shown on the inspection step (and the legacy confirm dialog),
  // so staff always see this booking's free km and ₹/km at handover (#21)
  const { data: pricingRules, isLoading: isLoadingPricing } = useQuery({
    queryKey: ["pickup-pricing-rules", bookingId],
    queryFn: () =>
      bookingId ? bookingService.getPickupPricingRules(bookingId) : null,
    enabled: !!bookingId,
    retry: false,
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

  // A pickup session reopened later: the FASTag balance it saved
  useEffect(() => {
    const saved = booking?.pickupFastagBalance;
    if (saved != null) setFastagBalance((cur) => cur || String(Number(saved)));
  }, [booking?.pickupFastagBalance]);

  // A pickup session reopened later: the note it saved
  useEffect(() => {
    const saved = booking?.operationNotes?.pickup?.note;
    if (saved) setPickupNote((cur) => cur || saved);
  }, [booking?.operationNotes?.pickup?.note]);

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
      dlStatus?: NonNullable<DlStatus>;
    }) => bookingService.approvePickup(bookingId!, data),
    onSuccess: (response: any) => {
      toast.success(response?.message || "Vehicle Handover Confirmed!");
      setIsConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      navigate("/employee/dashboard");
    },
    onError: (error: any) => {
      if (DL_ERROR_CODES.includes(error.response?.data?.code)) {
        setDlError(error.response.data.message);
      }
      toast.error(error.response?.data?.message || "Failed to confirm handover");
      setIsConfirmOpen(false);
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: ({ file }: { file: File; capturedAt: number }) => {
      const formData = new FormData();
      formData.append("file", file);
      return bookingService.uploadPickupImage(formData);
    },
    onSuccess: (data, { capturedAt }) => {
      setUploadedImages((prev) => insertInCaptureOrder(prev, { ...data, capturedAt }));
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
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      setTimeout(() => {
        document.getElementById("pickup-payment-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (error?.response?.data?.pickupDiscountRejected) {
        // The staged discount didn't fit the bill — nothing was saved; fix it and start again
        setPendingManualDiscount(null);
        setManualDiscountError(error.response.data.message || "This discount can't be given.");
        toast.error(error.response.data.message || "This discount can't be given.");
      } else if (error?.response?.data?.couponRejected) {
        // The saved counter coupon failed its full check — nothing was saved.
        // Drop it so staff can fix the code or start the payment without it.
        setPendingDiscountCode(null);
        setDiscountInput("");
        setCouponError(error.response.data.message || "This coupon can't be used for this booking.");
        toast.error(error.response.data.message || "This coupon can't be used for this booking.");
      } else if (DL_ERROR_CODES.includes(error?.response?.data?.code)) {
        const message = error.response.data.message;
        setDlError(message);
        toast.error(message);
      } else if (status === 409) {
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
      setCouponError(null);
      toast.success("Discount applied");
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || "Invalid discount code";
      setCouponError(message);
      toast.error(message);
    },
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

  // Manual pickup discount on the open bill (Unified Payments)
  const setManualDiscountMutation = useMutation({
    mutationFn: (payload: { amount: number; reason: string | null }) =>
      paymentSessionService.setPickupSessionDiscount(bookingId!, payload),
    onSuccess: (session) => {
      setPickupSession(session);
      setManualDiscountError(null);
      toast.success("Discount applied");
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || "Could not apply the discount";
      setManualDiscountError(message);
      toast.error(message);
    },
  });

  const removeManualDiscountMutation = useMutation({
    mutationFn: () => paymentSessionService.removePickupSessionDiscount(bookingId!),
    onSuccess: (session) => {
      setPickupSession(session);
      setManualDiscountError(null);
      toast.success("Discount removed");
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || "Failed to remove discount"),
  });

  // Legacy branches: the discount comes off the remaining balance before it is collected
  const legacyDiscountMutation = useMutation({
    mutationFn: (payload: { amount: number; reason: string | null } | null) =>
      payload
        ? paymentSessionService.setLegacyPickupDiscount(bookingId!, payload)
        : paymentSessionService.removeLegacyPickupDiscount(bookingId!),
    onSuccess: (_, payload) => {
      setManualDiscountError(null);
      toast.success(payload ? "Discount applied" : "Discount removed");
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || "Could not change the discount";
      setManualDiscountError(message);
      toast.error(message);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
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
      // The rental terms follow the car on the booking
      queryClient.invalidateQueries({ queryKey: ["pickup-pricing-rules", bookingId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to swap vehicle");
      if (SWAP_PICK_AGAIN_CODES.has(swapErrorCode(error) ?? "")) {
        // The car was taken meanwhile (booked, another swap, a checkout) — reload the list and pick again
        setShowSwapConfirmModal(false);
        setSelectedVehicle(null);
        void refetchVehicles();
      }
    },
  });

  // --- DERIVED STATE ---
  // Both driving licence photos are required to book (Oct 17 2026); an older
  // booking may have none — staff capture them here before the handover. An
  // older server (no dlPhotos field) doesn't block.
  const kycDocs = kycData?.kyc || [];
  const dlPhotos = kycData?.dlPhotos ?? null;
  const dlPhotosReady = !dlPhotos || dlPhotos.ok;
  const kycDocLabel = (doc: any) => {
    const side = doc.side === "FRONT" ? "Front" : doc.side === "BACK" ? "Back" : null;
    const type = getDocumentTypeName(doc.type);
    return side ? `${type} - ${side}` : type;
  };
  // Image documents only, in list order, for the zoom viewer
  const kycImageDocs = kycDocs.filter((d: any) => isImageFile(d.file.mime));
  const kycLightboxItems = kycImageDocs.map((d: any) => ({
    url: d.file.url as string,
    label: kycDocLabel(d),
    mime: d.file.mime as string,
  }));
  const isPickedUp = booking?.status === "PICKED_UP";
  // useSessionFlow is true whenever the branch has usePaymentSessions enabled —
  // regardless of whether this is an advance-payment booking. Extension-only and
  // deposit-only pickups also use the session flow.
  const useSessionFlow = booking?.usePaymentSessions === true;
  // Legacy branches: an advance booking's balance is settled at the counter before handover
  const legacyRemainingDue =
    !useSessionFlow &&
    booking?.isAdvancePayment === true &&
    !booking.remainingPaidAt &&
    (parseFloat(booking.remainingBalance ?? "0") || 0) > 0;

  // Restore active session on page reload (must be after useSessionFlow is declared)
  useEffect(() => {
    if (!bookingId || !useSessionFlow || pickupSession) return;
    paymentSessionService.getActivePickupSession(bookingId).then((session) => {
      if (session) setPickupSession(session);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, useSessionFlow]);

  // A pickup session past OPEN already saved this car's handover readings, so
  // the car is settled: step 0 is answered and locked (the server also refuses
  // a pre-pickup swap then — PICKUP_IN_PROGRESS).
  const pickupStarted = !!pickupSession && pickupSession.status !== "OPEN";
  const canProceedFromStep0 = vehicleAvailable === true || swapCompleted || pickupStarted;
  // Extension step disabled — step 1 passes through automatically
  const canProceedFromStep1 = canProceedFromStep0;
  const canProceedFromStep2 = canProceedFromStep1;
  // FASTag balance: asked for every car — required when it's marked as having a
  // FASTag, optional (checked only when typed) otherwise
  const hasFastag = !!booking?.items?.[0]?.vehicle?.hasFastag;
  const fastag = readFastagBalance(fastagBalance);
  const fastagReady = hasFastag ? fastag.value != null : fastagBalance.trim() === "" || fastag.value != null;
  const isHandoverReady =
    canProceedFromStep2 &&
    dlPhotosReady &&
    (watch("odo") ?? 0) > 0 &&
    watch("fuelLevel") !== "" &&
    fastagReady;
  // The DL status may be left unset (X1); only Collected / Not collected can be chosen.
  const dlChoiceReady = pickupDlChoiceError(dlStatus) === null;

  // Manual pickup discount: the bill's (session), staged for the initiate, or the
  // legacy one already off the remaining balance
  const remainingUnpaid =
    booking?.isAdvancePayment && !booking.remainingPaidAt ? parseFloat(booking.remainingBalance ?? "0") || 0 : 0;
  const manualDiscountView = !booking ? null : useSessionFlow ? (
    pickupSession ? (
      <PickupDiscountPanel
        applied={pickupSession.pickupDiscount
          ? { amount: Number(pickupSession.pickupDiscount.amount), reason: pickupSession.pickupDiscount.reason }
          : null}
        max={pickupSession.pickupDiscountMax != null ? Number(pickupSession.pickupDiscountMax) : null}
        finalPayable={Number(pickupSession.netPayable)}
        busy={setManualDiscountMutation.isPending || removeManualDiscountMutation.isPending}
        applying={setManualDiscountMutation.isPending}
        removing={removeManualDiscountMutation.isPending}
        error={manualDiscountError}
        disabled={pickupSession.status !== "AWAITING_PAYMENT" && pickupSession.status !== "OPEN"}
        onApply={(amount, reason) => setManualDiscountMutation.mutateAsync({ amount, reason })}
        onRemove={() => removeManualDiscountMutation.mutate()}
      />
    ) : (
      <PickupDiscountPanel
        applied={pendingManualDiscount}
        max={remainingUnpaid}
        finalPayable={remainingUnpaid - (pendingManualDiscount?.amount ?? 0)}
        note="Checked and added to the bill when you start the payment."
        error={manualDiscountError}
        onApply={(amount, reason) => {
          setManualDiscountError(null);
          setPendingManualDiscount({ amount, reason });
        }}
        onRemove={() => setPendingManualDiscount(null)}
      />
    )
  ) : booking.isAdvancePayment && !booking.remainingPaidAt && (remainingUnpaid > 0 || booking.pickupDiscount) ? (
    <PickupDiscountPanel
      applied={booking.pickupDiscount
        ? { amount: Number(booking.pickupDiscount.amount), reason: booking.pickupDiscount.reason }
        : null}
      max={remainingUnpaid + Number(booking.pickupDiscount?.amount ?? 0)}
      finalPayable={remainingUnpaid}
      busy={legacyDiscountMutation.isPending}
      applying={legacyDiscountMutation.isPending && legacyDiscountMutation.variables != null}
      removing={legacyDiscountMutation.isPending && legacyDiscountMutation.variables == null}
      error={manualDiscountError}
      onApply={(amount, reason) => legacyDiscountMutation.mutateAsync({ amount, reason })}
      onRemove={() => legacyDiscountMutation.mutate(null)}
    />
  ) : (
    <p className="text-xs text-muted-foreground">No rent is payable at this pickup, so there is nothing to discount.</p>
  );

  // --- HANDLERS ---
  const handleFileSelect = async (file: File) => {
    // Stamped when picked, before the upload starts: the photo keeps that place
    const capturedAt = nextCaptureAt();
    setUploadError(null);
    setIsUploading(true);
    try {
      const processedFile = await compressImage(file);
      await uploadImageMutation.mutateAsync({ file: processedFile, capturedAt });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDlStatusChange = (value: NonNullable<DlStatus>) => {
    setDlStatus(value);
    setDlError(null);
  };

  /** Leave the DL status unrecorded (X1) — it can be set later from the booking. */
  const handleDlStatusClear = () => {
    setDlStatus(null);
    setDlError(null);
  };

  /** Guards the chosen DL status — the status itself is optional (X1). */
  const checkDlChoice = (): boolean => {
    const problem = pickupDlChoiceError(dlStatus);
    setDlError(problem);
    return problem === null;
  };

  const handleDeleteImage = (fileId: string) => {
    setDeletingImageId(fileId);
    deleteImageMutation.mutate(fileId);
  };

  const handleCaptureSlotUpload = async (fieldName: string, file: File) => {
    setUploadingSlot(fieldName);
    const capturedAt = nextCaptureAt();
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const data = await bookingService.uploadPickupImage(formData);
      setCaptureSlots((prev) => ({ ...prev, [fieldName]: { ...data, capturedAt } }));
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
    } catch (error: any) {
      // 409 FILE_IN_USE: already saved with the pickup session — kept on purpose
      toast.error(error?.response?.data?.message || `Failed to remove photo for ${fieldName}`);
    }
  };

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
      // FASTag balance at the handover — when entered (required for a car with a FASTag)
      pickupFastagBalance: fastag.value != null ? fastag.value : undefined,
      requireManagerConfirmation: data.requireManagerConfirmation,
      payRemainingAtPickup: true,
      safetyDepositRequest: safetyDepositPayload,
      // dlStatus only when chosen (optional, X1);
      // the deprecated licenseCollected is no longer sent.
      ...(dlStatus ? dlChoicePayload(dlStatus) : {}),
      // Optional Fleet note (blank = none)
      pickupNote: noteForRequest(pickupNote),
    };

    if (captureConfig) {
      // In the order the photos were taken (the server saves them as sent)
      const captureImages = filledCaptureSlots.map((slot) => ({ fileId: slot.fileId, label: slot.label }));
      return {
        ...base,
        captureImages: captureImages.length > 0 ? captureImages : undefined,
        photoOrder: captureImages.length > 0 ? captureImages.map((c) => c.fileId) : undefined,
      };
    } else {
      // In the order the photos were picked (the server saves them as sent)
      const imageIds = uploadedImages.map((img) => img.fileId);
      return {
        ...base,
        pickupImageIds: imageIds.length > 0 ? imageIds : undefined,
        photoOrder: imageIds.length > 0 ? imageIds : undefined,
      };
    }
  };

  const onConfirmHandover = (data: HandoverFormValues) => {
    // const chargeConfig = booking?.frozenChargeConfig;

    if (!checkDlChoice()) return;
    if (pickupNoteTooLong) {
      toast.error(`Keep the pickup note under ${OPERATION_NOTE_MAX} characters.`);
      return;
    }
    if (!fastagReady) {
      toast.error(fastag.error ?? "Enter the FASTag balance.");
      return;
    }

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
        pickupFastagBalance: payload.pickupFastagBalance,
        pickupImageIds: (payload as any).pickupImageIds,
        captureImages: (payload as any).captureImages,
        photoOrder: (payload as any).photoOrder,
        safetyDepositAmount: requestSafetyDeposit && safetyDepositAmount
          ? parseFloat(safetyDepositAmount)
          : undefined,
        safetyDepositReason: requestSafetyDeposit && safetyDepositReason
          ? safetyDepositReason
          : undefined,
        // extensionPublicId: pendingExtensionPublicId ?? undefined, // extension disabled
        discountCode: pendingDiscountCode ?? undefined,
        pickupDiscount: pendingManualDiscount ?? undefined,
        dlStatus: payload.dlStatus,
        pickupNote: payload.pickupNote,
      });
    } else {
      setIsConfirmOpen(true);
    }
  };

  const onConfirmHandoverLegacy = (data: HandoverFormValues) => {
    if (!checkDlChoice()) return;
    if (pickupNoteTooLong) {
      toast.error(`Keep the pickup note under ${OPERATION_NOTE_MAX} characters.`);
      return;
    }
    if (!fastagReady) {
      toast.error(fastag.error ?? "Enter the FASTag balance.");
      return;
    }
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

  // Done (handed over, returned, or sent to a manager): the read-only summary,
  // never the workflow — changes go through Edit Pickup (client item 1), this
  // page again with ?edit=1.
  if (isCompletedForPhase("PICKUP", booking)) {
    return editRequested ? (
      <PickupEditMode booking={booking} pricingRules={pricingRules} isLoadingPricing={isLoadingPricing} />
    ) : (
      <CompletedOperationPage phase="PICKUP" bookingId={booking.publicId} />
    );
  }

  const vehicle = booking.items[0]?.vehicle;

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
            <PickupBookingFacts booking={booking} />
            {/* The customer asked for another time or more hours: move / extend before the handover */}
            {booking.status === "CONFIRMED" && !pickupSession && (
              <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowReschedule(true)}
                >
                  <CalendarClock className="h-4 w-4" />
                  Reschedule
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowUpcomingExtend(true)}
                >
                  <Timer className="h-4 w-4" />
                  Extend
                </Button>
                <p className="text-xs text-muted-foreground">
                  Move the pickup (same length and price) or add hours before the handover.
                </p>
              </div>
            )}
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

        {/* DL status recorded at pickup — Fleet can still correct it while on trip */}
        {isPickedUp && (
          <DlStatusPanel
            role="employee"
            publicId={booking.publicId}
            bookingStatus={booking.status}
            dlStatus={booking.dlStatus}
            dlDepositNote={booking.dlDepositNote}
            dlStatusUpdatedAt={booking.dlStatusUpdatedAt}
          />
        )}
        {isPickedUp && <OperationNotesCard notes={booking.operationNotes} show={["pickup", "swaps"]} />}

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 0: VEHICLE AVAILABLE?                                  */}
        {/* ─────────────────────────────────────────────────────────── */}
        <StepCard
          stepNum={1}
          title="Is the vehicle available and ready?"
          subtitle="Confirm the vehicle is on-site and in good condition"
          isCompleted={canProceedFromStep0}
          isLocked={isPickedUp || pickupStarted}
        >
          <CardContent className="pt-4 space-y-4">
            <YesNoToggle
              value={pickupStarted && vehicleAvailable === null ? true : vehicleAvailable}
              onChange={(v) => {
                setVehicleAvailable(v);
                if (v && swapCompleted) {
                  // They previously swapped but now say yes — allow
                }
              }}
              disabled={isPickedUp || swapCompleted || pickupStarted}
            />

            {pickupStarted && !isPickedUp && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-blue-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p className="text-sm">
                  The pickup payment has been started with this vehicle, so it can't be
                  swapped now. Complete the pickup, then swap it from the drop screen if
                  needed.
                </p>
              </div>
            )}

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
            {vehicleAvailable === false && !swapCompleted && !pickupStarted && (
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
                      <SwapVehiclePickerField
                        vehicles={availableVehicles}
                        onSelectVehicle={(v) => {
                          setSelectedVehicle(v);
                          setShowSwapConfirmModal(true);
                        }}
                        selectedVehicleId={selectedVehicle?.id}
                      />
                      <SwapExcludedList excluded={swapCandidates?.excluded ?? []} className="mt-3" />
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
                    <SwapExcludedList
                      excluded={swapCandidates?.excluded ?? []}
                      className="mt-3 bg-white text-left"
                    />
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

        {/* STEP 3: LICENCE PHOTOS (required) + OTHER KYC */}
        <StepCard
          stepNum={3}
          title="Driving Licence & KYC"
          subtitle="Licence photos (front + back) required"
          isCompleted={dlPhotosReady}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-gray-900 mb-3">
              KYC documents{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (driving licence front + back required · Aadhaar optional)
              </span>
            </p>
            {dlPhotos && !dlPhotos.ok && (
              <div
                id="pickup-dl-photos"
                role="alert"
                className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border-2 border-orange-200 bg-orange-50 p-3"
              >
                <AlertCircle className="h-5 w-5 shrink-0 text-orange-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-orange-900">Driving licence photos required</p>
                  <p className="text-xs text-orange-800 mt-0.5">
                    Capture the {describeDlPhotoSides(dlPhotos.missingSides)} of the customer's licence before the handover
                    {dlPhotos.rejectedSides.length > 0
                      ? ` (the ${describeDlPhotoSides(dlPhotos.rejectedSides)} was rejected)`
                      : ""}
                    .
                  </p>
                </div>
                {kycData?.customerUserPublicId && !isPickedUp && (
                  <Button
                    size="sm"
                    className="bg-orange-600 hover:bg-orange-700 shrink-0"
                    onClick={() => setShowDlPhotoUpload(true)}
                  >
                    Capture licence
                  </Button>
                )}
              </div>
            )}
            {kycDocs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No documents uploaded.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {kycDocs.map((doc) => {
                  const isImage = isImageFile(doc.file.mime);
                  const imageIdx = kycImageDocs.findIndex(
                    (d: any) => d.publicId === doc.publicId,
                  );
                  // Keyed by link, so a refreshed (re-presigned) link gets another try
                  const imageBroken = brokenKycImages.has(doc.file.url);
                  const sideLabel =
                    doc.side === "FRONT" ? "Front" : doc.side === "BACK" ? "Back" : null;

                  return (
                    <div
                      key={doc.publicId}
                      className="group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:shadow-md transition-all"
                    >
                      <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                        {isImage && imageBroken ? (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ImageIcon className="w-10 h-10 opacity-50" />
                            <span className="text-xs font-medium">Preview unavailable</span>
                          </div>
                        ) : isImage ? (
                          <button
                            type="button"
                            className="w-full h-full"
                            aria-label={`View ${kycDocLabel(doc)}`}
                            onClick={() => setKycViewerIndex(imageIdx)}
                          >
                            <img
                              src={doc.file.url}
                              alt={kycDocLabel(doc)}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={() =>
                                setBrokenKycImages((prev) => new Set(prev).add(doc.file.url))
                              }
                            />
                          </button>
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
                        {!(isImage && !imageBroken) && (
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
                        )}
                      </div>

                      <div className="p-3 bg-white flex flex-col gap-3">
                        <div>
                          <p className="font-medium text-sm truncate">
                            {getDocumentTypeName(doc.type)}
                          </p>
                          {sideLabel && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {sideLabel}
                            </p>
                          )}
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
            watch("fuelLevel") !== "" &&
            fastagReady
          }
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4">
            {/* This booking's free km / extra km rate — tell the customer at handover (#21) */}
            <div className="mb-5">
              <RentalTermsBox pricingRules={pricingRules} isLoading={isLoadingPricing} hasFastag={hasFastag} />
            </div>
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
                      value={field.value ?? ""}
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

              {/* FASTag balance — every car; required when it's marked as having a FASTag.
                  The drop bills what the tag is used for. */}
              <div className="space-y-2">
                <Label htmlFor="fastagBalance" className="text-sm font-medium">
                  FASTag balance (₹){" "}
                  {hasFastag ? (
                    <span className="text-red-500">*</span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">optional</span>
                  )}
                </Label>
                <Input
                  id="fastagBalance"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 480"
                  className="h-12"
                  disabled={isPickedUp}
                  value={fastagBalance}
                  onChange={(e) => setFastagBalance(e.target.value)}
                />
                {fastagBalance.trim() !== "" && fastag.error ? (
                  <p className="text-xs text-red-500">{fastag.error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {hasFastag
                      ? "Read the balance on the car's FASTag. The usage until the drop is charged on the drop bill (no GST)."
                      : "Leave empty if this car has no FASTag. If it has one, the usage until the drop is charged on the drop bill (no GST)."}
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
                          <button
                            type="button"
                            onClick={() =>
                              setPickupViewerIndex(
                                filledCaptureSlots.findIndex((s) => s.label === field.name),
                              )
                            }
                            aria-label={`Zoom ${field.name} photo`}
                            className="relative block w-full cursor-zoom-in"
                          >
                            <img
                              src={slot.url}
                              alt={field.name}
                              className="w-full h-28 object-cover"
                            />
                            <span className="absolute top-1 left-1 min-w-5 h-5 px-1 rounded-full bg-black/65 text-white text-[11px] font-semibold flex items-center justify-center">
                              {filledCaptureSlots.findIndex((s) => s.label === field.name) + 1}
                            </span>
                            <ZoomBadge />
                          </button>
                          {!isPickedUp && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCaptureSlotDelete(field.name, slot.fileId);
                              }}
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
                              capture="environment"
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
                <PhotoLightbox
                  open={pickupViewerIndex !== null}
                  onOpenChange={(o) => !o && setPickupViewerIndex(null)}
                  items={filledCaptureSlots}
                  startIndex={pickupViewerIndex ?? 0}
                  title="Pickup Photos"
                />
              </div>
            ) : (
              <>
                {!isPickedUp && (
                  <DocumentUploadZone
                    onFileSelect={handleFileSelect}
                    isUploading={isUploading}
                    disabled={isPickedUp}
                    error={uploadError}
                    capture="environment"
                  />
                )}
                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    {uploadedImages.map((image, imgIdx) => (
                      <PickupImageCard
                        key={image.fileId}
                        image={image}
                        onOpen={() => setPickupViewerIndex(imgIdx)}
                        onDelete={handleDeleteImage}
                        isDeleting={deletingImageId === image.fileId}
                      />
                    ))}
                  </div>
                )}
                <PhotoLightbox
                  open={pickupViewerIndex !== null}
                  onOpenChange={(o) => !o && setPickupViewerIndex(null)}
                  items={uploadedImages.map((im, i) => ({ url: im.url, label: `Pickup photo ${i + 1}` }))}
                  startIndex={pickupViewerIndex ?? 0}
                  title="Pickup Photos"
                />
              </>
            )}
          </CardContent>
        </StepCard>

        {/* ─────────────────────────────────────────────────────────── */}
        {/* STEP 6: SAFETY DEPOSIT                                      */}
        {/* ─────────────────────────────────────────────────────────── */}
        <StepCard
          stepNum={6}
          title="Discount & Safety Deposit"
          subtitle="Optional — a flat ₹ discount on the rent, then a refundable deposit before handover"
          isCompleted={requestSafetyDeposit === false || (requestSafetyDeposit && !!safetyDepositAmount && !!safetyDepositReason)}
          isLocked={!canProceedFromStep2 || isPickedUp}
        >
          <CardContent className="pt-4 space-y-4">
            {/* Manual discount — off the rent payable at pickup, before the safety deposit */}
            <div className="space-y-2 border-b pb-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Tag className="h-4 w-4 text-[#FF5F00]" />
                Discount
              </div>
              {manualDiscountView}
            </div>

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
            {!useSessionFlow ? (
              // Legacy pickup has no payment session to carry a coupon line
              <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">
                <Tag className="h-4 w-4 mt-0.5 shrink-0 text-neutral-400" />
                <span>
                  Counter coupons need Unified Payments. This branch uses the standard pickup, so a
                  coupon can't be applied here.
                </span>
              </div>
            ) : pickupSession ? (
              // Session is open — apply/remove discount live
              (() => {
                const discountEntry = pickupSession.entries.find(
                  (e) => e.classification === "DISCOUNT" && !e.isVoided && e.referenceType !== "PICKUP_DISCOUNT",
                );
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
                        onChange={(e) => {
                          setDiscountInput(e.target.value.toUpperCase());
                          setCouponError(null);
                        }}
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
                        setCouponError(null);
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
                    <span>Coupon <strong>{pendingDiscountCode}</strong> will be checked and applied when you start the payment</span>
                  </div>
                )}
                {!pendingDiscountCode && (
                  <p className="text-xs text-muted-foreground">
                    The coupon is fully checked when you proceed to payment. If it can't be used, it is
                    removed and the reason is shown here.
                  </p>
                )}
              </div>
            )}
            {useSessionFlow && couponError && (
              <p className="text-xs text-red-600">{couponError}</p>
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
                      {pendingManualDiscount && (
                        <div className="flex items-center justify-between px-4 py-2.5 text-green-700">
                          <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Discount</span>
                          <span className="font-medium">−{formatPrice(pendingManualDiscount.amount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                        <span className="font-semibold text-sm">Estimated total</span>
                        <span className="font-bold text-base">
                          {formatPrice(
                            (parseFloat(booking.remainingBalance ?? "0") || 0) -
                            (pendingManualDiscount?.amount ?? 0) +
                            // extension charge removed (feature disabled)
                            (requestSafetyDeposit ? parseFloat(safetyDepositAmount || "0") || 0 : 0),
                          )}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground text-center">
                      GST and discounts will be computed on the next step
                    </p>

                    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                      <DlStatusSelector
                        id="dl-status-session"
                        value={dlStatus}
                        onValueChange={handleDlStatusChange}
                        error={dlError}
                        disabled={initiatePickupSessionMutation.isPending}
                        optional
                        onClear={handleDlStatusClear}
                      />
                    </div>

                    <OperationNoteField
                      id="pickup-note-session"
                      label="Pickup note"
                      value={pickupNote}
                      onChange={setPickupNote}
                      disabled={initiatePickupSessionMutation.isPending}
                    />

                    <Button
                      type="button"
                      className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-12 text-sm font-semibold rounded-xl"
                      disabled={
                        !isHandoverReady ||
                        !dlChoiceReady ||
                        initiatePickupSessionMutation.isPending
                      }
                      onClick={handleSubmit(onConfirmHandover)}
                    >
                      {initiatePickupSessionMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Computing charges…</>
                      ) : (
                        "Confirm & Proceed to Payment →"
                      )}
                    </Button>
                    {!isHandoverReady ? (
                      <p className="text-xs text-center text-muted-foreground">
                        {!dlPhotosReady
                          ? "Capture both driving licence photos (step 3) to proceed"
                          : "Complete all steps above to proceed"}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* DL choice sent with the session; correctable until the payment completes */}
                    <DlStatusPanel
                      role="employee"
                      publicId={booking.publicId}
                      bookingStatus={booking.status}
                      dlStatus={dlStatus ?? booking.dlStatus}
                      dlDepositNote={dlStatus ? null : booking.dlDepositNote}
                      onUpdated={(result) => {
                        setDlStatus(result.dlStatus);
                      }}
                    />
                    <LedgerSummaryCard
                      session={pickupSession}
                      onRemoveDiscount={(entry) =>
                        entry.referenceType === "PICKUP_DISCOUNT"
                          ? removeManualDiscountMutation.mutate()
                          : removeDiscountMutation.mutate()
                      }
                    />
                    <RecordPaymentPanel
                      session={pickupSession}
                      onSuccess={(updatedSession) => {
                        setPickupSession(updatedSession);
                        if (updatedSession.status === "COMPLETED") {
                          toast.success(
                            updatedSession.credit
                              ? `₹${updatedSession.credit.amount} put on credit (collateral: ${updatedSession.credit.collateral}). Booking marked as Picked Up.`
                              : "Payment collected! Booking marked as Picked Up.",
                          );
                          queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
                          navigate("/employee/dashboard");
                        }
                      }}
                      // Credit can't cover a safety deposit — offer to take it off the bill (#11)
                      onRemoveDeposit={() => removeDepositMutation.mutate()}
                      removingDeposit={removeDepositMutation.isPending}
                    />
                  </>
                )}
              </CardContent>
            </StepCard>
          </div>
        )}

        {!isPickedUp && !useSessionFlow && (
          <div className="pt-2 space-y-4">
            {/* Advance booking: the balance is settled at the counter before handover (#11) */}
            {legacyRemainingDue && (
              <LegacyRemainingPaymentCard
                bookingPublicId={booking.publicId}
                context="pickup"
                remainingBalance={booking.remainingBalance!}
                onSettled={() => queryClient.invalidateQueries({ queryKey: ["booking", bookingId] })}
              />
            )}
            {isHandoverReady && (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <DlStatusSelector
                  id="dl-status-legacy"
                  value={dlStatus}
                  onValueChange={handleDlStatusChange}
                  error={dlError}
                  disabled={handoverMutation.isPending}
                  optional
                  onClear={handleDlStatusClear}
                />
              </div>
            )}
            {isHandoverReady && (
              <OperationNoteField
                id="pickup-note-legacy"
                label="Pickup note"
                value={pickupNote}
                onChange={setPickupNote}
                disabled={handoverMutation.isPending}
              />
            )}
            <Button
              type="button"
              className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-14 text-base font-semibold rounded-xl shadow-md"
              disabled={!isHandoverReady || !dlChoiceReady || legacyRemainingDue || handoverMutation.isPending}
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
            {!isHandoverReady ? (
              <p className="text-xs text-center text-muted-foreground">
                {!dlPhotosReady
                  ? "Capture both driving licence photos (step 3) to enable handover"
                  : "Complete all steps above to enable handover"}
              </p>
            ) : legacyRemainingDue ? (
              <p className="text-xs text-center text-muted-foreground">
                Settle the remaining balance above to enable handover
              </p>
            ) : null}
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

      {/* Reschedule a confirmed booking (P4c) — same length and price, new pickup + return */}
      <RescheduleBookingSheet
        open={showReschedule}
        onOpenChange={setShowReschedule}
        bookingPublicId={booking.publicId}
        role="employee"
        onRescheduled={() => {
          queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
          queryClient.invalidateQueries({ queryKey: ["pickup-pricing-rules", bookingId] });
        }}
      />

      {/* Extend a confirmed booking before the handover (P4b): priced, collected and confirmed in the modal */}
      {showUpcomingExtend && (
        <UpcomingExtendModal
          open={showUpcomingExtend}
          bookingPublicId={booking.publicId}
          currentEndAt={booking.endAt}
          role="employee"
          mode="standalone"
          onClose={() => setShowUpcomingExtend(false)}
          onSuccess={() => {
            setShowUpcomingExtend(false);
            queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
            queryClient.invalidateQueries({ queryKey: ["pickup-pricing-rules", bookingId] });
          }}
        />
      )}

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
                {(hasFastag || fastag.value != null) && (
                  <span>
                    FASTag balance:{" "}
                    <strong>{fastag.value != null ? fastagInr(fastag.value) : "—"}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Rental terms (also shown on the inspection step) */}
            <RentalTermsBox pricingRules={pricingRules} isLoading={isLoadingPricing} hasFastag={hasFastag} />

            <DlStatusSelector
              id="dl-status-confirm"
              value={dlStatus}
              onValueChange={handleDlStatusChange}
              error={dlError}
              disabled={handoverMutation.isPending}
              optional
              onClear={handleDlStatusClear}
            />

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
              disabled={!dlPhotosReady || !dlChoiceReady || handoverMutation.isPending}
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

      {kycData?.customerUserPublicId && (
        <UploadKycDialog
          open={showDlPhotoUpload}
          onOpenChange={setShowDlPhotoUpload}
          customerPublicId={kycData.customerUserPublicId}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["booking-kyc", bookingId] })}
        />
      )}

      <PhotoLightbox
        open={kycViewerIndex !== null}
        onOpenChange={(o) => !o && setKycViewerIndex(null)}
        items={kycLightboxItems}
        startIndex={kycViewerIndex ?? 0}
        title="KYC documents"
      />

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
                {kycDocLabel(selectedDoc)}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============================================================================
// EDIT PICKUP (client item 1, full edit): this page again for a completed
// pickup, prefilled from what it recorded. Save changes shows the money
// difference (old → new) — readings that re-price a finished drop, a changed
// safety deposit — saves it and settles it at the counter.
// ============================================================================

/** Fields of Edit Pickup a refusal can point at (anything else is shown above Save). */
const PICKUP_EDIT_FIELDS = ["odo", "pickupFuelLevel", "pickupFastagBalance", "safetyDeposit", "pickupDiscount", "dlStatus"];

interface PickupEditModeProps {
  booking: EmployeeBooking;
  pricingRules: PickupPricingRules | null | undefined;
  isLoadingPricing: boolean;
}

function PickupEditMode({ booking, pricingRules, isLoadingPricing }: PickupEditModeProps) {
  const { data: summary, isLoading, isError } = useSummary("PICKUP", booking.publicId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <DashboardNavbar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#FF5F00]" />
        </div>
      </div>
    );
  }
  // Can't be loaded or edited: the summary says why (and offers what it can)
  if (isError || !summary || summary.phase !== "PICKUP" || !summary.edit.allowed) {
    return <CompletedOperationPage phase="PICKUP" bookingId={booking.publicId} />;
  }
  return (
    <PickupEditForm
      booking={booking}
      summary={summary}
      pricingRules={pricingRules}
      isLoadingPricing={isLoadingPricing}
    />
  );
}

function PickupEditForm({ booking, summary, pricingRules, isLoadingPricing }: PickupEditModeProps & { summary: PickupSummary }) {
  // FASTag balance: editable for any car; once the pickup recorded one it can be
  // changed but not blanked — never recorded (older pickups) stays optional
  const fastagRequired = summary.fastag.balance != null;
  const hasFastag = summary.fastag.hasFastag || !!summary.fastag.vehicleHasFastag;

  // ── What the pickup recorded ──
  const [odo, setOdo] = useState(summary.odometer != null ? String(summary.odometer) : "");
  const [fuelLevel, setFuelLevel] = useState(summary.fuelLevel ?? "");
  const [fastagBalance, setFastagBalance] = useState(
    summary.fastag.balance != null ? String(Number(summary.fastag.balance)) : "",
  );
  const [dlStatus, setDlStatus] = useState<DlStatus>(summary.dl.status);
  const [photos, setPhotos] = useState<EditablePhoto[]>(() => photosOf(summary.photos));
  const [deposit, setDeposit] = useState(String(Number(summary.safetyDeposit) || 0));
  // Manual pickup discount (₹, blank / 0 = none) and its reason
  const [discount, setDiscount] = useState(summary.pickupDiscount ? String(Number(summary.pickupDiscount.amount)) : "");
  const [discountReason, setDiscountReason] = useState(summary.pickupDiscount?.reason ?? "");
  // Fleet note written at the pickup (blank clears it)
  const savedPickupNote = summary.operationNotes?.pickup?.note ?? "";
  const [pickupNote, setPickupNote] = useState(savedPickupNote);
  const [uploading, setUploading] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Photos uploaded here and not saved are deleted when the page closes
  const uploads = useEditUploads((fileId) => bookingService.deletePickupImage(fileId));

  const odoValue = /^\d+$/.test(odo.trim()) ? Number(odo.trim()) : null;
  const fastag = readFastagBalance(fastagBalance);

  // Only what changed is sent; the server keeps the rest as recorded
  const body = useMemo((): EditPickupBody => {
    const out: EditPickupBody = {};
    if (odoValue != null && odoValue !== summary.odometer) out.odo = odoValue;
    if (fuelLevel && fuelLevel !== summary.fuelLevel) out.pickupFuelLevel = fuelLevel;
    if (
      fastag.value != null &&
      (summary.fastag.balance == null || !sameMoney(fastag.value, summary.fastag.balance))
    ) {
      out.pickupFastagBalance = fastag.value;
    }
    if (summary.edit.dlStatusEditable && dlStatus && dlStatus !== summary.dl.status && dlStatus !== "DEPOSIT") {
      out.dlStatus = dlStatus;
    }
    const { removed, added } = photoDiff(photosOf(summary.photos), photos);
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added.map((p) => ({ fileId: p.fileId, label: p.label ?? null }));
    if (summary.edit.depositEditable && isMoneyInput(deposit) && !sameMoney(deposit, summary.safetyDeposit)) {
      out.safetyDeposit = Number(deposit);
    }
    // Manual pickup discount: sent only when it changes (blank / 0 removes it)
    if (summary.edit.discountEditable && (!discount.trim() || isMoneyInput(discount))) {
      const amount = discount.trim() ? Number(discount) : 0;
      const before = summary.pickupDiscount;
      const reason = discountReason.trim() || null;
      if (amount > 0) {
        if (!before || !sameMoney(String(amount), before.amount) || (before.reason ?? null) !== reason) {
          out.pickupDiscount = { amount, reason };
        }
      } else if (before) {
        out.pickupDiscount = null;
      }
    }
    if ((noteForRequest(pickupNote) ?? "") !== savedPickupNote) out.pickupNote = noteForRequest(pickupNote);
    return out;
  }, [odoValue, fuelLevel, fastag.value, dlStatus, photos, deposit, discount, discountReason, pickupNote, savedPickupNote, summary]);

  // ── The handover's own validations ──
  // Old pickups saved without a reading may stay without one
  const odoProblem = !odo.trim()
    ? summary.odometer != null
      ? "Enter the odometer reading."
      : null
    : odoValue == null || odoValue <= 0
      ? "Enter the odometer reading in whole km."
      : null;
  const fastagProblem = fastagRequired || fastagBalance.trim() ? fastag.error : null;
  const depositProblem =
    summary.edit.depositEditable && !isMoneyInput(deposit) ? "Enter the safety deposit in ₹ (0 for none)." : null;
  const discountMax = summary.edit.discountMax != null ? Number(summary.edit.discountMax) : null;
  const discountProblem =
    summary.edit.discountEditable && discount.trim() && Number(discount) > 0
      ? pickupDiscountInputError(discount, discountMax)
      : summary.edit.discountEditable && discount.trim() && !/^0+(\.0{1,2})?$/.test(discount.trim())
        ? "Enter the discount in ₹ (blank or 0 for none)."
        : null;
  const hadLabel = new Set(summary.photos.map((p) => p.label).filter(Boolean));
  const emptied = summary.captureFields.filter(
    (f) => f.required && hadLabel.has(f.name) && !photos.some((p) => p.label === f.name),
  );
  const photosProblem =
    (summary.photos.length > 0 && photos.length === 0
      ? "Keep at least one pickup photo — replace a photo rather than removing them all."
      : null) ??
    (emptied.length
      ? `Take the required photo${emptied.length > 1 ? "s" : ""}: ${emptied.map((f) => f.name).join(", ")}.`
      : null) ??
    (uploading ? "Wait for the photos to upload." : null);
  const noteProblem =
    pickupNote.trim().length > OPERATION_NOTE_MAX ? `Keep the pickup note under ${OPERATION_NOTE_MAX} characters.` : null;
  const blocker = odoProblem ?? fastagProblem ?? photosProblem ?? discountProblem ?? depositProblem ?? noteProblem;
  const changed = Object.keys(body).length > 0;

  /** A refusal of the preview / save that belongs to a field. */
  const onFormError = (error: unknown) => {
    const data = isAxiosError<{ field?: string | null; code?: string }>(error) ? error.response?.data : undefined;
    const message = errorMessage(error, "Couldn't save the changes. Try again.");
    const field =
      data?.field ??
      (data?.code?.startsWith("DL_STATUS") || DL_ERROR_CODES.includes(data?.code ?? "") ? "dlStatus" : null);
    if (field && PICKUP_EDIT_FIELDS.includes(field)) {
      setFieldError({ field, message });
      document.getElementById(`edit-pickup-${field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setFormError(message);
    }
  };
  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);
  const clearFieldError = (field: string) => setFieldError((cur) => (cur?.field === field ? null : cur));

  const flow = useEditSaveFlow<EditPickupBody, PickupSummary>({
    phase: "PICKUP",
    bookingId: booking.publicId,
    preview: (b) => completedOperationService.previewPickupEdit(booking.publicId, b),
    save: (b) => completedOperationService.editPickup(booking.publicId, b),
    onFormError,
    // Kept with the pickup now: never cleaned up as unused uploads
    onSaved: () => uploads.keep(photos.map((p) => p.fileId)),
  });

  const save = () => {
    if (blocker || !changed) return;
    setFieldError(null);
    setFormError(null);
    flow.open(body);
  };

  const vehicle = booking.items[0]?.vehicle;
  const depositShown =
    !!summary.edit.depositEditable || Number(summary.safetyDeposit) > 0 || !!summary.edit.depositLockedReason;

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
              <BreadcrumbLink asChild>
                <Link to={{ search: "" }}>Pickup {booking.publicId}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {flow.finished ? (
          <EditSavedCard
            phase="PICKUP"
            note={flow.finished.note}
            detail={`The pickup of ${vehicle ? `${vehicle.make} ${vehicle.model}` : "the vehicle"} for ${booking.customer.user.name} was updated.`}
          />
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Edit Pickup</h1>
              <p className="text-sm text-muted-foreground">
                Correct what this pickup recorded — any change in money is shown before it is saved
              </p>
            </div>

            <Card className="shadow-sm border-gray-200 bg-white">
              <CardContent className="pt-4 pb-4">
                <PickupBookingFacts booking={booking} />
              </CardContent>
            </Card>

            <PendingAdjustmentCard summary={summary} />

            {/* STEP 1: ORIGINAL LICENCE */}
            <StepCard
              stepNum={1}
              title="Driving Licence"
              subtitle="The original licence"
              isCompleted={!errorFor("dlStatus")}
              isLocked={false}
            >
              <CardContent className="pt-4 space-y-4">
                <div id="edit-pickup-dlStatus" className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                  {summary.edit.dlStatusEditable ? (
                    <DlStatusSelector
                      id="edit-pickup-dl-status"
                      value={dlStatus}
                      onValueChange={(v) => {
                        setDlStatus(v);
                        clearFieldError("dlStatus");
                      }}
                      error={errorFor("dlStatus")}
                      // Never recorded (older pickups): it may stay unset
                      optional={summary.dl.status == null}
                      onClear={summary.dl.status == null ? () => setDlStatus(null) : undefined}
                    />
                  ) : (
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">Original driving licence: {dlStatusLabel(summary.dl.status)}</p>
                      {summary.edit.dlStatusLockedReason && (
                        <p className="text-xs text-muted-foreground mt-0.5">{summary.edit.dlStatusLockedReason}</p>
                      )}
                    </div>
                  )}
                </div>
                <OperationNoteField
                  id="edit-pickup-note"
                  label="Pickup note"
                  value={pickupNote}
                  onChange={setPickupNote}
                />
              </CardContent>
            </StepCard>

            {/* STEP 2: VEHICLE INSPECTION */}
            <StepCard
              stepNum={2}
              title="Vehicle Inspection"
              subtitle="Odometer and fuel level at handover"
              isCompleted={!odoProblem && !fastagProblem && !!fuelLevel}
              isLocked={false}
            >
              <CardContent className="pt-4">
                <div className="mb-5">
                  <RentalTermsBox pricingRules={pricingRules} isLoading={isLoadingPricing} hasFastag={hasFastag} />
                </div>
                <div className="space-y-5">
                  <div id="edit-pickup-odo" className="space-y-2">
                    <Label htmlFor="edit-pickup-odo-input" className="text-sm font-medium">
                      Odometer Reading (KM)
                    </Label>
                    <Input
                      id="edit-pickup-odo-input"
                      type="number"
                      placeholder="e.g. 12500"
                      className={cn("h-12", (errorFor("odo") || (odo.trim() && odoProblem)) && "border-red-500")}
                      value={odo}
                      onChange={(e) => {
                        setOdo(e.target.value);
                        clearFieldError("odo");
                      }}
                    />
                    {errorFor("odo") || odoProblem ? (
                      <p className="text-xs text-red-500">{errorFor("odo") ?? odoProblem}</p>
                    ) : summary.edit.readingsMoveDropCharges ? (
                      <p className="text-xs text-muted-foreground">
                        The drop is done — a corrected reading re-works its km charge. You'll see the difference before saving.
                      </p>
                    ) : null}
                  </div>

                  <div id="edit-pickup-pickupFuelLevel" className="space-y-2">
                    <Label className="text-sm font-medium">
                      {booking.frozenChargeConfig?.fuelModuleEnabled ? "Pickup Fuel Level" : "Fuel Level"}
                    </Label>
                    <Select
                      value={fuelLevel}
                      onValueChange={(v) => {
                        setFuelLevel(v);
                        clearFieldError("pickupFuelLevel");
                      }}
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
                    {errorFor("pickupFuelLevel") && (
                      <p className="text-xs text-red-500">{errorFor("pickupFuelLevel")}</p>
                    )}
                  </div>

                  {/* FASTag balance — every car; required when it's marked as having a FASTag */}
                  <div id="edit-pickup-pickupFastagBalance" className="space-y-2">
                    <Label htmlFor="edit-pickup-fastag" className="text-sm font-medium">
                      FASTag balance (₹){" "}
                      {fastagRequired ? (
                        <span className="text-red-500">*</span>
                      ) : (
                        <span className="text-xs font-normal text-muted-foreground">optional</span>
                      )}
                    </Label>
                    <Input
                      id="edit-pickup-fastag"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="e.g. 480"
                      className={cn("h-12", (errorFor("pickupFastagBalance") || fastagProblem) && "border-red-500")}
                      value={fastagBalance}
                      onChange={(e) => {
                        setFastagBalance(e.target.value);
                        clearFieldError("pickupFastagBalance");
                      }}
                    />
                    {errorFor("pickupFastagBalance") || fastagProblem ? (
                      <p className="text-xs text-red-500">{errorFor("pickupFastagBalance") ?? fastagProblem}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {!fastagRequired ? "Leave empty if this car has no FASTag. " : ""}
                        {summary.edit.readingsMoveDropCharges
                          ? "The drop is done — a corrected balance re-works its FASTag charge. You'll see the difference before saving."
                          : "The usage until the drop is charged on the drop bill (no GST)."}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </StepCard>

            {/* STEP 3: PICKUP PHOTOS */}
            <StepCard
              stepNum={3}
              title="Pickup Photos"
              subtitle={
                summary.captureFields.length > 0
                  ? "Retake a required angle, or add / remove photos"
                  : "Add or remove photos of the vehicle at handover"
              }
              isCompleted={!photosProblem && photos.length > 0}
              isLocked={false}
            >
              <CardContent className="pt-4">
                <PhotoEditor
                  fields={summary.captureFields}
                  value={photos}
                  onChange={setPhotos}
                  onBusyChange={setUploading}
                  upload={uploads.track((form) => bookingService.uploadPickupImage(form))}
                />
              </CardContent>
            </StepCard>

            {/* DISCOUNT — the manual pickup discount (₹ off the rent incl. GST), before the deposit;
                a change is collected / refunded when the edit is saved */}
            {summary.edit.discountEditable && (
              <Card className="shadow-sm border border-gray-200 bg-white">
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Tag className="h-4 w-4 text-[#FF5F00]" />
                    Discount
                  </div>
                  <div id="edit-pickup-pickupDiscount" className="space-y-2 max-w-xs">
                    <Label htmlFor="edit-pickup-discount" className="text-xs text-neutral-600">
                      Discount (₹)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                      <Input
                        id="edit-pickup-discount"
                        inputMode="decimal"
                        placeholder="0"
                        className={cn("pl-7 h-10", (errorFor("pickupDiscount") || discountProblem) && "border-red-500")}
                        value={discount}
                        onChange={(e) => {
                          setDiscount(cleanDiscountInput(e.target.value));
                          clearFieldError("pickupDiscount");
                        }}
                      />
                    </div>
                    {errorFor("pickupDiscount") || discountProblem ? (
                      <p className="text-xs text-red-500">{errorFor("pickupDiscount") ?? discountProblem}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        A flat amount off the rent (GST included)
                        {discountMax != null ? `, up to ${formatRupees(discountMax)} — the rent payable at the pickup` : ""}.
                        Blank for none.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 max-w-md">
                    <Label htmlFor="edit-pickup-discount-reason" className="text-xs text-neutral-600">
                      Reason (optional)
                    </Label>
                    <Input
                      id="edit-pickup-discount-reason"
                      className="h-10"
                      maxLength={200}
                      placeholder="Why is the customer getting a discount?"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* STEP 4: SAFETY DEPOSIT — changeable while the car is out and the drop hasn't billed it */}
            {depositShown && (
              <StepCard
                stepNum={4}
                title="Safety Deposit"
                subtitle={
                  summary.edit.depositEditable
                    ? "A higher deposit is collected, a lower one refunded"
                    : "Held from the pickup"
                }
                isCompleted={!depositProblem}
                isLocked={false}
              >
                <CardContent className="pt-4">
                  {summary.edit.depositEditable ? (
                    <div id="edit-pickup-safetyDeposit" className="space-y-2 max-w-xs">
                      <Label htmlFor="edit-pickup-deposit" className="text-xs text-neutral-600">
                        Safety deposit (₹)
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                        <Input
                          id="edit-pickup-deposit"
                          inputMode="decimal"
                          className={cn("pl-7 h-10", (errorFor("safetyDeposit") || depositProblem) && "border-red-500")}
                          value={deposit}
                          onChange={(e) => {
                            setDeposit(e.target.value.replace(/[^0-9.]/g, ""));
                            clearFieldError("safetyDeposit");
                          }}
                        />
                      </div>
                      {errorFor("safetyDeposit") || depositProblem ? (
                        <p className="text-xs text-red-500">{errorFor("safetyDeposit") ?? depositProblem}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Held now: {formatRupees(Number(summary.safetyDeposit) || 0)}. 0 takes the deposit off.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-sm">
                      <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-gray-900">
                          Safety deposit: {formatRupees(Number(summary.safetyDeposit) || 0)}
                        </p>
                        {summary.edit.depositLockedReason && (
                          <p className="text-xs text-muted-foreground mt-0.5">{summary.edit.depositLockedReason}</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </StepCard>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">
              <Tag className="h-4 w-4 mt-0.5 shrink-0 text-neutral-400" />
              <span>Rent, coupons and extensions aren't changed here — ask the branch manager.{summary.edit.discountEditable ? " The pickup discount is changed above." : ""}</span>
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {formError}
              </div>
            )}

            <EditSaveBar blocker={blocker} changed={changed} busy={flow.busy} onSave={save} />
          </>
        )}
      </main>

      {flow.dialog}
    </div>
  );
}
