import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';
import {
    MapPin,
    CreditCard,
    Banknote,
    User,
    Shield,
    ArrowLeft,
    CheckCircle,
    Loader2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { useEmployeeBookingStore } from '@/store/employeeBooking.store';
import { useVehicleDetails } from '@/hooks/useVehicleDetails';
import { customerSession } from '@/utils/customerSession';
import { bookingService } from '@/services/booking.service';
import { kycService, type KycDocument } from '@/services/kyc.service';

export const EmployeeBookingSummaryPage = () => {
    const navigate = useNavigate();
    const session = customerSession.get();

    // Store
    const {
        selectedVehicleId,
        startDate: storeStartDate,
        endDate: storeEndDate,
        paymentType,
        customerKycId,
        reset: resetStore
    } = useEmployeeBookingStore();

    const startDate = storeStartDate ? new Date(storeStartDate) : null;
    const endDate = storeEndDate ? new Date(storeEndDate) : null;

    // Local State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [kycDocument, setKycDocument] = useState<KycDocument | null>(null);

    // Fetch Vehicle Details
    const {
        data: vehicleResponse,
        isLoading: isVehicleLoading
    } = useVehicleDetails(selectedVehicleId || '', startDate, endDate);

    const vehicle = vehicleResponse?.data;

    // Fetch KYC Details (to show on summary)
    useEffect(() => {
        const fetchKyc = async () => {
            if (customerKycId && session?.publicId) {
                try {
                    // We can reuse getCustomerKyc and find the doc, or just show ID/Type if we had it.
                    // To be safe and show nice details, let's fetch.
                    const res = await kycService.getCustomerKyc(session.publicId);
                    const doc = res.data.find(d => d.publicId === customerKycId);
                    if (doc) setKycDocument(doc);
                } catch (error) {
                    console.error("Failed to fetch KYC details", error);
                }
            }
        };
        fetchKyc();
    }, [customerKycId, session?.publicId]);

    // Validation & Redirects
    useEffect(() => {
        if (!session) {
            toast.error("No active customer session");
            navigate('/employee/new-booking');
            return;
        }
        if (!selectedVehicleId || !startDate || !endDate || !customerKycId) {
            toast.error("Missing booking details");
            navigate('/employee/vehicles');
        }
    }, [session, selectedVehicleId, startDate, endDate, customerKycId, navigate]);

    if (isVehicleLoading || !vehicle || !session) {
        return (
            <div className="container mx-auto px-4 py-8 space-y-6">
                <Skeleton className="h-10 w-48" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Skeleton className="h-[400px] rounded-xl" />
                    <Skeleton className="h-[400px] rounded-xl" />
                </div>
            </div>
        );
    }

    // Pricing Calculation
    const days = startDate && endDate ? differenceInCalendarDays(endDate, startDate) + 1 : 0;
    const baseTotal = vehicle.pricing.daily * days;
    const discountAmount = vehicle.discountPrice;
    const hasDiscount = vehicle.discountPrice > 0 && vehicle.discountPrice < baseTotal;
    const finalTotal = hasDiscount ? (baseTotal - discountAmount) : baseTotal;
    const totalPayable = finalTotal + vehicle.deposit; // Including deposit in immediate payment?
    // Wait, usually deposit is collected. Let's assume Total Payable = Final Rental + Deposit for Cash.

    const [bookingSuccess, setBookingSuccess] = useState(false);
    const [paymentData, setPaymentData] = useState<{ paymentURL: string | null; status: string } | null>(null);

    const handleConfirmBooking = async () => {
        if (!session || !selectedVehicleId || !startDate || !endDate || !customerKycId) return;

        setIsSubmitting(true);
        try {
            const payload = {
                vehicles: [vehicle.publicId],
                customer_public_id: session.publicId,
                customer_kyc_id: customerKycId,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                payment_type: paymentType,
            };

            const response = await bookingService.createEmployeeBooking(payload);

            // Store successful response and show success UI
            setPaymentData(response.data);
            setBookingSuccess(true);
            toast.success("Booking Created Successfully!");

            // DO NOT RESET Store yet, wait for user to leave page
            // resetStore(); 
            // navigate('/employee/dashboard');

        } catch (error: any) {
            console.error("Booking failed", error);
            const msg = error.response?.data?.message || "Failed to create booking";
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFinish = () => {
        resetStore();
        navigate('/employee/dashboard');
    };

    // Render Success/Payment View
    if (bookingSuccess && paymentData) {
        return (
            <div className="min-h-screen bg-zinc-50 pb-20">
                {/* Header */}
                <div className="bg-white border-b border-zinc-200">
                    <div className="container mx-auto px-4 h-16 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={handleFinish} className="-ml-2">
                            <ArrowLeft className="size-5" />
                        </Button>
                        <h1 className="text-xl font-bold text-zinc-900">Booking Confirmed</h1>
                    </div>
                </div>

                <main className="container mx-auto px-4 py-8">
                    <Card className="max-w-md mx-auto border-2 border-emerald-100 shadow-lg">
                        <CardHeader className="bg-emerald-50/50 pb-6 text-center border-b border-emerald-100">
                            <div className="flex justify-center mb-4">
                                <div className="bg-emerald-100 p-3 rounded-full">
                                    <CheckCircle className="size-8 text-emerald-600" />
                                </div>
                            </div>
                            <CardTitle className="text-xl font-bold text-zinc-900">Booking Successful</CardTitle>
                            <CardDescription>
                                Booking has been created. Complete payment to finalize.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">

                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-500">Total Amount</span>
                                    <span className="font-bold text-lg text-zinc-900">₹ {totalPayable.toLocaleString('en-IN')}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-500">Payment Type</span>
                                    <Badge variant={paymentType === 'CASH' ? 'default' : 'secondary'}>{paymentType}</Badge>
                                </div>
                            </div>

                            <div className="pt-4">
                                {paymentType === 'CASH' && (
                                    <Button onClick={handleFinish} className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700">
                                        Collect Cash & Finish
                                    </Button>
                                )}

                                {paymentType === 'ONLINE' && paymentData.paymentURL && (
                                    <Button asChild className="w-full h-12 text-base bg-blue-600 hover:bg-blue-700">
                                        <a href={paymentData.paymentURL}>
                                            Pay Online
                                        </a>
                                    </Button>
                                )}

                                {paymentType === 'ONLINE' && !paymentData.paymentURL && (
                                    <div className="text-center text-amber-600 bg-amber-50 p-3 rounded-lg text-sm">
                                        Payment link could not be generated. Please check dashboard.
                                    </div>
                                )}
                            </div>

                            {paymentType === 'ONLINE' && (
                                <Button variant="outline" onClick={handleFinish} className="w-full">
                                    Skip / Check Status Later
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-zinc-200">
                <div className="container mx-auto px-4 h-16 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="-ml-2">
                        <ArrowLeft className="size-5" />
                    </Button>
                    <h1 className="text-xl font-bold text-zinc-900">Review & Confirm</h1>
                </div>
            </div>

            <main className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Col: Details */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Customer Card */}
                        <Card>
                            <CardHeader className="pb-3 border-b border-zinc-100">
                                <CardTitle className="text-base font-semibold flex items-center gap-2">
                                    <User className="size-5 text-zinc-500" />
                                    Customer Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-medium">Name</p>
                                    <p className="text-base font-medium">{session.name}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-medium">Contact</p>
                                    <p className="text-base">{session.phone}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-medium">Public ID</p>
                                    <p className="text-sm font-mono text-zinc-600">{session.publicId}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-medium">KYC Document</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Shield className="size-4 text-emerald-600" />
                                        <span className="text-sm font-medium">
                                            {kycDocument ? kycDocument.type : 'Selected'}
                                        </span>
                                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                                            Verified
                                        </Badge>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Vehicle Card */}
                        <Card>
                            <CardHeader className="pb-3 border-b border-zinc-100">
                                <CardTitle className="text-base font-semibold flex items-center gap-2">
                                    <CheckCircle className="size-5 text-zinc-500" />
                                    Vehicle Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 flex gap-4 sm:gap-6">
                                <div className="w-24 h-24 sm:w-32 sm:h-32 bg-zinc-100 rounded-lg overflow-hidden flex-shrink-0">
                                    <img
                                        src={vehicle.images[0]?.file?.url || '/placeholder.png'}
                                        alt={vehicle.model}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-lg font-bold text-zinc-900">{vehicle.make} {vehicle.model}</h3>
                                    <p className="text-zinc-500 text-sm">{vehicle.year}</p>
                                    <Badge variant="secondary" className="mt-2 text-xs">
                                        {vehicle.category?.name}
                                    </Badge>
                                    <div className="flex items-center gap-2 text-zinc-600 text-sm mt-2">
                                        <MapPin className="size-3.5" />
                                        <span>{vehicle.branch}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                    </div>

                    {/* Right Col: Price & Action */}
                    <div className="lg:col-span-1 space-y-6">
                        <Card className="border-2 border-orange-100 shadow-md">
                            <CardHeader className="bg-orange-50/50 pb-4 border-b border-orange-100">
                                <CardTitle className="text-lg font-bold text-zinc-900">Booking Summary</CardTitle>
                                <CardDescription>Review charges and confirm</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-6">
                                {/* Dates */}
                                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-zinc-100">
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase mb-1">Pickup</p>
                                        <p className="font-semibold text-sm">
                                            {startDate && format(startDate, 'MMM dd, yyyy')}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase mb-1">Return</p>
                                        <p className="font-semibold text-sm">
                                            {endDate && format(endDate, 'MMM dd, yyyy')}
                                        </p>
                                    </div>
                                </div>

                                {/* Price Breakdown */}
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between text-zinc-600">
                                        <span>Rental Charge ({days} days)</span>
                                        <span>₹ {baseTotal.toLocaleString('en-IN')}</span>
                                    </div>
                                    {hasDiscount && (
                                        <div className="flex justify-between text-emerald-600">
                                            <span>Discount</span>
                                            <span>-₹ {discountAmount.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-zinc-600">
                                        <span>Security Deposit</span>
                                        <span>₹ {vehicle.deposit.toLocaleString('en-IN')}</span>
                                    </div>
                                    <Separator className="my-2" />
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-semibold text-zinc-900">Total Payable</span>
                                        <span className="font-bold text-xl text-zinc-900">
                                            ₹ {totalPayable.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>

                                {/* Payment Method Badge */}
                                <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-200 flex items-center justify-between">
                                    <span className="text-sm font-medium text-zinc-600">Payment Method</span>
                                    <Badge variant={paymentType === 'CASH' ? 'default' : 'secondary'} className="uppercase">
                                        {paymentType === 'CASH' ? <Banknote className="size-3 mr-1" /> : <CreditCard className="size-3 mr-1" />}
                                        {paymentType}
                                    </Badge>
                                </div>

                                <Button
                                    className="w-full h-12 text-base bg-orange-600 hover:bg-orange-700"
                                    onClick={handleConfirmBooking}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        'Confirm Booking'
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    );
};
