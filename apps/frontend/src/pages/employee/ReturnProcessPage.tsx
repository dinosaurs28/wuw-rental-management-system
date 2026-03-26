import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import { bookingService } from "@/services/booking.service";
import { paymentSessionService, type ReturnSessionResponse } from "@/services/paymentSession.service";
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
import { Separator } from "@/components/ui/separator";
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
  DialogTrigger,
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
  Wallet,
  Banknote,
  CreditCard,
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

export default function ReturnProcessPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // State
  const [returnPhotos, setReturnPhotos] = useState<
    { publicId: string; url: string }[]
  >([]);
  const [hasDamage, setHasDamage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [requireManagerConfirmation, setRequireManagerConfirmation] = useState(false);
  // Charge engine state
  const [endOdometer, setEndOdometer] = useState<string>("");
  const [returnFuelLevel, setReturnFuelLevel] = useState<string>("");
  const [fuelDeficitCharge, setFuelDeficitCharge] = useState<string>("");
  const [fuelSkipReason, setFuelSkipReason] = useState<string>("");
  const [skipFuelCharge, setSkipFuelCharge] = useState(false);
  const [fastagAmount, setFastagAmount] = useState<string>("");
  const [fastagNotes, setFastagNotes] = useState<string>("");
  const [chargeBreakdown, setChargeBreakdown] = useState<import("@/services/booking.service").ChargeBreakdown | null>(null);
  const [returnSession, setReturnSession] = useState<ReturnSessionResponse | null>(null);

  // Damage Report State
  const [damages, setDamages] = useState<DamageItem[]>([]);
  const [activeDamage, setActiveDamage] = useState<Partial<DamageItem>>({
    severity: "Minor",
    photos: [],
  });
  const [showDamageForm, setShowDamageForm] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{
    success: boolean;
    message: string;
    reportId?: number;
  } | null>(null);

  // Dialog Control
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showRemainingPaymentDialog, setShowRemainingPaymentDialog] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"CASH" | "ONLINE" | null>(null);
  const [onlinePaymentUrl, setOnlinePaymentUrl] = useState<string | null>(null);

  // Queries
  const {
    data: booking,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () => bookingService.getReturnDetails(bookingId!),
    enabled: !!bookingId,
  });

  const { data: pickupCapturesData } = useQuery<{
    photos: { publicId: string; captureLabel: string | null; url: string; mime: string }[];
  }>({
    queryKey: ["pickup-captures", bookingId],
    queryFn: () =>
      apiClient.get(`/employee/return/${bookingId}/pickup-captures`).then((r) => r.data),
    enabled: !!bookingId,
  });
  const pickupCaptures = pickupCapturesData?.photos ?? [];

  // Mutations
  const uploadReturnMutation = useMutation({
    mutationFn: bookingService.uploadReturnImage,
    onSuccess: (data) => {
      setReturnPhotos((prev) => [
        ...prev,
        { publicId: data.fileId, url: data.url },
      ]);
      toast.success("Return photo uploaded");
    },
    onError: () => toast.error("Failed to upload photo"),
  });

  const uploadDamageMutation = useMutation({
    mutationFn: bookingService.uploadDamageImage,
    onSuccess: (data) => {
      setActiveDamage((prev) => ({
        ...prev,
        photos: [
          ...(prev.photos || []),
          { publicId: data.fileId, url: data.url },
        ],
      }));
      toast.success("Damage photo uploaded");
    },
    onError: () => toast.error("Failed to upload damage photo"),
  });

  const completeReturnMutation = useMutation({
    mutationFn: (data: { returnImageIds: string[], requireManagerConfirmation?: boolean }) =>
      bookingService.completeReturn(bookingId!, data),
    onSuccess: (data: any) => {
      setSubmissionResult({
        success: true,
        message: data.message || "Return completed",
        reportId: data.reportId,
      });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to complete return");
    },
  });

  const reportDamageMutation = useMutation({
    mutationFn: (data: any) => bookingService.reportDamage(data),
    onSuccess: (data: any) => {
      setSubmissionResult({
        success: true,
        message: data.message || "Damage report submitted",
        reportId: data.reportId,
      });
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.message || "Failed to submit damage report",
      );
    },
  });

  const deleteReturnImageMutation = useMutation({
    mutationFn: bookingService.deleteReturnImage,
    onSuccess: (_, publicId) => {
      setReturnPhotos((prev) =>
        prev.filter((img) => img.publicId !== publicId),
      );
      toast.success("Photo removed");
    },
    onError: () => toast.error("Failed to remove photo"),
  });

  const deleteDamageImageMutation = useMutation({
    mutationFn: bookingService.deleteReturnImage,
    onSuccess: () => {
      // We handle state updates locally in the calling functions or specific contexts
      toast.success("Damage photo removed");
    },
    onError: () => toast.error("Failed to remove damage photo"),
  });

  const buildComputePayload = () => {
    const config = booking?.frozenChargeConfig;
    const payload: any = {
      endOdometer: parseFloat(endOdometer),
      returnImageIds: returnPhotos.map((p) => p.publicId),
    };
    if (config?.fuelModuleEnabled && returnFuelLevel) {
      payload.returnFuelLevel = returnFuelLevel;
      if (skipFuelCharge) {
        payload.fuelSkipReason = fuelSkipReason || "Waived by employee";
      } else if (fuelDeficitCharge) {
        payload.fuelDeficitCharge = parseFloat(fuelDeficitCharge);
      }
    }
    if (config?.fastagModuleEnabled && fastagAmount) {
      payload.fastagAmount = parseFloat(fastagAmount);
      if (fastagNotes) payload.fastagNotes = fastagNotes;
    }
    return payload;
  };

  const computeChargesMutation = useMutation({
    mutationFn: async () => {
      const payload = buildComputePayload();
      const usePaymentSessions = booking?.branch?.chargeConfig?.usePaymentSessions ?? false;
      if (usePaymentSessions) {
        const sessionResponse = await paymentSessionService.computeReturnSession(bookingId!, payload);
        return { _sessionMode: true as const, sessionResponse };
      } else {
        const legacyData = await bookingService.computeReturnCharges(bookingId!, payload);
        return { _sessionMode: false as const, legacyData };
      }
    },
    onSuccess: (result) => {
      if (result._sessionMode) {
        setReturnSession(result.sessionResponse);
        setChargeBreakdown(null);
      } else {
        setChargeBreakdown((result.legacyData as any).data);
        setReturnSession(null);
      }
      toast.success("Charges computed successfully");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to compute charges");
    },
  });

  const remainingPaymentMutation = useMutation({
    mutationFn: (method: "CASH" | "ONLINE") =>
      bookingService.initiateRemainingPayment(bookingId!, "return", { method }),
    onSuccess: (data, method) => {
      if (method === "ONLINE" && data.paymentURL) {
        setOnlinePaymentUrl(data.paymentURL);
        return;
      }
      toast.success("Remaining payment collected!");
      setShowRemainingPaymentDialog(false);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Payment failed");
    },
  });

  const formatPrice = (amount: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
    }).format(Number(amount));

  useEffect(() => {
    if (booking?.requiresManagerConfirmation) {
      setRequireManagerConfirmation(true);
    }
  }, [booking]);

  const handleCompleteReturn = (chargeModulesActive: boolean) => {
    if (returnPhotos.length === 0) {
      toast.error("Please upload return condition photos");
      return;
    }
    if (chargeModulesActive && !endOdometer) {
      toast.error("Please enter the end odometer reading and compute charges");
      return;
    }
    if (chargeModulesActive && !chargeBreakdown) {
      toast.error("Please compute charges before completing the return");
      return;
    }
    completeReturnMutation.mutate({
      returnImageIds: returnPhotos.map((p) => p.publicId),
      requireManagerConfirmation,
    });
  };

  const handleReportDamage = () => {
    if (damages.length === 0) {
      toast.error("Please add at least one damage entry");
      return;
    }
    reportDamageMutation.mutate({
      bookingId: bookingId,
      odo: parseFloat(endOdometer) || 0,
      fuelLevel: FUEL_LEVEL_TO_PCT[returnFuelLevel] ?? 100,
      severity: damages.some((d) => d.severity === "Severe")
        ? "Severe"
        : damages.some((d) => d.severity === "Moderate")
          ? "Moderate"
          : "Minor",
      damageImageIds: damages.flatMap((d) => d.photos.map((p) => p.publicId)),
      notes: { damages },
      returnImageIds: returnPhotos.map((p) => p.publicId),
    });
  };

  // Handlers
  const onDropReturn = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const processedFile = await compressImage(file);
        const formData = new FormData();
        formData.append("file", processedFile);
        uploadReturnMutation.mutate(formData);
      } catch (error) {
        console.error("Compression error:", error);
        // Fallback to original file if compression fails
        const formData = new FormData();
        formData.append("file", file);
        uploadReturnMutation.mutate(formData);
      }
    }
  };

  const {
    getRootProps: getReturnRootProps,
    getInputProps: getReturnInputProps,
  } = useDropzone({
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
      } catch (error) {
        console.error("Compression error:", error);
        const formData = new FormData();
        formData.append("file", file);
        uploadDamageMutation.mutate(formData);
      }
    }
  };

  const {
    getRootProps: getDamageRootProps,
    getInputProps: getDamageInputProps,
  } = useDropzone({
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
      {
        ...activeDamage,
        id: Math.random().toString(36).substr(2, 9),
      } as DamageItem,
    ]);
    setActiveDamage({ severity: "Minor", photos: [] });
    setShowDamageForm(false);
  };

  const removeDamageItem = (id: string) => {
    const item = damages.find((d) => d.id === id);
    if (item && item.photos.length > 0) {
      item.photos.forEach((photo) => {
        deleteDamageImageMutation.mutate(photo.publicId);
      });
    }
    setDamages((prev) => prev.filter((d) => d.id !== id));
  };

  const removeSavedDamagePhoto = (damageId: string, publicId: string) => {
    deleteDamageImageMutation.mutate(publicId);
    setDamages((prev) =>
      prev.map((d) => {
        if (d.id === damageId) {
          return {
            ...d,
            photos: d.photos.filter((p) => p.publicId !== publicId),
          };
        }
        return d;
      }),
    );
  };

  if (isLoading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (error || !booking)
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        Failed to load booking details
      </div>
    );

  const vehicle = booking.items[0]?.vehicle;
  const isCompleted =
    booking.status === "RETURNED" || booking.status === "COMPLETED";
  const chargeModulesActive = !!(
    booking.frozenChargeConfig?.extraKmEnabled ||
    booking.frozenChargeConfig?.extraTimeEnabled ||
    booking.frozenChargeConfig?.fuelModuleEnabled ||
    booking.frozenChargeConfig?.fastagModuleEnabled
  );
  const hasReturnPhotos = returnPhotos.length > 0;

  // Zones based on logic
  const isTWUWheeler = vehicle?.category?.toLowerCase().includes("two");
  const damageZones = isTWUWheeler
    ? ["Front", "Rear", "Left Side", "Right Side"]
    : [
      "Front Bumper",
      "Rear Bumper",
      "Left Front Door",
      "Left Rear Door",
      "Right Front Door",
      "Right Rear Door",
      "Hood",
      "Roof",
      "Trunk",
      "Wheels",
      "Interior",
    ];

  if (submissionResult?.success) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-6 border-green-200 bg-green-50/50">
          <CardContent className="space-y-4 pt-6">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <FileCheck className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-green-800">
              {submissionResult.message}
            </h2>
            {submissionResult.reportId && (
              <p className="text-sm text-green-700">
                Reference ID: #{submissionResult.reportId}
              </p>
            )}
            <Button
              className="w-full mt-4 bg-green-600 hover:bg-green-700"
              onClick={() => navigate("/employee/dashboard")}
            >
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      <DashboardNavbar />

      <div className="container mx-auto max-w-[1280px] py-8 space-y-8">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/employee/dashboard">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/employee/dashboard">
                Returns
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Return Inspection</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-4xl font-bold tracking-tight text-primary">
                Return Inspection
              </h1>
              <Badge
                variant={isCompleted ? "outline" : "secondary"}
                className={cn(
                  "uppercase px-3 py-1",
                  isCompleted && "bg-green-100 text-green-700 border-green-200",
                )}
              >
                {booking.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-4 text-sm">
              <span>
                License:{" "}
                <span className="font-mono text-foreground font-medium">
                  {vehicle?.regNo}
                </span>
              </span>
              <span>•</span>
              <span>
                Customer:{" "}
                <span className="font-medium text-foreground">
                  {booking.customer.user.name}
                </span>
              </span>
              <span>•</span>
              <span>Ref: #{booking.publicId.substring(0, 8)}</span>
            </p>
          </div>
          <Button
            variant="outline"
            className="border-orange-500 text-orange-500 hover:bg-orange-50 px-6"
            onClick={() => navigate("/employee/dashboard")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Queue
          </Button>
        </div>

        {isCompleted && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-3">
            <FileCheck className="h-5 w-5" />
            <div>
              <p className="font-semibold">Return Completed</p>
              <p className="text-sm">
                This vehicle has been returned and processed.
              </p>
            </div>
          </div>
        )}

        {/* Advance Payment Banner */}
        {booking.isAdvancePayment && !isCompleted && (
          <div className={`border p-4 rounded-lg ${booking.remainingPaidAt ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Wallet className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {booking.remainingPaidAt ? "Remaining Payment Collected" : "Remaining Balance Must Be Paid Before Return"}
                  </p>
                  <p className="text-sm mt-0.5">
                    {booking.remainingPaidAt
                      ? `${formatPrice(booking.remainingBalance ?? "0")} has been collected.`
                      : `Outstanding balance: ${formatPrice(booking.remainingBalance ?? "0")}. Collect before completing return.`}
                  </p>
                </div>
              </div>
              {!booking.remainingPaidAt && (
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white shrink-0"
                  onClick={() => setShowRemainingPaymentDialog(true)}
                >
                  Collect Now
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Remaining Payment Dialog */}
        <Dialog open={showRemainingPaymentDialog} onOpenChange={(open) => {
          setShowRemainingPaymentDialog(open);
          if (!open) { setOnlinePaymentUrl(null); setSelectedPaymentMethod(null); }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Collect Remaining Balance</DialogTitle>
              <DialogDescription>
                Amount due: <strong>{formatPrice(booking?.remainingBalance ?? "0")}</strong>. Select payment method.
              </DialogDescription>
            </DialogHeader>

            {onlinePaymentUrl ? (
              <div className="py-4 space-y-4">
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800">
                  <CreditCard className="h-5 w-5 shrink-0" />
                  <p className="text-sm font-medium">Payment link generated. Share with customer or open below.</p>
                </div>
                <a
                  href={onlinePaymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#FF5F00] hover:bg-[#e65600] text-white font-semibold py-3 px-4 transition-colors"
                >
                  <CreditCard className="h-4 w-4" />
                  Open Payment Portal
                </a>
                <p className="text-xs text-muted-foreground text-center break-all">{onlinePaymentUrl}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-4">
                {(["CASH", "ONLINE"] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setSelectedPaymentMethod(method)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${selectedPaymentMethod === method
                        ? "border-primary bg-primary/10"
                        : "border-gray-200 hover:border-gray-300"
                      }`}
                  >
                    {method === "CASH" && <Banknote className="h-6 w-6" />}
                    {method === "ONLINE" && <CreditCard className="h-6 w-6" />}
                    <span className="text-sm font-medium">{method}</span>
                  </button>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowRemainingPaymentDialog(false);
                setOnlinePaymentUrl(null);
                setSelectedPaymentMethod(null);
              }}>
                {onlinePaymentUrl ? "Close" : "Cancel"}
              </Button>
              {!onlinePaymentUrl && (
                <Button
                  className="bg-[#FF5F00] hover:bg-[#e65600]"
                  disabled={!selectedPaymentMethod || remainingPaymentMutation.isPending}
                  onClick={() => selectedPaymentMethod && remainingPaymentMutation.mutate(selectedPaymentMethod)}
                >
                  {remainingPaymentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Confirm Payment"
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form Area */}
          <div className="lg:col-span-2 space-y-8">
            {/* Pre-delivery Reference Photos */}
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
                        <img
                          src={photo.url}
                          alt={photo.captureLabel ?? "Pickup photo"}
                          className="w-full h-28 object-cover"
                          loading="lazy"
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
              </Card>
            )}

            {/* 1. Return Media Upload */}
            <Card className="border-none shadow-sm">
              <CardHeader className="px-6 pt-6">
                <CardTitle className="text-2xl">
                  1. Return Media Upload
                </CardTitle>
                <CardDescription className="text-base">
                  Upload general condition photos of the vehicle (4-6 photos
                  recommended).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div
                  {...getReturnRootProps()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center hover:bg-gray-50 transition-colors cursor-pointer bg-white"
                >
                  <input {...getReturnInputProps()} disabled={isCompleted} />
                  <Upload className="mx-auto h-12 w-12 text-[#999999] mb-4" />
                  <p className="text-base text-[#666666] font-medium">
                    Drag & drop photos here, or click to browse
                  </p>
                  <p className="text-sm text-[#999999] mt-2">
                    Supports JPG, PNG
                  </p>
                </div>

                {returnPhotos.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-4 mt-6">
                    {returnPhotos.map((img, idx) => (
                      <div
                        key={img.publicId}
                        className="relative aspect-square rounded-md overflow-hidden border bg-muted group cursor-pointer"
                        onClick={() => setPreviewImage(img.url)}
                      >
                        <img
                          src={img.url}
                          alt={`Return ${idx}`}
                          className="w-full h-full object-cover"
                        />

                        {/* Delete Action - Always visible on mobile, hover on desktop */}
                        <Button
                          size="icon"
                          variant="destructive"
                          className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteReturnImageMutation.mutate(img.publicId);
                          }}
                          disabled={isCompleted}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Dialog
                  open={!!previewImage}
                  onOpenChange={(open) => !open && setPreviewImage(null)}
                >
                  <DialogContent className="max-w-3xl p-0 overflow-hidden bg-zinc-100/80 border-none sm:rounded-lg">
                    <div className="relative w-full h-[80vh] flex items-center justify-center">
                      <img
                        src={previewImage!}
                        alt="Preview"
                        className="max-w-full max-h-full object-contain"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100"
                        onClick={() => setPreviewImage(null)}
                      >
                        <X className="h-6 w-6" />
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* 2. Charge Details */}
            {!isCompleted && hasReturnPhotos && (
              <Card className="border-none shadow-sm">
                <CardHeader className="px-6 pt-6 pb-3">
                  <CardTitle className="text-2xl">2. Charge Details</CardTitle>
                  <CardDescription className="text-base">
                    Enter return readings — charges will be computed before completion.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-6 space-y-5">
                  {/* End Odometer */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      End Odometer Reading (km)
                    </Label>
                    <div className="flex gap-3 items-center">
                      <Input
                        type="number"
                        min="0"
                        placeholder="e.g. 12850"
                        className="h-11 max-w-xs"
                        value={endOdometer}
                        onChange={(e) => { setEndOdometer(e.target.value); setChargeBreakdown(null); }}
                      />
                      {booking?.startOdometer != null && endOdometer && (
                        <p className="text-sm text-muted-foreground">
                          Driven: <span className="font-semibold text-foreground">
                            {Math.max(0, parseFloat(endOdometer) - booking.startOdometer).toFixed(0)} km
                          </span>
                          <span className="text-xs ml-1">(start: {booking.startOdometer} km)</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Return Fuel Level — always captured together with odometer */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Fuel className="h-4 w-4 text-muted-foreground" />
                      Return Fuel Level
                    </Label>
                    <Select value={returnFuelLevel} onValueChange={(v) => { setReturnFuelLevel(v); setChargeBreakdown(null); }}>
                      <SelectTrigger className="h-11 max-w-xs">
                        <SelectValue placeholder="Select fuel level at return" />
                      </SelectTrigger>
                      <SelectContent>
                        {FUEL_LEVEL_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Fuel Deficit — only when module enabled and fuel is below full */}
                  {booking?.frozenChargeConfig?.fuelModuleEnabled &&
                    returnFuelLevel &&
                    FUEL_LEVEL_ORDER[returnFuelLevel] < FUEL_LEVEL_ORDER["FULL"] && (
                    <div className="space-y-3 p-4 rounded-lg border bg-amber-50/40 border-amber-200">
                      <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                        <Fuel className="h-4 w-4" /> Fuel Deficit Charge
                      </p>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="skipFuel"
                          checked={skipFuelCharge}
                          onCheckedChange={(v) => setSkipFuelCharge(!!v)}
                        />
                        <Label htmlFor="skipFuel" className="text-sm cursor-pointer text-amber-800">
                          Skip fuel deficit charge (waive)
                        </Label>
                      </div>
                      {!skipFuelCharge ? (
                        <div className="space-y-2">
                          <Label className="text-xs text-neutral-600">Fuel Deficit Charge (₹)</Label>
                          <div className="relative max-w-xs">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                            <Input
                              type="number"
                              min="0"
                              className="pl-7 h-10"
                              placeholder="e.g. 300"
                              value={fuelDeficitCharge}
                              onChange={(e) => { setFuelDeficitCharge(e.target.value); setChargeBreakdown(null); }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-xs text-neutral-600">Skip Reason</Label>
                          <Input
                            className="h-10 max-w-sm"
                            placeholder="Reason for waiving fuel charge..."
                            value={fuelSkipReason}
                            onChange={(e) => setFuelSkipReason(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fastag Module */}
                  {booking?.frozenChargeConfig?.fastagModuleEnabled && booking?.items[0]?.vehicle?.hasFastag && (
                    <div className="space-y-3 p-4 rounded-lg border bg-green-50/40 border-green-200">
                      <p className="text-sm font-semibold text-green-900 flex items-center gap-2">
                        <CreditCard className="h-4 w-4" /> Fastag Toll Charges
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-neutral-600">Fastag Amount (₹)</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                            <Input
                              type="number"
                              min="0"
                              className="pl-7 h-10"
                              placeholder="e.g. 150"
                              value={fastagAmount}
                              onChange={(e) => { setFastagAmount(e.target.value); setChargeBreakdown(null); }}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-neutral-600">Notes (optional)</Label>
                          <Input
                            className="h-10"
                            placeholder="Route / toll plaza..."
                            value={fastagNotes}
                            onChange={(e) => setFastagNotes(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Compute charges — only when charge modules are active */}
                  {chargeModulesActive && (
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

                  {/* Session-based payment (new flow) */}
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

                  {/* Legacy Charge Breakdown */}
                  {chargeBreakdown && (
                    <div className="rounded-lg border overflow-hidden">
                      <div className="px-4 py-3 bg-neutral-50 border-b">
                        <p className="text-sm font-semibold text-neutral-900">Charge Breakdown</p>
                      </div>
                      <div className="divide-y text-sm">
                        {chargeBreakdown.charges.map((charge, i) => (
                          <div key={i} className="flex items-center justify-between px-4 py-3">
                            <div>
                              <p className="font-medium text-neutral-800">{charge.label}</p>
                              {charge.quantity && charge.unitRate && (
                                <p className="text-xs text-neutral-500">
                                  {parseFloat(charge.quantity).toFixed(1)} × ₹{charge.unitRate}
                                </p>
                              )}
                              {charge.notes && (
                                <p className="text-xs text-neutral-400">{charge.notes}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className={`font-semibold ${charge.isOverridden ? "line-through text-neutral-400" : "text-neutral-900"}`}>
                                ₹{parseFloat(charge.originalAmount).toLocaleString("en-IN")}
                              </p>
                              {charge.isOverridden && (
                                <p className="text-xs text-green-600 font-medium">
                                  ₹{parseFloat(charge.finalAmount).toLocaleString("en-IN")}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="px-4 py-3 bg-neutral-50 border-t flex items-center justify-between">
                        <p className="font-semibold text-neutral-900">Total</p>
                        <p className="text-lg font-bold text-[#FF5F00]">
                          ₹{parseFloat(chargeBreakdown.finalTotal).toLocaleString("en-IN")}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 3. Condition Check */}
            {hasReturnPhotos && <Card className="border-none shadow-sm">
              <CardHeader className="px-6 pt-6">
                <CardTitle className="text-2xl">
                  3. Vehicle Condition Check
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div
                  className="flex items-start space-x-4 p-6 border rounded-lg bg-white hover:border-orange-200 transition-colors cursor-pointer"
                  onClick={() => !isCompleted && setHasDamage(!hasDamage)}
                >
                  <Checkbox
                    id="damage-check"
                    checked={hasDamage}
                    onCheckedChange={(c) => setHasDamage(!!c)}
                    disabled={isCompleted}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="damage-check"
                      className="text-base font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Does the vehicle have any new damage?
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Enable this if you identify scratches, dents, or other
                      issues.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>}

            {/* 4. Damage Details (Conditional) */}
            {hasReturnPhotos && hasDamage && (
              <Card className="border-orange-200">
                <CardHeader className="bg-orange-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-orange-700">
                      <AlertTriangle className="h-5 w-5" />
                      <CardTitle>4. Damage Report Details</CardTitle>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowDamageForm(true)}
                      disabled={isCompleted}
                    >
                      + Add Damage Entry
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {showDamageForm && (
                    <div className="mb-6 p-4 border rounded-lg space-y-4 bg-background animate-in fade-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Area</Label>
                          <Select
                            onValueChange={(v) =>
                              setActiveDamage({ ...activeDamage, area: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select Area" />
                            </SelectTrigger>
                            <SelectContent>
                              {damageZones.map((z) => (
                                <SelectItem key={z} value={z}>
                                  {z}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Severity</Label>
                          <Select
                            defaultValue="Minor"
                            onValueChange={(v) =>
                              setActiveDamage({ ...activeDamage, severity: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
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
                          onChange={(e) =>
                            setActiveDamage({
                              ...activeDamage,
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Photos of Damage</Label>
                        <div
                          {...getDamageRootProps()}
                          className="border border-dashed p-4 rounded text-center text-sm cursor-pointer hover:bg-muted"
                        >
                          <input {...getDamageInputProps()} />
                          <p>Click to upload damage photos</p>
                        </div>
                        {activeDamage.photos &&
                          activeDamage.photos.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mt-2">
                              {activeDamage.photos.map((img, idx) => (
                                <div
                                  key={img.publicId}
                                  className="relative aspect-square rounded overflow-hidden border bg-muted group cursor-pointer"
                                  onClick={() => setPreviewImage(img.url)}
                                >
                                  <img
                                    src={img.url}
                                    alt={`Damage ${idx}`}
                                    className="w-full h-full object-cover"
                                  />
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    className="absolute top-1 right-1 h-5 w-5 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteDamageImageMutation.mutate(
                                        img.publicId,
                                      );
                                      setActiveDamage((prev) => ({
                                        ...prev,
                                        photos: prev.photos?.filter(
                                          (p) => p.publicId !== img.publicId,
                                        ),
                                      }));
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDamageForm(false)}
                        >
                          Cancel
                        </Button>
                        <Button size="sm" onClick={addDamageItem}>
                          Save Entry
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* List of damages */}
                  <div className="space-y-3">
                    {damages.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between p-3 border rounded-md bg-white shadow-sm"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{item.area}</span>
                            <Badge
                              variant={
                                item.severity === "Severe"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {item.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.description}
                          </p>

                          {item.photos.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mt-2">
                              {item.photos.map((img, idx) => (
                                <div
                                  key={img.publicId}
                                  className="relative aspect-square rounded overflow-hidden border bg-muted group cursor-pointer"
                                  onClick={() => setPreviewImage(img.url)}
                                >
                                  <img
                                    src={img.url}
                                    alt={`Damage ${idx}`}
                                    className="w-full h-full object-cover"
                                  />
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    className="absolute top-1 right-1 h-5 w-5 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeSavedDamagePhoto(
                                        item.id,
                                        img.publicId,
                                      );
                                    }}
                                    disabled={isCompleted}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => removeDamageItem(item.id)}
                          disabled={isCompleted}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {damages.length === 0 && !showDamageForm && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No damage reported yet.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-8">


            {/* 5. Actions */}
            <Card className="bg-[#1A1A1A] text-white border-none shadow-lg">
              <CardHeader>
                <CardTitle className="text-white">Return Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Base Rental</span>
                  <span className="font-medium text-white">Paid</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Reported Damage</span>
                  <span
                    className={cn(
                      "font-medium",
                      hasDamage ? "text-orange-600" : "text-green-600",
                    )}
                  >
                    {hasDamage ? "To be assessed" : "None"}
                  </span>
                </div>

                <Separator className="bg-gray-700" />

                {!isCompleted && booking.requiresManagerConfirmation && (
                  <div className="flex items-center space-x-2 py-2">
                    <Checkbox
                      id="requireManagerConfirmation"
                      checked={true}
                      disabled
                      className="border-gray-500 data-[state=checked]:bg-[#FF5F00] data-[state=checked]:text-white disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <Label
                      htmlFor="requireManagerConfirmation"
                      className="text-sm font-medium text-gray-200 cursor-not-allowed opacity-70"
                    >
                      Confirm with Manager Before Final Return
                      <span className="ml-2 text-xs text-amber-400">(required by manager)</span>
                    </Label>
                  </div>
                )}

                {/* Remaining balance info in sidebar */}
                {booking.isAdvancePayment && (
                  <div className={`flex justify-between items-center text-sm ${booking.remainingPaidAt ? "text-green-400" : "text-red-400"}`}>
                    <span className="text-gray-400">Remaining Balance</span>
                    <span className="font-medium">
                      {booking.remainingPaidAt ? "Paid" : formatPrice(booking.remainingBalance ?? "0")}
                    </span>
                  </div>
                )}

                {!hasReturnPhotos && !isCompleted && (
                  <p className="text-xs text-amber-400 text-center py-1">
                    Upload return photos to proceed
                  </p>
                )}

                {isCompleted ? (
                  <Button className="w-full" variant="outline" disabled>
                    Return Completed
                  </Button>
                ) : booking.isAdvancePayment && !booking.remainingPaidAt ? (
                  <Button
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setShowRemainingPaymentDialog(true)}
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    Collect {formatPrice(booking.remainingBalance ?? "0")} First
                  </Button>
                ) : hasDamage ? (
                  <Dialog
                    open={showReportDialog}
                    onOpenChange={setShowReportDialog}
                  >
                    <DialogTrigger asChild>
                      <Button
                        className="w-full bg-[#FF5F00] hover:bg-[#E05200] text-white border-none"
                        disabled={!hasReturnPhotos}
                      >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Report Manager for Damage
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Confirm Damage Report</DialogTitle>
                        <DialogDescription>
                          You are about to report damage and submit this return
                          for manager review. This will lock the return.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <p className="font-medium mb-1">Summary:</p>
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          <li>{damages.length} damage entries</li>
                          {endOdometer && <li>Odometer: {endOdometer} km</li>}
                          {returnFuelLevel && <li>Fuel: {returnFuelLevel.replace(/_/g, " ")}</li>}
                        </ul>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setShowReportDialog(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleReportDamage}
                        >
                          Confirm & Report
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : returnSession ? null : (
                  <Dialog
                    open={showCompleteDialog}
                    onOpenChange={setShowCompleteDialog}
                  >
                    <DialogTrigger asChild>
                      <Button
                        className="w-full bg-[#28A745] hover:bg-green-700 text-white border-none"
                        disabled={!hasReturnPhotos}
                      >
                        <FileCheck className="mr-2 h-4 w-4" />
                        Complete Return
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Complete Return</DialogTitle>
                        <DialogDescription>
                          Confirm that the vehicle is in good condition with NO
                          new damage.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <p className="font-medium mb-1">Summary:</p>
                        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                          <li>No new damage</li>
                          {endOdometer && <li>End odometer: {endOdometer} km</li>}
                          {returnFuelLevel && <li>Return fuel: {returnFuelLevel.replace(/_/g, " ")}</li>}
                          {chargeBreakdown && (
                            <li className="text-[#FF5F00] font-medium">
                              Total charges: ₹{parseFloat(chargeBreakdown.finalTotal).toLocaleString("en-IN")}
                            </li>
                          )}
                        </ul>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setShowCompleteDialog(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => handleCompleteReturn(chargeModulesActive)}
                        >
                          Confirm Complete
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
