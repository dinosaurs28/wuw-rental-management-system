import { useState } from "react";
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
  Banknote,
  CreditCard,
  Wallet,
  Clock,
} from "lucide-react";

import { cn, compressImage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { BookingPaymentPanel } from "@/components/manager/payment/BookingPaymentPanel";
import { ExtendBookingModal } from "@/components/employee/extension/ExtendBookingModal";
import { ExtensionHistoryPanel } from "@/components/employee/extension/ExtensionHistoryPanel";

import apiClient from "@/lib/axios";
import { bookingService } from "@/services/booking.service";
import { kycService } from "@/services/kyc.service";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import {
  PickupImageCard,
  type UploadedImage,
} from "@/components/employee/PickupImageCard";

interface CaptureField { name: string; required: boolean; }
interface CaptureConfig { publicId: string; fields: CaptureField[]; category: { name: string }; }

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

const isImageFile = (mime: string): boolean => {
  return mime.startsWith("image/");
};

// --- VALIDATION SCHEMA ---
const handoverSchema = z.object({
  odo: z
    .number({ invalid_type_error: "Must be a number" })
    .min(0, "Odometer must be positive"),
  fuelLevel: z.string({ required_error: "Fuel level is required" }), // Select returns string
  requireManagerConfirmation: z.boolean().optional(),
});

type HandoverFormValues = z.infer<typeof handoverSchema>;

export default function StaffPickupsPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"CASH" | "ONLINE" | null>(null);
  const [payRemainingNow, setPayRemainingNow] = useState<boolean | null>(null);
  const [onlinePaymentUrl, setOnlinePaymentUrl] = useState<string | null>(null);
  // Labeled capture slots: { [fieldName]: UploadedImage | null }
  const [captureSlots, setCaptureSlots] = useState<Record<string, UploadedImage | null>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [showExtendModal, setShowExtendModal] = useState(false);

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
      apiClient.get(`/employee/pickup/${bookingId}/capture-config`).then((r) => r.data),
    enabled: !!bookingId,
    retry: false,
  });
  const captureConfig = captureConfigData?.config ?? null;

  // --- MUTATIONS ---
  const verifyKycMutation = useMutation({
    mutationFn: ({
      kycId,
      status,
    }: {
      kycId: string;
      status: "APPROVED" | "REJECTED";
    }) => kycService.verifyKyc(kycId, status),
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
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] }); // To update status banner
      navigate("/employee/dashboard");
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || "Failed to confirm handover",
      );
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
      toast.success("Image deleted successfully");
      setDeletingImageId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to delete image");
      setDeletingImageId(null);
    },
  });

  const remainingPaymentMutation = useMutation({
    mutationFn: (method: "CASH" | "ONLINE") =>
      bookingService.initiateRemainingPayment(bookingId!, "pickup", { method }),
    onSuccess: (data, method) => {
      if (method === "ONLINE" && data.paymentURL) {
        setOnlinePaymentUrl(data.paymentURL);
        return;
      }
      toast.success("Remaining payment collected!");
      setShowPaymentDialog(false);
      setPayRemainingNow(true);
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Payment failed");
    },
  });

  // --- FORM SETUP ---
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<HandoverFormValues>({
    resolver: zodResolver(handoverSchema),
    defaultValues: {
      fuelLevel: "", // Force selection
      requireManagerConfirmation: false,
    },
    mode: "onChange",
  });

  // --- DERIVED STATE ---
  const kycDocs = kycData?.kyc || [];
  const areAllDocsApproved =
    kycDocs.length > 0 && kycDocs.every((doc) => doc.status === "APPROVED");
  // Ensure booking exists before accessing properties
  const isHandoverReady =
    areAllDocsApproved && watch("odo") > 0 && watch("fuelLevel") !== "";
  const isPickedUp = booking?.status === "PICKED_UP";

  // --- HANDLERS ---
  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setIsUploading(true);
    try {
      // Compress image if it's a camera blob/high-res photo
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

  // --- FORMAT DATE ---
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // --- HELPERS ---
  const formatPrice = (amount: string | number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
    }).format(Number(amount));
  };

  // --- HANDLERS ---
  const onConfirmHandover = (data: HandoverFormValues) => {
    if (captureConfig) {
      // Check all required fields are uploaded
      const missing = captureConfig.fields
        .filter((f) => f.required && !captureSlots[f.name])
        .map((f) => f.name);
      if (missing.length > 0) {
        toast.error(`Missing required photos: ${missing.join(", ")}`);
        return;
      }
      const captureImages = Object.entries(captureSlots)
        .filter(([, img]) => img !== null)
        .map(([label, img]) => ({ fileId: img!.fileId, label }));
      handoverMutation.mutate({
        odo: data.odo,
        fuelLevel: parseInt(data.fuelLevel),
        captureImages: captureImages.length > 0 ? captureImages : undefined,
        requireManagerConfirmation: data.requireManagerConfirmation,
        payRemainingAtPickup: payRemainingNow ?? false,
      } as any);
    } else {
      const imageIds = uploadedImages.map((img) => img.fileId);
      handoverMutation.mutate({
        odo: data.odo,
        fuelLevel: parseInt(data.fuelLevel),
        pickupImageIds: imageIds.length > 0 ? imageIds : undefined,
        requireManagerConfirmation: data.requireManagerConfirmation,
        payRemainingAtPickup: payRemainingNow ?? false,
      } as any);
    }
  };

  // Upload a photo for a specific capture field slot
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

  if (isLoadingBooking || isLoadingKyc) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <DashboardNavbar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
                Create sure the Booking ID is correct.
              </p>
              <Button asChild onClick={() => navigate("/employee/dashboard")}>
                <Link to="/employee/dashboard">Back to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const vehicle = booking.items[0]?.vehicle;
  const customer = booking.customer.user;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />

      <main className="container max-w-7xl mx-auto py-6 px-4 md:px-6 space-y-8">
        {/* 1. Breadcrumb */}
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
              <BreadcrumbPage>Pickups</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{booking.publicId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Staff Vehicle Handover
            </h1>
            <p className="text-muted-foreground">
              Final inspection and customer verification
            </p>
          </div>
        </div>

        {/* Status Banner */}
        {isPickedUp && (
          <div className="bg-green-100 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Status: PICKED UP</span>
            <span className="ml-auto text-sm">
              Vehicle has been handed over successfully.
            </span>
          </div>
        )}

        {/* Advance Payment Banner */}
        {booking.isAdvancePayment && !isPickedUp && (
          <div className={`border px-4 py-3 rounded-md ${booking.remainingPaidAt ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2">
                <Wallet className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {booking.remainingPaidAt ? "Remaining Payment Collected" : "Advance Booking — Remaining Balance Due"}
                  </p>
                  <p className="text-sm mt-0.5">
                    {booking.remainingPaidAt
                      ? `₹${booking.remainingBalance} collected. Ready for handover.`
                      : `Remaining balance: ${formatPrice(booking.remainingBalance ?? "0")}. Ask customer: pay now or at return?`}
                  </p>
                </div>
              </div>
              {!booking.remainingPaidAt && payRemainingNow === null && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-800 hover:bg-amber-100"
                    onClick={() => setShowPaymentDialog(true)}
                  >
                    Pay Now
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-800 hover:bg-amber-100"
                    onClick={() => setPayRemainingNow(false)}
                  >
                    Pay at Return
                  </Button>
                </div>
              )}
              {!booking.remainingPaidAt && payRemainingNow === false && (
                <div className="flex items-center gap-1 text-sm text-amber-700 shrink-0">
                  <Clock className="h-4 w-4" />
                  Pay at return
                </div>
              )}
            </div>
          </div>
        )}

        {/* Remaining Payment Dialog */}
        <Dialog open={showPaymentDialog} onOpenChange={(open) => {
          setShowPaymentDialog(open);
          if (!open) { setOnlinePaymentUrl(null); setSelectedPaymentMethod(null); }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Collect Remaining Payment</DialogTitle>
              <DialogDescription>
                Amount due: <strong>{formatPrice(booking.remainingBalance ?? "0")}</strong>.
                Select payment method.
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
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                      selectedPaymentMethod === method
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
                setShowPaymentDialog(false);
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

        {/* Payment Section */}
        <BookingPaymentPanel bookingPublicId={booking.publicId} role="employee" />

        {/* Extension Section */}
        {(booking.status === "CONFIRMED" || booking.status === "PICKED_UP") && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">
                Rental Extension
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-orange-200 text-orange-700 hover:bg-orange-50"
                onClick={() => setShowExtendModal(true)}
              >
                <Clock className="h-4 w-4" />
                Extend Booking
              </Button>
            </div>
            <ExtensionHistoryPanel bookingPublicId={booking.publicId} role="employee" />
          </div>
        )}

        {showExtendModal && (
          <ExtendBookingModal
            open={showExtendModal}
            bookingPublicId={booking.publicId}
            currentEndAt={booking.endAt}
            role="employee"
            onClose={() => setShowExtendModal(false)}
            onSuccess={() => {
              setShowExtendModal(false);
              queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
              queryClient.invalidateQueries({ queryKey: ["extensions", booking.publicId] });
            }}
          />
        )}

        <div className="grid lg:grid-cols-2 gap-8">
          {/* LEFT COLUMN */}
          <div className="space-y-6">
            {/* A. Customer Details Card */}
            <Card className="shadow-sm border-gray-200">
              <CardHeader className="pb-3 border-b bg-gray-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-muted-foreground" />
                  Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Customer Name
                    </p>
                    <p className="font-semibold text-gray-900">
                      {customer.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Booking ID
                    </p>
                    <p className="font-mono text-gray-700">
                      {booking.publicId}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Vehicle
                    </p>
                    <p className="font-medium">
                      {vehicle?.make} {vehicle?.model}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {vehicle?.regNo}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Period
                    </p>
                    <div className="text-sm flex flex-col">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />{" "}
                        {formatDate(booking.startAt)}
                      </span>
                      <span className="text-muted-foreground pl-4">to</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />{" "}
                        {formatDate(booking.endAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* B. KYC Document Verification Card */}
            <Card className="shadow-sm border-gray-200">
              <CardHeader className="pb-3 border-b bg-gray-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  KYC Verification
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {kycDocs.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No documents uploaded yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {kycDocs.map((doc) => {
                      const isImage = isImageFile(doc.file.mime);
                      const fileName =
                        doc.file.url.split("/").pop()?.split("?")[0] ||
                        "Document";

                      return (
                        <div
                          key={doc.publicId}
                          className="group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/30"
                        >
                          {/* Thumbnail / Preview */}
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

                            {/* Status Badge */}
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

                            {/* View Overlay Button */}
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

                          {/* Info & Actions */}
                          <div className="p-3 bg-white flex flex-col gap-3">
                            <div>
                              <p className="font-medium text-sm text-foreground truncate">
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
                                  className="h-8 flex-1 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200"
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
                                  className="h-8 flex-1 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border-red-200"
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
            </Card>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6">
            {/* A. Vehicle Inspection Section */}
            <Card className="shadow-sm border-gray-200">
              <CardHeader className="pb-3 border-b bg-gray-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Car className="h-5 w-5 text-muted-foreground" />
                  Vehicle Inspection
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <form className="space-y-6">
                  <div className="space-y-3">
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
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      )}
                    />
                    {errors.odo && (
                      <p className="text-xs text-red-500">
                        {errors.odo.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="fuelLevel" className="text-sm font-medium">
                      Fuel Level
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
                            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(
                              (level) => (
                                <SelectItem
                                  key={level}
                                  value={level.toString()}
                                >
                                  {level}%
                                </SelectItem>
                              ),
                            )}
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

                  {/* Pickup Images Section */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Vehicle Photos
                      {captureConfig && (
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          ({captureConfig.category.name})
                        </span>
                      )}
                    </Label>

                    {captureConfig ? (
                      /* ── Labeled capture slots ── */
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
                                      onClick={() => handleCaptureSlotDelete(field.name, slot.fileId)}
                                      className="absolute top-1 right-1 bg-zinc-100/80 rounded-full p-0.5 text-zinc-700 hover:bg-zinc-200"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <label
                                  className={`flex flex-col items-center justify-center h-28 cursor-pointer gap-1 text-muted-foreground hover:bg-gray-100 transition-colors ${isPickedUp ? "cursor-default opacity-50" : ""}`}
                                >
                                  {isUploadingThis ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                  ) : (
                                    <ImageIcon className="h-5 w-5 opacity-50" />
                                  )}
                                  <span className="text-xs">{isUploadingThis ? "Uploading…" : "Tap to upload"}</span>
                                  {!isPickedUp && (
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleCaptureSlotUpload(field.name, f);
                                        e.target.value = "";
                                      }}
                                    />
                                  )}
                                </label>
                              )}
                              <div className="px-2 py-1.5 bg-white border-t flex items-center gap-1">
                                <span className="text-xs font-medium truncate">{field.name}</span>
                                {field.required && (
                                  <span className="text-orange-500 text-xs shrink-0">*</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* ── Fallback: simple unstructured upload ── */
                      <>
                        <p className="text-xs text-muted-foreground">
                          Upload photos of the vehicle before handover
                        </p>
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
                  </div>

                  {!isPickedUp && (
                    <div className="pt-4 space-y-4">
                      {/* Manager Confirmation Checkbox */}
                      <Controller
                        name="requireManagerConfirmation"
                        control={control}
                        render={({ field }) => (
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="requireManagerConfirmation"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                            <Label htmlFor="requireManagerConfirmation" className="text-sm font-medium cursor-pointer">
                              Confirm with Manager Before Final Pickup
                            </Label>
                          </div>
                        )}
                      />

                      <Dialog
                        open={isConfirmOpen}
                        onOpenChange={setIsConfirmOpen}
                      >
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-12 text-base font-semibold"
                            disabled={
                              !isHandoverReady || handoverMutation.isPending
                            }
                          >
                            {handoverMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                                Processing...
                              </>
                            ) : (
                              "Confirm Handover"
                            )}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Confirm Vehicle Handover</DialogTitle>
                            <DialogDescription>
                              Are you sure the documents and vehicle condition
                              match the customer details?
                              <br />
                              This action cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter className="mt-4">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setIsConfirmOpen(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              className="bg-[#FF5F00] hover:bg-[#e65600]"
                              onClick={handleSubmit(onConfirmHandover)}
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

                      {!isHandoverReady && (
                        <p className="text-xs text-center text-muted-foreground mt-3">
                          Complete KYC verification and vehicle details to
                          proceed
                        </p>
                      )}
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Enhanced Document Preview Dialog */}
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
                        className="text-orange-600 hover:text-orange-700 hover:underline"
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
      </main>
    </div>
  );
}
