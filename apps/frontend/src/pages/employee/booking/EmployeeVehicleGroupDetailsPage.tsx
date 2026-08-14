import { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { Shield, Users, ArrowLeft, Car } from "lucide-react";
import { format } from "date-fns";
import { getCurrentTime } from "@/utils/formatters";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
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
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";

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
      ? `${format(new Date(startDate), "yyyy-MM-dd")}T${startTime || getCurrentTime()}`
      : null);
  const endDateTime =
    urlEnd ||
    (endDate
      ? `${format(new Date(endDate), "yyyy-MM-dd")}T${endTime || getCurrentTime()}`
      : null);

  const isDateRangeValid =
    !startDateTime || !endDateTime
      ? true
      : new Date(endDateTime) > new Date(startDateTime);

  // Keep last valid datetimes so the query key stays stable when range is invalid
  const lastValidStart = useRef(startDateTime);
  const lastValidEnd   = useRef(endDateTime);
  if (isDateRangeValid) {
    lastValidStart.current = startDateTime;
    lastValidEnd.current   = endDateTime;
  }

  const { data: groupResponse, isLoading, isRefetching, error } = useQuery({
    queryKey: ["employee-vehicle-group", groupKey, lastValidStart.current, lastValidEnd.current],
    queryFn: () =>
      employeeService.getVehicleGroupDetails(
        groupKey,
        lastValidStart.current ?? undefined,
        lastValidEnd.current ?? undefined,
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

      // Auto-select only complete document types (both FRONT and BACK present)
      const docs = response.data;
      const completeTypeFront = ["DL", "AADHAAR", "PAN"].reduce<KycDocument | null>((found, type) => {
        if (found) return found;
        const front = docs.find((d) => d.type === type && d.side === "FRONT");
        const back = docs.find((d) => d.type === type && d.side === "BACK");
        return front && back ? front : null;
      }, null);

      if (!customerKycId && completeTypeFront) {
        setSelectedKycId(completeTypeFront.publicId);
        setCustomerKycId(completeTypeFront.publicId);
      } else if (customerKycId) {
        const storedDoc = docs.find((d) => d.publicId === customerKycId);
        if (storedDoc) setSelectedKycId(storedDoc.publicId);
        else {
          // Previously stored doc no longer exists — clear
          setSelectedKycId(null);
          setCustomerKycId(null);
        }
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

  // A type is complete when both FRONT and BACK sides exist
  const hasCompleteKyc = (() => {
    if (!selectedKycId) return false;
    return ["DL", "AADHAAR", "PAN"].some((type) => {
      const front = kycDocuments.find((d) => d.type === type && d.side === "FRONT");
      const back = kycDocuments.find((d) => d.type === type && d.side === "BACK");
      return front && back && front.publicId === selectedKycId;
    });
  })();

  const handleBookVehicle = () => {
    if (!group || !customerSession) {
      toast.error("Missing group or session details");
      return;
    }
    if (!startDate || !endDate) {
      toast.error("Please select booking dates");
      return;
    }
    if (!customerKycId || !hasCompleteKyc) {
      toast.error("Please upload both front and back sides of a KYC document");
      document.getElementById("kyc-section")?.scrollIntoView({ behavior: "smooth" });
      setShowUploadKyc(true);
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
      <div className="min-h-screen bg-[#F5F5F5]">
        <DashboardNavbar />
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3 space-y-6">
              <Skeleton className="h-[340px] w-full rounded-xl" />
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-[200px] w-full rounded-xl" />
            </div>
            <div className="lg:col-span-2">
              <Skeleton className="h-[520px] w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <DashboardNavbar />
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-16 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
            <Car className="size-8 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold text-black mb-2">Group Not Found</h2>
          <p className="text-[#666666] mb-6">No vehicles found for this group.</p>
          <Button
            onClick={() => navigate("/employee/vehicles")}
            className="bg-[#FF5F00] hover:bg-[#e55500] text-white"
          >
            Return to Vehicles
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <DashboardNavbar />

      {/* Sub-header / Breadcrumb */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-12 flex items-center gap-3">
          <button
            onClick={() => navigate("/employee/vehicles")}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 transition-colors -ml-1"
          >
            <ArrowLeft className="size-4 text-[#666666]" />
          </button>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="text-[#999999] hover:text-black text-sm">
                  <Link to="/employee/new-booking">Customer</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="text-[#999999] hover:text-black text-sm">
                  <Link to="/employee/vehicles">Vehicles</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-sm font-semibold text-black">
                  {group.make} {group.model}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">

          {/* ── Left column: gallery → title → customer → KYC ── */}
          <div className="lg:col-span-3 space-y-5">

            {/* Gallery */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {group.images.length > 0 ? (
                <VehicleImageGallery
                  images={group.images}
                  vehicleName={`${group.make} ${group.model}`}
                />
              ) : (
                <div className="w-full aspect-[16/9] bg-gray-50 flex items-center justify-center">
                  <Car className="size-16 text-gray-300" />
                </div>
              )}
            </div>

            {/* Vehicle title + badges */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-black leading-tight">
                    {group.make} {group.model}
                  </h1>
                  <p className="text-[#666666] text-sm mt-1">{group.category}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  {group.availableCount} unit{group.availableCount !== 1 ? "s" : ""} available
                </span>
              </div>
            </div>

            {/* Customer info */}
            <div
              className="rounded-xl border p-4 flex items-center gap-4"
              style={{ background: "rgba(255,95,0,0.04)", borderColor: "rgba(255,95,0,0.2)" }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ background: "#FF5F00" }}
              >
                {customerSession.name?.charAt(0)?.toUpperCase() || "C"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-black text-sm">{customerSession.name}</p>
                <p className="text-[#666666] text-xs mt-0.5">
                  {customerSession.phone} &middot; ID: {customerSession.publicId.slice(0, 8)}…
                </p>
              </div>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                style={{ background: "rgba(255,95,0,0.1)", color: "#FF5F00" }}
              >
                Active Session
              </span>
            </div>

            {/* ── KYC Section ── */}
            <div id="kyc-section" className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-black flex items-center gap-2">
                  <Shield className="size-4" style={{ color: "#FF5F00" }} />
                  KYC Document
                </h2>
                <button
                  onClick={() => fetchKycDocuments()}
                  disabled={isLoadingKyc}
                  className="text-xs font-medium text-[#666666] hover:text-black px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              <div className="p-5">
                {customerSession && !customerSession.profileCompleted ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-center space-y-3">
                    <div className="flex justify-center">
                      <div className="p-3 bg-amber-100 rounded-full">
                        <Users className="size-5 text-amber-600" />
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-amber-900">Profile Incomplete</h3>
                      <p className="text-amber-700 text-sm mt-1 max-w-sm mx-auto">
                        Customer profile is missing required details. Complete the profile to upload KYC documents.
                      </p>
                    </div>
                    <Button
                      onClick={() => setShowCompleteProfile(true)}
                      className="bg-[#FF5F00] hover:bg-[#e55500] text-white"
                    >
                      Complete Profile
                    </Button>
                  </div>
                ) : kycError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <p className="text-red-600 text-sm mb-3">{kycError}</p>
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
          </div>

          {/* ── Right column: sticky pricing card ── */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-[calc(3.5rem+3rem+1rem)] space-y-4">
              {pricingCardVehicle && (
                <EmployeeVehiclePricingCard
                  vehicle={pricingCardVehicle as any}
                  onBookVehicle={handleBookVehicle}
                  isRefetching={isRefetching}
                  disabled={
                    isLoading ||
                    (customerSession ? !customerSession.profileCompleted : true)
                  }
                  hasCompleteKyc={hasCompleteKyc}
                />
              )}
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
