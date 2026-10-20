/**
 * A vehicle's rent history for the branch manager (Oct 20 2026): the rentals it
 * went out on, newest first, with the notes the Fleet Executive wrote at the
 * pickup and at the drop. A row opens the customer's booking drawer.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import apiClient from "@/lib/axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OperationNotesCard, hasOperationNotes, type OperationNotesView } from "@/components/employee/OperationNotes";
import { BookingDrawer } from "@/components/manager/customers/BookingDrawer";
import { MANAGER_CUSTOMERS_PORTAL, customersTabKey } from "@/components/manager/customers/portal";
import { apiMessage, istDateTime } from "@/components/manager/customers/format";

export interface VehicleRental {
  bookingPublicId: string;
  status: "PICKED_UP" | "RETURNED";
  customer: { publicId: string; name: string; phone: string | null };
  startAt: string;
  endAt: string;
  returnedAt: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  totalKmDriven: number | null;
  swappedOut: { at: string; toRegNo: string } | null;
  swappedIn: { at: string; fromRegNo: string } | null;
  operationNotes: OperationNotesView;
}

interface RentHistoryResponse {
  vehicle: { publicId: string; make: string; model: string; regNo: string };
  rentals: VehicleRental[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const PAGE_SIZE = 20;

export function VehicleRentHistorySheet({
  vehicle,
  onClose,
}: {
  vehicle: { publicId: string; make: string; model: string; regNo: string } | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [openBooking, setOpenBooking] = useState<{ customerId: string; bookingId: string } | null>(null);
  const portal = MANAGER_CUSTOMERS_PORTAL;

  const query = useQuery({
    queryKey: ["manager-vehicle-rent-history", vehicle?.publicId, page],
    queryFn: async () => {
      const res = await apiClient.get<{ data: RentHistoryResponse }>(
        `/branchManager/dashboard/vehicle/${vehicle!.publicId}/rent-history`,
        { params: { page, limit: PAGE_SIZE } },
      );
      return res.data.data;
    },
    enabled: !!vehicle,
    staleTime: 0,
  });
  const data = query.data;

  return (
    <>
      <Sheet
        open={!!vehicle}
        onOpenChange={(o) => {
          if (!o) {
            setPage(1);
            onClose();
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Rent history</SheetTitle>
            <SheetDescription>
              {vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.regNo}` : ""} — rentals with the pickup and drop notes
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-50">
            {query.isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
              </div>
            ) : query.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {apiMessage(query.error, "Could not load the rent history.")}
              </div>
            ) : data && data.rentals.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">This vehicle hasn't been out on a rental yet.</p>
            ) : data ? (
              <>
                {data.rentals.map((r) => (
                  <div key={r.bookingPublicId} className="rounded-xl border bg-white p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">{r.customer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {istDateTime(r.startAt)} → {istDateTime(r.returnedAt ?? r.endAt)}
                          {r.returnedAt ? "" : " (due)"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={r.status === "PICKED_UP" ? "border-orange-200 text-orange-700 bg-orange-50" : ""}
                      >
                        {r.status === "PICKED_UP" ? "Out now" : "Returned"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                      <span className="font-mono">#{r.bookingPublicId.slice(-8).toUpperCase()}</span>
                      {r.startOdometer != null && (
                        <span>
                          Odometer {r.startOdometer.toLocaleString("en-IN")}
                          {r.endOdometer != null ? ` → ${r.endOdometer.toLocaleString("en-IN")}` : ""} km
                        </span>
                      )}
                      {r.totalKmDriven != null && <span>{r.totalKmDriven.toLocaleString("en-IN")} km driven</span>}
                      {r.swappedIn && <span>Swapped in for {r.swappedIn.fromRegNo}, {istDateTime(r.swappedIn.at)}</span>}
                      {r.swappedOut && <span>Swapped out to {r.swappedOut.toRegNo}, {istDateTime(r.swappedOut.at)}</span>}
                    </div>
                    {hasOperationNotes(r.operationNotes) ? (
                      <OperationNotesCard notes={r.operationNotes} title="Pickup & drop notes" />
                    ) : (
                      <p className="text-xs text-muted-foreground">No pickup or drop notes.</p>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-[#FF5F00]"
                      onClick={() => setOpenBooking({ customerId: r.customer.publicId, bookingId: r.bookingPublicId })}
                    >
                      Open booking
                    </Button>
                  </div>
                ))}
                {data.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Newer
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} rentals
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Older
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <BookingDrawer
        service={portal.service}
        queryKey={customersTabKey(portal, "booking")}
        customerId={openBooking?.customerId ?? ""}
        bookingId={openBooking?.bookingId ?? null}
        onClose={() => setOpenBooking(null)}
        canRefundToCustomer={!!portal.canRefundToCustomer}
      />
    </>
  );
}
