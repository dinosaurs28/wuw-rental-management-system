import { format } from "date-fns";
import { Car, Eye, Pencil } from "lucide-react";
import type { EmployeeBooking } from "@/services/booking.service";
import { Button } from "@/components/ui/button";
import { CompletedTag, completionText } from "@/components/employee/completed/CompletedOperation";

interface CompletedQueueListProps {
  rows: EmployeeBooking[];
  filterType: "PICKUP" | "RETURN";
  /** Opens the read-only summary (never the workflow). */
  onView: (bookingId: string) => void;
  /** Opens Edit Pickup / Edit Return. */
  onEdit: (bookingId: string) => void;
}

/**
 * The day's done pickups / returns, kept on the queue below the waiting ones
 * (client item 1), tagged Completed or Awaiting manager.
 */
export function CompletedQueueList({ rows, filterType, onView, onEdit }: CompletedQueueListProps) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
        Completed · {rows.length}
      </p>
      <div className="rounded-xl border bg-card shadow-sm divide-y">
        {rows.map((b) => {
          const vehicle = b.items[0]?.vehicle;
          const done = completionText(b.completed, b.awaitingManager);
          return (
            <div
              key={b.publicId}
              role="button"
              tabIndex={0}
              onClick={() => onView(b.publicId)}
              onKeyDown={(e) => e.key === "Enter" && onView(b.publicId)}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 hover:bg-muted/10 cursor-pointer"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="h-10 w-14 bg-muted/30 rounded border overflow-hidden shrink-0">
                  {vehicle?.images?.[0]?.file?.url ? (
                    <img src={vehicle.images[0].file.url} alt="Vehicle" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <Car className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle"}
                    <span className="text-xs font-mono text-muted-foreground ml-2">{vehicle?.regNo}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {b.customer.user.name} · #{b.publicId.slice(-6).toUpperCase()} ·{" "}
                    {filterType === "PICKUP" ? "Pickup" : "Return"}{" "}
                    {format(new Date(filterType === "PICKUP" ? b.startAt : b.endAt), "MMM dd, h:mm a")}
                  </p>
                  {done && <p className="text-xs text-gray-700 mt-0.5">{done}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <CompletedTag awaitingManager={b.awaitingManager} />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onView(b.publicId);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-[#FF5F00] border-orange-200 hover:bg-orange-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(b.publicId);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {filterType === "PICKUP" ? "Edit Pickup" : "Edit Return"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
