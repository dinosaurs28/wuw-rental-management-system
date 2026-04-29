import { useEffect, useState } from "react";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { Shield, Users, ArrowLeft, Car } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

import { VehicleImageGallery } from "@/components/vehicles/VehicleImageGallery";
import { EmployeeVehiclePricingCard } from "@/components/vehicles/EmployeeVehiclePricingCard";
import { KycDocumentList } from "@/components/booking/KycDocumentList";
import { UploadKycDialog } from "@/components/booking/UploadKycDialog";
import { CompleteProfileDialog } from "@/components/booking/CompleteProfileDialog";

import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import { customerSession as sessionUtils } from "@/utils/customerSession";
import { kycService, type KycDocument } from "@/services/kyc.service";
import { employeeService } from "@/services/employee.service";
import type { VehicleGroupDetails } from "@/services/vehicle.service";

export const EmployeeVehicleGroupDetailsPage = () => {
  const { groupKey: encodedGroupKey } = useParams<{ groupKey: string }>();
  const groupKey = decodeURIComponent(encodedGroupKey ?? "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customerSession = sessionUtils.get();

  const {
    startDate,
    endDate,
    startTime,
    endTime,
    setGroupKey,
    paymentType,
    customerKycId,
    setCustomerKycId,
  } = useEmployeeBookingStore();

  const [kycDocuments, setKycDocuments] = useState<KycDocument[]>([]);
  const [isLoadingKyc, setIsLoadingKyc] = useState(true);
  const [selectedKycId, setSelectedKycId] = useState<string | null>(customerKycId);
  const [showUploadKyc, setShowUploadKyc] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [showCompleteProfile, setShowCompleteProfile] = useState(false);
  const [_, setSessionKey] = useState(0);

  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");

  const startDateTime =
    urlStart ||
    (startDate
      ? `${format(new Date(startDate), "yyyy-MM-dd")}T${startTime || "10:00"}`
      : null);
  const endDateTime =
    urlEnd ||
    (endDate
      ? `${format(new Date(endDate), "yyyy-MM-dd")}T${endTime || "10:00"}`
      : null);

  const { data: groupResponse, isLoading, isRefetching, error } = useQuery({
    queryKey: ["employee-vehicle-group", groupKey, startDateTime, endDateTime],
    queryFn: () =>
      employeeService.getVehicleGroupDetails(
        groupKey,
        startDateTime ?? undefined,
        endDateTime ?? undefined,
      ),
    enabled: !!groupKey,
    staleTime: 30 * 1000,
  });

  const group: VehicleGroupDetails | null = groupResponse?.data ?? null;

  useEffect(() => {
    if (!customerSession) {
      toast.error("No active customer session found");
      navigate("/employee/new-booking");
    }
  }, [customerSession, navigate]);

  useEffect(() => {
    if (group && groupKey) {
      setGroupKey(groupKey);
    }
  }, [group, groupKey, setGroupKey]);

  const fetchKycDocuments = async () => {
    if (!customerSession) return;
    setIsLoadingKyc(true);
    setKycError(null);
    try {
      const response = await kycService.getCustomerKyc(customerSession.publicId);
      setKycDocuments(response.data);
      if (!customerKycId) {
        const approvedDoc = response.data.find((d) => d.status === "APPROVED");
        if (approvedDoc) {
          setSelectedKycId(approvedDoc.publicId);
          setCustomerKycId(approvedDoc.publicId);
        }
      } else {
        const storedDoc = response.data.find((d) => d.publicId === customerKycId);
        if (storedDoc) setSelectedKycId(storedDoc.publicId);
      }
    } catch {
      setKycError("Failed to load customer documents. Please try again.");
      toast.error("Failed to load customer documents");
    } finally {
      setIsLoadingKyc(false);
    }
  };

  useEffect(() => {
    if (customerSession?.publicId) fetchKycDocuments();
  }, [customerSession?.publicId]);

  const handleKycSelect = (doc: KycDocument) => {
    setSelectedKycId(doc.publicId);
    setCustomerKycId(doc.publicId);
  };

  const handleDeleteKyc = async (doc: KycDocument) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      await kycService.deleteWalkinKyc(doc.publicId);
      toast.success("Document deleted successfully");
      fetchKycDocuments();
      if (selectedKycId === doc.publicId) {
        setSelectedKycId(null);
        setCustomerKycId(null);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete document");
    }
  };

  const handleBookVehicle = () => {
    if (!group || !customerSession) {
      toast.error("Missing group or session details");
      return;
    }
    if (!startDate || !endDate) {
      toast.error("Please select booking dates");
      return;
    }
    if (!customerKycId) {
      toast.error("Please select a KYC document");
      document.getElementById("kyc-section")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const payload = {
      group_key: groupKey,
      customer_public_id: customerSession.publicId,
      customer_kyc_id: customerKycId,
      start: startDateTime || format(new Date(startDate!), "yyyy-MM-dd"),
      end: endDateTime || format(new Date(endDate!), "yyyy-MM-dd"),
      payment_type: paymentType || "CASH",
    };

    navigate("/employee/booking/summary", { state: { bookingPayload: payload } });
  };

  const handleProfileComplete = () => {
    const updatedSession = sessionUtils.get();
    if (updatedSession) {
      setSessionKey((prev) => prev + 1);
      fetchKycDocuments();
    }
  };

  // Build a VehicleDetails-compatible shape for EmployeeVehiclePricingCard
  const pricingCardVehicle = group
    ? {
        publicId: groupKey,
        make: group.make,
        model: group.model,
        year: 0,
        regNo: "",
        odo: 0,
        status: "AVAILABLE" as const,
        availability: group.availability,
        categoryId: 0,
        branchId: "",
        branch: group.branch,
        images: [],
        baseDailyPrice: group.pricing.daily ?? 0,
        pricing: { daily: group.pricing.daily ?? 0 },
        deposit: group.deposit,
        pricingDetails: group.pricingDetails,
      }
    : null;

  if (isLoading || !customerSession) {
    return (
      <div className="container mx-auto px-4 py-8 space-y-8">
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Skeleton className="h-[400px] w-full rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-[500px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-zinc-900 mb-2">Group Not Found</h2>
        <p className="text-zinc-600 mb-6">No vehicles found for this group.</p>
        <Button onClick={() => navigate("/employee/vehicles")}>Return to Vehicles</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-20">
      <header className="sticky top-0 z-30 w-full bg-white border-b border-zinc-200 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/employee/vehicles")}
            className="-ml-2"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex-1">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild className="text-zinc-500 hover:text-zinc-900">
                    <Link to="/employee/new-booking">Customer</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild className="text-zinc-500 hover:text-zinc-900">
                    <Link to="/employee/vehicles">Vehicles</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-semibold text-zinc-900">
                    {group.make} {group.model}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Mobile title */}
            <div className="lg:hidden space-y-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-zinc-900">
                  {group.make} {group.model}
                </h1>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">
                  {group.availableCount} available
                </Badge>
              </div>
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-700">
                {group.category}
              </Badge>
            </div>

            {/* Gallery */}
            {group.images.length > 0 ? (
              <VehicleImageGallery
                images={group.images}
                vehicleName={`${group.make} ${group.model}`}
              />
            ) : (
              <div className="w-full aspect-[4/3] bg-zinc-100 rounded-xl flex items-center justify-center">
                <Car className="size-16 text-zinc-400" />
              </div>
            )}

            {/* Desktop title */}
            <div className="hidden lg:block space-y-4">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-zinc-900">
                  {group.make} {group.model}
                </h1>
                <Badge className="bg-emerald-100 text-emerald-700 border-0 text-sm px-3 py-1">
                  {group.availableCount} unit{group.availableCount !== 1 ? "s" : ""} available
                </Badge>
              </div>
              <Badge variant="secondary" className="px-3 py-1 text-sm bg-zinc-100 text-zinc-700">
                {group.category}
              </Badge>
            </div>

            {/* KYC Section */}
            <div id="kyc-section" className="space-y-4 pt-6 border-t border-zinc-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-zinc-900 flex items-center gap-2">
                  <Shield className="size-5 text-orange-600" />
                  Employee Verified KYC
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchKycDocuments()}
                  disabled={isLoadingKyc}
                >
                  Refresh
                </Button>
              </div>

              {customerSession && !customerSession.profileCompleted ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="p-3 bg-amber-100 rounded-full">
                      <Users className="size-6 text-amber-600" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-amber-900">Profile Incomplete</h3>
                    <p className="text-amber-700 max-w-sm mx-auto mt-1">
                      Customer profile details are missing. Please complete the profile to proceed with KYC document upload.
                    </p>
                  </div>
                  <Button onClick={() => setShowCompleteProfile(true)}>Complete Profile</Button>
                </div>
              ) : kycError ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                  <p className="text-red-600 mb-2">{kycError}</p>
                  <Button variant="outline" size="sm" onClick={() => fetchKycDocuments()}>
                    Try Again
                  </Button>
                </div>
              ) : (
                <KycDocumentList
                  documents={kycDocuments}
                  isLoading={isLoadingKyc}
                  selectedId={selectedKycId}
                  onSelect={handleKycSelect}
                  onDelete={handleDeleteKyc}
                  onUploadClick={() => setShowUploadKyc(true)}
                  error={null}
                  pendingCount={kycDocuments.filter((d) => d.status === "PENDING").length}
                />
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 space-y-6">
              {pricingCardVehicle && (
                <EmployeeVehiclePricingCard
                  vehicle={pricingCardVehicle as any}
                  onBookVehicle={handleBookVehicle}
                  isRefetching={isRefetching}
                  disabled={
                    isLoading ||
                    (customerSession ? !customerSession.profileCompleted : true)
                  }
                />
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                <Shield className="size-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-900 text-sm">
                    Booking for {customerSession.name}
                  </p>
                  <p className="text-blue-700 text-xs mt-1">
                    Phone: {customerSession.phone} <br />
                    Public ID: {customerSession.publicId.slice(0, 8)}...
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {customerSession && (
          <UploadKycDialog
            open={showUploadKyc}
            onOpenChange={setShowUploadKyc}
            customerPublicId={customerSession.publicId}
            onSuccess={() => fetchKycDocuments()}
          />
        )}

        {customerSession && (
          <CompleteProfileDialog
            open={showCompleteProfile}
            onOpenChange={setShowCompleteProfile}
            customer={customerSession}
            onSuccess={handleProfileComplete}
          />
        )}
      </main>
    </div>
  );
};
