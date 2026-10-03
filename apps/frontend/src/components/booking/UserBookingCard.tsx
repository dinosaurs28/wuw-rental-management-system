import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Booking } from "@/services/userBookings.service";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingQRModal } from "./BookingQRModal";
import { InvoiceDownloadButton } from "@/components/InvoiceDownloadButton";
import { CustomerExtensionModal } from "@/components/customer/CustomerExtensionModal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Calendar, Clock, Car, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { extensionService } from "@/services/extension.service";
import { useBookingsStore } from "@/store/bookings.store";
import { formatRentalLength } from "@/utils/formatters";
import { formatInrExact, gstLabel, gstNumber } from "@/lib/gst";

interface UserBookingCardProps {
  booking: Booking;
}

export function UserBookingCard({ booking }: UserBookingCardProps) {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const fetchBookings = useBookingsStore((state) => state.fetchBookings);

  const isActive =
    booking.status === "CONFIRMED" || booking.status === "PICKED_UP";

  // Check eligibility — only fetched for active bookings
  const { data: eligibility } = useQuery({
    queryKey: ["extension-eligibility", booking.bookingId],
    queryFn: () => extensionService.customerCheckEligibility(booking.bookingId),
    enabled: isActive,
    staleTime: 60_000,
  });

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

  const showExtendButton = isActive && eligibility?.eligible === true;

  // "Paid" only for money actually received (an unpaid hold shows its total);
  // older servers send just amountPaid / remainingBalance.
  const total = Number(booking.total);
  const paid = Number(booking.paid ?? (booking.paymentStatus === "SUCCESS" ? booking.amountPaid : 0)) || 0;
  const showPaid = paid > 0 && paid < total;
  const balanceDue = Number(
    booking.balanceDue ??
      (booking.isAdvancePayment && booking.paymentStatus === "SUCCESS" ? booking.remainingBalance : 0),
  ) || 0;
  // Left on credit at the counter (#11): owed to the branch, not due at a pickup / drop step
  const onCredit = Math.min(balanceDue, Number(booking.balanceOnCredit ?? 0) || 0);
  const dueAtStep = Math.max(0, balanceDue - onCredit);
  // At the 15-day (or monthly 180-day) limit — or less than 12 hours left before
  // it, the shortest extension a customer can buy (P3): say why there is no Extend button
  const noExtensionPackageFits =
    eligibility?.packageOptions?.length === 0 && (eligibility.hoursUntilEnd ?? 0) > 0;
  const extendCapReason =
    isActive && eligibility?.eligible === false && (eligibility.atCap || noExtensionPackageFits)
      ? eligibility.reason
      : null;
  // GST of the original booking, as the server stored it (#23), shown inside the
  // GST-inclusive rent (item 17): "Rent without GST ₹1,066 + GST ₹234 = ₹1,300"
  // (+ the CGST / SGST split when sent); nothing from older servers.
  const bookingTax = gstNumber(booking.totalTax);
  const bookingCgst = gstNumber(booking.totalCgst);
  const bookingSgst = gstNumber(booking.totalSgst);
  const rentWithoutGst =
    gstNumber(booking.rentWithoutGst) ??
    (booking.totalBase != null ? Number(booking.totalBase) - Number(booking.totalDiscount ?? 0) : null);
  const rentAfterDiscount =
    gstNumber(booking.rentAfterDiscountInclGst) ??
    (rentWithoutGst != null && bookingTax != null ? rentWithoutGst + bookingTax : null);
  const gstLine =
    bookingTax == null || bookingTax <= 0
      ? null
      : rentWithoutGst != null && rentAfterDiscount != null
        ? `Rent without GST ${formatInrExact(rentWithoutGst)} + GST ${formatInrExact(bookingTax)} = ${formatInrExact(rentAfterDiscount)}`
        : `Rent incl. GST ${formatInrExact(bookingTax)}`;
  const gstSplitLine =
    bookingTax != null && bookingTax > 0 && bookingCgst != null && bookingSgst != null
      ? `${gstLabel("CGST", booking.cgstRate)} ${formatInrExact(bookingCgst)} · ${gstLabel("SGST", booking.sgstRate)} ${formatInrExact(bookingSgst)}`
      : null;
  // Discount off the GST-inclusive rent (older servers: the pre-GST discount)
  const discountShown = gstNumber(booking.discountInclGst) ?? Number(booking.totalDiscount ?? 0);

  return (
    <>
      <Card className="overflow-hidden bg-white border-zinc-200 shadow-2xl rounded-[1.5rem] transition-all hover:bg-zinc-50 hover:border-zinc-300 group">
        <CardContent className="p-0 relative">
          {/* Subtle glow effect on hover */}
          <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

          {/* Header with Booking ID and Statuses */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50 px-6 py-5">
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
              <BookingStatusBadge status={booking.paymentStatus} type="payment" />
            </div>
          </div>

          {/* Main Content */}
          <div className="p-6 flex flex-col gap-6 relative z-10">
            {/* Date and Duration Row */}
            <div className="flex flex-wrap items-center gap-6 pb-4 border-b border-zinc-200">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">
                  Schedule
                </span>
                <div className="flex items-center gap-2 text-base font-medium text-zinc-700">
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
                <div className="flex items-center gap-2 text-base font-medium text-zinc-700">
                  <Clock className="h-4 w-4 text-zinc-400" />
                  <span>{formatRentalLength(booking.startAt, booking.endAt)}</span>
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
                  className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 transition-colors"
                >
                  <div className="h-20 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100 border border-zinc-200">
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
                  <div className="flex flex-1 flex-col justify-center">
                    <h4 className="text-base font-bold text-zinc-900 tracking-wide">
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
                  {showPaid ? "Amount Paid" : "Total Amount"}
                </span>
                <span className="text-2xl font-bold text-zinc-900 font-mono tracking-tight">
                  {formatCurrency(showPaid ? paid : total)}
                </span>
                {dueAtStep > 0 && (
                  <span className="text-xs text-zinc-500 mt-0.5">
                    +{formatCurrency(dueAtStep)} due at{" "}
                    {(booking.balanceDueAt ?? (booking.status === "PICKED_UP" ? "DROP" : "PICKUP")) === "DROP" ? "drop" : "pickup"} ·{" "}
                    {formatCurrency(total)} total
                  </span>
                )}
                {onCredit > 0 && (
                  <span className="text-xs text-amber-700 mt-0.5">
                    {formatCurrency(onCredit)} on credit — owed to the branch · {formatCurrency(total)} total
                  </span>
                )}
                {booking.couponCode && discountShown > 0 && (
                  <span className="text-xs text-emerald-600 mt-0.5">
                    Discount −{formatInrExact(discountShown)} · coupon {booking.couponCode}
                  </span>
                )}
                {gstLine && <span className="text-xs text-zinc-500 mt-0.5">{gstLine}</span>}
                {gstSplitLine && <span className="text-[11px] text-zinc-400">{gstSplitLine}</span>}
                {extendCapReason && (
                  <span className="text-xs text-zinc-500 mt-0.5">{extendCapReason}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <InvoiceDownloadButton
                  bookingId={booking.id}
                  bookingStatus={booking.status}
                />
                {showExtendButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-full h-10 border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-600 font-semibold px-4 transition-all"
                    onClick={() => setIsExtendModalOpen(true)}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    <span className="hidden sm:inline">Extend</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-full h-11 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 font-semibold px-5 transition-all"
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

      <BookingQRModal
        isOpen={isQRModalOpen}
        onClose={() => setIsQRModalOpen(false)}
        bookingId={booking.bookingId}
        bookingStatus={booking.status}
      />

      {isExtendModalOpen && (
        <CustomerExtensionModal
          open={isExtendModalOpen}
          bookingPublicId={booking.bookingId}
          currentEndAt={booking.endAt}
          onClose={() => setIsExtendModalOpen(false)}
          onSuccess={() => void fetchBookings()}
        />
      )}
    </>
  );
}
