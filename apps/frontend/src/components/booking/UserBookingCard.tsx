import { useState } from "react";
import type { Booking } from "@/services/userBookings.service";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingQRModal } from "./BookingQRModal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Calendar, Clock, Car } from "lucide-react";
import { format } from "date-fns";

interface UserBookingCardProps {
    booking: Booking;
}

export function UserBookingCard({ booking }: UserBookingCardProps) {
    const [isQRModalOpen, setIsQRModalOpen] = useState(false);

    const formatDate = (dateString: string) => {
        return format(new Date(dateString), "MMM dd, yyyy");
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    return (
        <>
            <Card className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="p-0">
                    {/* Header with Booking ID and Statuses */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Booking ID:</span>
                            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                                {booking.bookingId.slice(0, 8)}...
                            </code>
                        </div>
                        <div className="flex items-center gap-2">
                            <BookingStatusBadge status={booking.status} />
                            <BookingStatusBadge status={booking.paymentStatus} type="payment" />
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="p-4">
                        {/* Date and Duration Row */}
                        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span>
                                    {formatDate(booking.startAt)} → {formatDate(booking.endAt)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span>{booking.days} {booking.days === 1 ? 'day' : 'days'}</span>
                            </div>
                        </div>

                        {/* Vehicles List */}
                        <div className="space-y-3">
                            {booking.vehicles.map((vehicle) => (
                                <div
                                    key={vehicle.publicId}
                                    className="flex items-center gap-4 rounded-lg border bg-card p-3"
                                >
                                    {/* Vehicle Thumbnail */}
                                    <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                                        {vehicle.thumbnail ? (
                                            <img
                                                src={vehicle.thumbnail}
                                                alt={`${vehicle.make} ${vehicle.model}`}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center">
                                                <Car className="h-8 w-8 text-muted-foreground" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Vehicle Info */}
                                    <div className="flex flex-1 flex-col gap-1">
                                        <h4 className="font-medium">
                                            {vehicle.make} {vehicle.model}
                                        </h4>
                                        <span className="text-sm text-muted-foreground">
                                            {formatCurrency(vehicle.finalTotal)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer with Total and QR Button */}
                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                            <div className="flex flex-col">
                                <span className="text-xs text-muted-foreground">Total Amount</span>
                                <span className="text-lg font-semibold text-primary">
                                    {formatCurrency(booking.total)}
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => setIsQRModalOpen(true)}
                            >
                                <QrCode className="h-4 w-4" />
                                <span className="hidden sm:inline">Show QR</span>
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* QR Code Modal */}
            <BookingQRModal
                isOpen={isQRModalOpen}
                onClose={() => setIsQRModalOpen(false)}
                bookingId={booking.bookingId}
            />
        </>
    );
}
