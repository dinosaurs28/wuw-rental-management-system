import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, CheckCircle, CreditCard, Banknote, ArrowLeft, Car, Calendar, FileText, Shield, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

import { useVehicleRentalStore } from '@/store/vehicleRental.store';
import { bookingService } from '@/services/booking.service';
import { format } from 'date-fns';

// Response types from API
interface BookingResponse {
    holdId: string;
    transactionId?: string;
    paymentURL?: string;
    encryptedFinalPrice?: string;
    grandBaseTotal: number;
    grandDiscountTotal: number;
    grandTaxTotal: number;
    grandCGSTTotal?: number;
    grandSGSTTotal?: number;
    taxRate?: number;
    grandDeposit: number;
    grandFinalTotal: number;
}

export const BookingConfirmationPage = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [bookingData, setBookingData] = useState<BookingResponse | null>(null);

    // Get booking state from store
    const {
        selectedVehicleId,
        make,
        model,
        category,
        branch,
        startDate,
        endDate,
        rentalDays,
        selectedKycFilePublicId,
        paymentType,
        clearVehicleSelection,
    } = useVehicleRentalStore();

    // Make API call on page load
    useEffect(() => {
        const createBooking = async () => {
            // Validate required data
            if (!selectedVehicleId || !startDate || !endDate || !selectedKycFilePublicId || !paymentType) {
                setError('Missing booking information. Please go back and try again.');
                setIsLoading(false);
                return;
            }

            try {
                const response = await bookingService.createBookingSummary({
                    vehicles: [selectedVehicleId],
                    start: startDate,
                    end: endDate,
                    file_public_id: selectedKycFilePublicId,
                    payment_type: paymentType,
                });

                // Store the response
                setBookingData({
                    holdId: response.holdId,
                    transactionId: response.data.totals.transactionId ?? undefined,
                    paymentURL: response.data.totals.paymentURL as string,
                    encryptedFinalPrice: response.data.totals.encryptedFinalPrice as string,
                    grandBaseTotal: response.data.totals.grandBaseTotal,
                    grandDiscountTotal: response.data.totals.grandDiscountTotal,
                    grandTaxTotal: response.data.totals.grandTaxTotal,
                    grandCGSTTotal: response.data.totals.grandCGSTTotal,
                    grandSGSTTotal: response.data.totals.grandSGSTTotal,
                    taxRate: response.data.totals.taxRate,
                    grandDeposit: response.data.totals.grandDeposit,
                    grandFinalTotal: response.data.totals.grandFinalTotal,
                });
            } catch (err: any) {
                const message = err?.response?.data?.message || 'Failed to create booking. Please try again.';
                setError(message);
                toast.error(message);

                // Handle auth errors
                if (err?.response?.status === 401 || err?.response?.status === 403) {
                    navigate('/auth/sign-in');
                }
            } finally {
                setIsLoading(false);
            }
        };

        createBooking();
    }, [selectedVehicleId, startDate, endDate, selectedKycFilePublicId, paymentType, navigate]);

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(price);
    };

    const formattedStartDate = startDate ? format(new Date(startDate), 'EEE, MMM d, yyyy') : '-';
    const formattedEndDate = endDate ? format(new Date(endDate), 'EEE, MMM d, yyyy') : '-';

    // Handle Online Payment
    const handleOnlinePayment = () => {
        if (bookingData?.paymentURL) {
            window.location.href = bookingData.paymentURL;
        }
    };

    // Handle Cash Payment Confirmation
    const handleCashPayment = async () => {
        if (!bookingData?.encryptedFinalPrice || !bookingData?.transactionId) {
            toast.error('Invalid payment details');
            return;
        }

        setIsProcessing(true);

        try {
            const response = await bookingService.confirmCashPayment({
                encryptedFinalPrice: bookingData.encryptedFinalPrice,
                transactionId: bookingData.transactionId,
            });

            if (response.status === 'Success') {
                toast.success('Booking confirmed successfully!');
                clearVehicleSelection();
                navigate('/booking/history');
            } else {
                toast.error(response.message || 'Payment confirmation failed');
            }
        } catch (err: any) {
            const message = err?.response?.data?.message || 'Cash payment confirmation failed';
            toast.error(message);
        } finally {
            setIsProcessing(false);
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex flex-col">
                <Navbar />
                <main className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <Loader2 className="size-12 text-primary animate-spin mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-foreground mb-2">Creating Your Booking</h2>
                        <p className="text-muted-foreground">Please wait while we process your request...</p>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    // Error state
    if (error || !bookingData) {
        return (
            <div className="min-h-screen bg-background flex flex-col">
                <Navbar />
                <main className="flex-1 flex items-center justify-center px-4">
                    <div className="text-center max-w-md">
                        <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
                            <AlertCircle className="size-8 text-red-600" />
                        </div>
                        <h2 className="text-xl font-semibold text-foreground mb-2">Booking Failed</h2>
                        <p className="text-muted-foreground mb-6">{error || 'Something went wrong. Please try again.'}</p>
                        <Button asChild variant="outline">
                            <Link to="/booking/review-confirm">
                                <ArrowLeft className="mr-2 size-4" />
                                Go Back
                            </Link>
                        </Button>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Navbar />

            <main className="flex-1">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
                    {/* Breadcrumb */}
                    <Breadcrumb className="mb-6">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to="/" className="text-primary hover:text-primary/80">
                                        Home
                                    </Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to="/vehicles" className="text-primary hover:text-primary/80">
                                        Vehicles
                                    </Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Confirm Payment</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    {/* Success Header */}
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                            <CheckCircle className="size-8 text-green-600" />
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
                            Booking Ready!
                        </h1>
                        <p className="text-muted-foreground">
                            Complete your payment to confirm the booking
                        </p>
                    </div>

                    {/* Booking Summary Card */}
                    <Card className="bg-white border border-zinc-200 rounded-xl shadow-sm mb-6">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg font-semibold flex items-center gap-2">
                                <Car className="size-5 text-primary" />
                                Booking Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Vehicle Info */}
                            <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                <span className="text-sm text-muted-foreground">Vehicle</span>
                                <span className="text-sm font-medium text-foreground">
                                    {make} {model}
                                </span>
                            </div>

                            {category && (
                                <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                    <span className="text-sm text-muted-foreground">Category</span>
                                    <span className="text-sm font-medium text-foreground capitalize">
                                        {category}
                                    </span>
                                </div>
                            )}

                            {branch && (
                                <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                    <span className="text-sm text-muted-foreground">Pickup Location</span>
                                    <span className="text-sm font-medium text-foreground">
                                        {branch}
                                    </span>
                                </div>
                            )}

                            {/* Dates */}
                            <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Calendar className="size-4" />
                                    Duration
                                </span>
                                <span className="text-sm font-medium text-foreground">
                                    {formattedStartDate} - {formattedEndDate}
                                </span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                <span className="text-sm text-muted-foreground">Rental Days</span>
                                <span className="text-sm font-medium text-foreground">
                                    {rentalDays} {rentalDays === 1 ? 'day' : 'days'}
                                </span>
                            </div>

                            {/* KYC */}
                            <div className="flex items-center justify-between py-2 border-b border-zinc-100">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <FileText className="size-4" />
                                    KYC Document
                                </span>
                                <span className="text-sm font-medium text-foreground">
                                    •••• {selectedKycFilePublicId?.slice(-4)}
                                </span>
                            </div>

                            {/* Payment Type */}
                            <div className="flex items-center justify-between py-2">
                                <span className="text-sm text-muted-foreground">Payment Method</span>
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-primary/10 text-primary">
                                    {paymentType === 'ONLINE' ? (
                                        <><CreditCard className="size-3" /> Online</>
                                    ) : (
                                        <><Banknote className="size-3" /> Cash</>
                                    )}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Price Breakdown Card */}
                    <Card className="bg-white border border-zinc-200 rounded-xl shadow-sm mb-6">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg font-semibold">Price Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Base Price</span>
                                <span className="font-medium text-foreground">
                                    {formatPrice(bookingData.grandBaseTotal)}
                                </span>
                            </div>

                            {bookingData.grandDiscountTotal > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-green-600">Discount</span>
                                    <span className="font-medium text-green-600">
                                        -{formatPrice(bookingData.grandDiscountTotal)}
                                    </span>
                                </div>
                            )}

                            {bookingData.grandTaxTotal > 0 && (
                                <>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Tax ({bookingData.taxRate}%)</span>
                                        <span className="font-medium text-foreground">
                                            {formatPrice(bookingData.grandTaxTotal)}
                                        </span>
                                    </div>
                                    {bookingData.grandCGSTTotal !== undefined && (
                                        <div className="flex items-center justify-between text-sm text-muted-foreground pl-2">
                                            <span>CGST ({(bookingData.taxRate || 18) / 2}%)</span>
                                            <span>{formatPrice(bookingData.grandCGSTTotal)}</span>
                                        </div>
                                    )}
                                    {bookingData.grandSGSTTotal !== undefined && (
                                        <div className="flex items-center justify-between text-sm text-muted-foreground pl-2">
                                            <span>SGST ({(bookingData.taxRate || 18) / 2}%)</span>
                                            <span>{formatPrice(bookingData.grandSGSTTotal)}</span>
                                        </div>
                                    )}
                                </>
                            )}

                            {bookingData.grandDeposit > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">Security Deposit</span>
                                    <span className="font-medium text-foreground">
                                        {formatPrice(bookingData.grandDeposit)}
                                    </span>
                                </div>
                            )}

                            <div className="border-t border-zinc-200 pt-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-base font-semibold text-foreground">
                                        Total Amount
                                    </span>
                                    <span className="text-2xl font-bold text-primary">
                                        {formatPrice(bookingData.grandFinalTotal)}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Payment Action */}
                    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20 rounded-xl shadow-sm">
                        <CardContent className="p-6">
                            {paymentType === 'ONLINE' ? (
                                /* Online Payment */
                                <div className="text-center">
                                    <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                        <CreditCard className="size-7 text-primary" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-foreground mb-2">
                                        Secure Online Payment
                                    </h3>
                                    <p className="text-sm text-muted-foreground mb-6">
                                        You will be redirected to our secure payment gateway
                                    </p>
                                    <Button
                                        onClick={handleOnlinePayment}
                                        className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg shadow-primary/20"
                                    >
                                        <CreditCard className="mr-2 size-5" />
                                        Pay {formatPrice(bookingData.grandFinalTotal)} Now
                                    </Button>
                                    <div className="flex items-center justify-center gap-2 mt-4 text-xs text-muted-foreground">
                                        <Shield className="size-3" />
                                        256-bit SSL encrypted payment
                                    </div>
                                </div>
                            ) : (
                                /* Cash Payment */
                                <div className="text-center">
                                    <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                                        <Banknote className="size-7 text-green-600" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-foreground mb-2">
                                        Pay at Pickup
                                    </h3>
                                    <p className="text-sm text-muted-foreground mb-6">
                                        Confirm your booking now and pay when you pick up the vehicle
                                    </p>
                                    <Button
                                        onClick={handleCashPayment}
                                        disabled={isProcessing}
                                        className="w-full h-14 text-base font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-lg shadow-green-600/20"
                                    >
                                        {isProcessing ? (
                                            <>
                                                <Loader2 className="mr-2 size-5 animate-spin" />
                                                Confirming...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle className="mr-2 size-5" />
                                                Confirm Booking
                                            </>
                                        )}
                                    </Button>
                                    <p className="text-xs text-muted-foreground mt-4">
                                        Amount to pay at pickup: <strong>{formatPrice(bookingData.grandFinalTotal)}</strong>
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Back Link */}
                    <div className="text-center mt-6">
                        <Link
                            to="/booking/review-confirm"
                            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="size-4" />
                            Back to Review
                        </Link>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
