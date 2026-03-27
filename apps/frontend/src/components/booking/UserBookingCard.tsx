import { useState } from "react";
import type { Booking } from "@/services/userBookings.service";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingQRModal } from "./BookingQRModal";
import { InvoiceDownloadButton } from "@/components/InvoiceDownloadButton";
// import { CustomerExtensionModal } from "@/components/customer/CustomerExtensionModal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Calendar, Clock, Car/*, ArrowUpRight*/ } from "lucide-react";
import { format } from "date-fns";

interface UserBookingCardProps {
  booking: Booking;
}

export function UserBookingCard({ booking }: UserBookingCardProps) {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  // const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "MMM dd, yyyy");
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <>
      <Card className="overflow-hidden bg-white border-zinc-200 shadow-2xl rounded-[1.5rem] transition-all hover:bg-zinc-50 hover:border-zinc-300 group">
        <CardContent className="p-0 relative">
          {/* Subtle glow effect on hover */}
          <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

          {/* Header with Booking ID and Statuses */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                Booking Ref:
              </span>
              <code className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs font-bold text-zinc-700 border border-zinc-200 shadow-inner">
                {booking.bookingId.slice(0, 8).toUpperCase()}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <BookingStatusBadge status={booking.status} />
              <BookingStatusBadge
                status={booking.paymentStatus}
                type="payment"
              />
            </div>
          </div>

          {/* Main Content */}
          <div className="p-5 flex flex-col gap-5 relative z-10">
            {/* Date and Duration Row */}
            <div className="flex flex-wrap items-center gap-6 pb-4 border-b border-zinc-200">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                  Schedule
                </span>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                  <Calendar className="h-4 w-4 text-zinc-400" />
                  <span>
                    {formatDate(booking.startAt)}{" "}
                    <span className="text-zinc-500 mx-1">→</span>{" "}
                    {formatDate(booking.endAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 border-l border-zinc-200 pl-6">
                <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                  Duration
                </span>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                  <Clock className="h-4 w-4 text-zinc-400" />
                  <span>
                    {booking.days} {booking.days === 1 ? "day" : "days"}
                  </span>
                </div>
              </div>
            </div>

            {/* Vehicles List */}
            <div className="space-y-3">
              <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase mb-2 block">
                Vehicles Reserved
              </span>
              {booking.vehicles.map((vehicle) => (
                <div
                  key={vehicle.publicId}
                  className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 hover:bg-zinc-100 transition-colors"
                >
                  {/* Vehicle Thumbnail */}
                  <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100 border border-zinc-200">
                    {vehicle.thumbnail ? (
                      <img
                        src={vehicle.thumbnail}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Car className="h-6 w-6 text-zinc-600" />
                      </div>
                    )}
                  </div>

                  {/* Vehicle Info */}
                  <div className="flex flex-1 flex-col justify-center">
                    <h4 className="font-bold text-zinc-900 tracking-wide">
                      {vehicle.make} {vehicle.model}
                    </h4>
                    <span className="text-sm font-medium text-zinc-400 font-mono">
                      {formatCurrency(vehicle.finalTotal)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer with Total and Action Buttons */}
            <div className="flex items-center justify-between gap-4 pt-4 border-t border-zinc-200 mt-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                  Total Amount
                </span>
                <span className="text-xl font-bold text-zinc-900 font-mono tracking-tight">
                  {formatCurrency(booking.total)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <InvoiceDownloadButton
                  bookingId={booking.id}
                  bookingStatus={booking.status}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-full h-10 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 font-medium px-4 transition-all"
                  onClick={() => setIsQRModalOpen(true)}
                >
                  <QrCode className="h-4 w-4" />
                  <span>Show Pass</span>
                </Button>
              </div>
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

      {/* Extension Modal — temporarily disabled
      {isExtendModalOpen && (
        <CustomerExtensionModal
          open={isExtendModalOpen}
          bookingPublicId={booking.bookingId}
          currentEndAt={booking.endAt}
          onClose={() => setIsExtendModalOpen(false)}
        />
      )}
      */}
    </>
  );
}
