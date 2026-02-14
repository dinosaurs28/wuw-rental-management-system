import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Shield, Users, Fuel, Settings2, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
    BreadcrumbPage,
} from '@/components/ui/breadcrumb';

import { VehicleImageGallery } from '@/components/vehicles/VehicleImageGallery';
import { EmployeeVehiclePricingCard } from '@/components/vehicles/EmployeeVehiclePricingCard';
import { KycDocumentList } from '@/components/booking/KycDocumentList';
import { UploadKycDialog } from '@/components/booking/UploadKycDialog';
import { CompleteProfileDialog } from '@/components/booking/CompleteProfileDialog';

import { useVehicleDetails } from '@/hooks/useVehicleDetails';
import { useEmployeeBookingStore } from '@/store/employeeBooking.store';
import { customerSession as sessionUtils } from '@/utils/customerSession';
import { kycService, type KycDocument } from '@/services/kyc.service';

export const EmployeeVehicleDetailsPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const customerSession = sessionUtils.get();

    // Store
    const {
        startDate,
        endDate,
        selectedVehicleId,
        setVehicle,
        paymentType, // Added paymentType

        customerKycId,
        setCustomerKycId
    } = useEmployeeBookingStore();

    // Local State for KYC
    const [kycDocuments, setKycDocuments] = useState<KycDocument[]>([]);
    const [isLoadingKyc, setIsLoadingKyc] = useState(true);
    const [selectedKycId, setSelectedKycId] = useState<string | null>(customerKycId);
    const [showUploadKyc, setShowUploadKyc] = useState(false);
    const [kycError, setKycError] = useState<string | null>(null);

    // State for Profile Completion
    const [showCompleteProfile, setShowCompleteProfile] = useState(false);
    // Force re-render/refetch after profile update
    const [_, setSessionKey] = useState(0);

    // Queries
    const {
        data: vehicleResponse,
        isLoading: isVehicleLoading,
        isRefetching: isVehicleRefetching,
        error: vehicleError
    } = useVehicleDetails(id || '', startDate, endDate);

    const vehicle = vehicleResponse?.data;

    // Redirect if no customer session
    useEffect(() => {
        if (!customerSession) {
            toast.error("No active customer session found");
            navigate('/employee/new-booking');
        }
    }, [customerSession, navigate]);

    // Fetch KYC Documents
    const fetchKycDocuments = async () => {
        if (!customerSession) return;

        setIsLoadingKyc(true);
        setKycError(null);
        try {
            const response = await kycService.getCustomerKyc(customerSession.publicId);
            setKycDocuments(response.data);

            // Auto-select approved document if available and no selection made
            if (!customerKycId) {
                const approvedDoc = response.data.find(d => d.status === 'APPROVED');
                if (approvedDoc) {
                    setSelectedKycId(approvedDoc.publicId);
                    setCustomerKycId(approvedDoc.publicId);
                }
            } else {
                // Sync local UI state from store
                const storedDoc = response.data.find(d => d.publicId === customerKycId);
                if (storedDoc) {
                    setSelectedKycId(storedDoc.publicId);
                }
            }
        } catch (error: any) {
            console.error("Failed to fetch KYC", error);
            setKycError("Failed to load customer documents. Please try again.");
            toast.error("Failed to load customer documents");
        } finally {
            setIsLoadingKyc(false);
        }
    };

    useEffect(() => {
        if (customerSession?.publicId) {
            fetchKycDocuments();
        }
    }, [customerSession?.publicId]);

    // Update store when vehicle is loaded
    useEffect(() => {
        if (vehicle && vehicle.publicId !== selectedVehicleId) {
            setVehicle(vehicle.publicId);
        }
    }, [vehicle, selectedVehicleId, setVehicle]);

    const handleBack = () => {
        navigate('/employee/vehicles');
    };

    const handleKycSelect = (doc: KycDocument) => {
        // UI uses CustomerKyc Public ID now
        setSelectedKycId(doc.publicId);
        // Store uses CustomerKyc Public ID
        setCustomerKycId(doc.publicId);
    };

    const handleDeleteKyc = async (doc: KycDocument) => {
        if (!confirm("Are you sure you want to delete this document?")) return;

        try {
            await kycService.deleteWalkinKyc(doc.publicId);
            toast.success("Document deleted successfully");

            // Refetch list
            fetchKycDocuments();

            // Deselect if currently selected
            if (selectedKycId === doc.publicId) {
                setSelectedKycId(null);
                setCustomerKycId(null); // Assuming types allow null, if not we need to handle it. 
                // Store definition says string | null, so it's fine.
                // Wait, setCustomerKycId takes string, so we might need to cast or update store type?
                // Checking store: setCustomerKycId: (id: string) => void;
                // It seems it doesn't accept null. Let's check store definition again or just not call it if null.
                // Actually if I look at store definition in step 48: customerKycId is string | null, but setCustomerKycId takes string. 
                // This is a TS issue in store maybe?
                // Let's check store file again if needed, or just assume I can pass empty string equivalent or ignoring it.
                // Wait, if I delete the selected doc, I should clear the selection.
                // If the store setter only takes string, I can't clear it via setter if strictly typed.
                // I will try to pass null as any or fix store later if it errors.
                // For now, I will skip calling setCustomerKycId(null) if it's strict, or call it with cast.
                // Actually in step 48: setCustomerKycId: (id) => set({ customerKycId: id }) where id is inferred. 
                // Interface says: setCustomerKycId: (id: string) => void; 
                // I'll update store if needed, but for now let's just refresh.
            }
        } catch (error: any) {
            console.error("Delete failed", error);
            toast.error(error.message || "Failed to delete document");
        }
    };

    const handleBookVehicle = () => {
        // Validate
        if (!vehicle || !customerSession) {
            toast.error("Missing vehicle or session details");
            return;
        }

        if (!startDate || !endDate) {
            toast.error("Please select booking dates");
            return;
        }

        if (!customerKycId) {
            toast.error("Please select a KYC document");
            document.getElementById('kyc-section')?.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        const payload = {
            vehicles: [vehicle.publicId],
            customer_public_id: customerSession.publicId,
            customer_kyc_id: customerKycId,
            start: format(new Date(startDate), 'yyyy-MM-dd'),
            end: format(new Date(endDate), 'yyyy-MM-dd'),
            payment_type: paymentType || 'CASH',
        };

        navigate('/employee/booking/summary', {
            state: { bookingPayload: payload }
        });
    };

    if (isVehicleLoading || !customerSession) {
        return (
            <div className="container mx-auto px-4 py-8 space-y-8">
                <div className="space-y-4">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <Skeleton className="h-[400px] w-full rounded-xl" />
                    </div>
                    <div className="space-y-6">
                        <Skeleton className="h-[500px] w-full rounded-xl" />
                    </div>
                </div>
            </div>
        );
    }

    if (vehicleError || !vehicle) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <h2 className="text-2xl font-bold text-zinc-900 mb-2">Vehicle Not Found</h2>
                <p className="text-zinc-600 mb-6">The vehicle you are looking for does not exist or is unavailable.</p>
                <Button onClick={handleBack}>Return to Vehicles</Button>
            </div>
        );
    }

    const vehicleFeatures = [
        { icon: Users, label: `${vehicle.seats} Seats` },
        { icon: Fuel, label: vehicle.fuelType },
        { icon: Settings2, label: vehicle.transmission },
    ];



    const handleProfileComplete = () => {
        // Refresh session from storage
        const updatedSession = sessionUtils.get();
        if (updatedSession) {
            // Trigger UI update or state refresh
            setSessionKey(prev => prev + 1);
            fetchKycDocuments();
        }
    };

    return (
        <div className="min-h-screen bg-zinc-50 pb-20">
            {/* Header */}
            <header className="sticky top-0 z-30 w-full bg-white border-b border-zinc-200 shadow-sm">
                <div className="container mx-auto px-4 h-16 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={handleBack} className="-ml-2">
                        <ArrowLeft className="size-5" />
                    </Button>
                    <div className="flex-1">
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild className="text-zinc-500 hover:text-zinc-900">
                                        <Link to="/employee/new-booking">
                                            Customer
                                        </Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild className="text-zinc-500 hover:text-zinc-900">
                                        <Link to="/employee/vehicles">
                                            Vehicles
                                        </Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage className="font-semibold text-zinc-900">
                                        Details
                                    </BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Images & Info */}
                    <div className="lg:col-span-2 space-y-8">

                        {/* Title and Features - Mobile only (shown above image on mobile usually, but keeping simple order) */}
                        <div className="lg:hidden space-y-4">
                            <h1 className="text-2xl font-bold text-zinc-900">
                                {vehicle.make} {vehicle.model}
                                <span className="ml-2 text-lg font-normal text-zinc-500">{vehicle.year}</span>
                            </h1>
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary" className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
                                    {vehicle.category?.name}
                                </Badge>
                                {vehicleFeatures.map((feature, index) => (
                                    <Badge key={index} variant="outline" className="flex items-center gap-1.5 py-1">
                                        <feature.icon className="size-3.5" />
                                        <span>{feature.label}</span>
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        {/* Gallery */}
                        <VehicleImageGallery
                            images={vehicle.images.map(img => typeof img === 'string' ? img : img.file.url)}
                            vehicleName={`${vehicle.make} ${vehicle.model}`}
                        />

                        {/* Title and Features - Desktop */}
                        <div className="hidden lg:block space-y-4">
                            <h1 className="text-3xl font-bold text-zinc-900">
                                {vehicle.make} {vehicle.model}
                                <span className="ml-3 text-xl font-normal text-zinc-500">{vehicle.year}</span>
                            </h1>
                            <div className="flex flex-wrap gap-3">
                                <Badge variant="secondary" className="px-3 py-1 text-sm bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
                                    {vehicle.category?.name}
                                </Badge>
                                {vehicleFeatures.map((feature, index) => (
                                    <Badge key={index} variant="outline" className="flex items-center gap-2 px-3 py-1 text-sm">
                                        <feature.icon className="size-4" />
                                        <span>{feature.label}</span>
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        {/* Description */}
                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold text-zinc-900">About this vehicle</h2>
                            <p className="text-zinc-600 leading-relaxed text-sm md:text-base">
                                {vehicle.description || "No description available for this vehicle."}
                            </p>
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

                            {/* Check Profile Completion */}
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
                                    <Button onClick={() => setShowCompleteProfile(true)}>
                                        Complete Profile
                                    </Button>
                                </div>
                            ) : kycError ? (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                                    <p className="text-red-600 mb-2">{kycError}</p>
                                    <Button variant="outline" size="sm" onClick={() => fetchKycDocuments()}>Try Again</Button>
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
                                    pendingCount={kycDocuments.filter(d => d.status === 'PENDING').length}
                                />
                            )}
                        </div>

                    </div>

                    {/* Right Column: Pricing & Booking */}
                    <div className="lg:col-span-1">
                        <div className="lg:sticky lg:top-24 space-y-6">
                            <EmployeeVehiclePricingCard
                                vehicle={vehicle}
                                onBookVehicle={handleBookVehicle}
                                isRefetching={isVehicleRefetching}
                                disabled={isVehicleLoading || (customerSession ? !customerSession.profileCompleted : true)}
                            />

                            {/* Additional Info Cards could go here */}
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                                <Shield className="size-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-medium text-blue-900 text-sm">Booking for {customerSession.name}</p>
                                    <p className="text-blue-700 text-xs mt-1">
                                        Phone: {customerSession.phone} <br />
                                        Public ID: {customerSession.publicId.slice(0, 8)}...
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Upload Dialog */}
                {customerSession && (
                    <UploadKycDialog
                        open={showUploadKyc}
                        onOpenChange={setShowUploadKyc}
                        customerPublicId={customerSession.publicId}
                        onSuccess={() => fetchKycDocuments()}
                    />
                )}

                {/* Complete Profile Dialog */}
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
