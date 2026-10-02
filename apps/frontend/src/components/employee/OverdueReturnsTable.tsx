import { AlertTriangle, Car, CheckCircle2, Clock, Phone } from "lucide-react";
import type { OverdueReturn, OverdueReturnState } from "@/types/overdueReturns";
import { useMinuteTick } from "@/hooks/useMinuteTick";
import {
  RETURN_STATE_META,
  formatIstDateTime,
  formatOverdueDuration,
  isVehicleBack,
  liveOverdueMinutes,
  liveReturnState,
  telHref,
} from "@/utils/overdueReturns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DlStatusBadge } from "@/components/booking/DlStatus";

interface OverdueReturnsTableProps {
  rows: OverdueReturn[];
  /** Date.now() when `rows` arrived — anchors the live overdue duration. */
  fetchedAt: number;
  onAction: (bookingId: string) => void;
  isLoading?: boolean;
  isError?: boolean;
}

/**
 * Fleet overdue / no-show returns (#8): rentals still out after their expected
 * return time, most overdue first. The overdue duration ticks every minute.
 */
export function OverdueReturnsTable({
  rows,
  fetchedAt,
  onAction,
  isLoading,
  isError,
}: OverdueReturnsTableProps) {
  const now = useMinuteTick(rows.length > 0);

  if (isLoading) {
    return (
      <div className="w-full h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-16 bg-muted/10 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2">
        <AlertTriangle className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-muted-foreground text-lg font-medium">
          Couldn't load overdue returns.
        </p>
        <p className="text-sm text-muted-foreground">Use refresh to try again.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-16 bg-muted/10 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2">
        <CheckCircle2 className="h-10 w-10 text-green-500/60" />
        <p className="text-muted-foreground text-lg font-medium">Nothing to recover</p>
        <p className="text-sm text-muted-foreground">
          Every rental out on the road is still within its booked time.
        </p>
      </div>
    );
  }

  const live = rows.map((row) => {
    const minutes = liveOverdueMinutes(row, fetchedAt, now);
    return { row, minutes, state: liveReturnState(row, minutes) };
  });

  return (
    <>
      {/* Mobile cards */}
      <div className="grid gap-4 md:hidden">
        {live.map(({ row, minutes, state }) => (
          <Card
            key={row.publicId}
            className={cn(
              "overflow-hidden shadow-sm",
              state === "OVERDUE" ? "border-red-200" : "border-muted",
            )}
          >
            <CardHeader className="pb-3 bg-muted/30 p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold font-mono text-muted-foreground">
                    #{row.publicId.slice(-6).toUpperCase()}
                  </p>
                  <p className="text-xs font-medium text-foreground mt-1">
                    Due {row.endAtDisplay || formatIstDateTime(row.endAt)}
                  </p>
                </div>
                <StateBadge state={state} />
              </div>
            </CardHeader>
            <CardContent className="p-4 grid gap-3">
              <OverdueDuration minutes={minutes} state={state} />
              <CustomerBlock row={row} />
              <VehiclesBlock row={row} />
              <Tags row={row} />
              <RowAction state={state} onClick={() => onAction(row.publicId)} fullWidth />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[110px] font-semibold">Booking ID</TableHead>
              <TableHead className="w-[220px] font-semibold">Customer</TableHead>
              <TableHead className="w-[220px] font-semibold">Vehicle</TableHead>
              <TableHead className="font-semibold">Expected return</TableHead>
              <TableHead className="font-semibold">Overdue by</TableHead>
              <TableHead className="w-[170px] font-semibold">Status</TableHead>
              <TableHead className="text-right font-semibold">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {live.map(({ row, minutes, state }) => (
              <TableRow key={row.publicId} className="hover:bg-muted/10 align-top">
                <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                  <span className="px-2 py-1 rounded-md bg-muted/50 border">
                    #{row.publicId.slice(-6).toUpperCase()}
                  </span>
                </TableCell>
                <TableCell>
                  <CustomerBlock row={row} />
                </TableCell>
                <TableCell>
                  <VehiclesBlock row={row} />
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {row.endAtDisplay || formatIstDateTime(row.endAt)}
                    </span>
                    {row.originalEndAt && (
                      <span className="text-xs text-muted-foreground">
                        Extended from {formatIstDateTime(row.originalEndAt)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <OverdueDuration minutes={minutes} state={state} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    <StateBadge state={state} />
                    <Tags row={row} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <RowAction state={state} onClick={() => onAction(row.publicId)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: OverdueReturnState }) {
  const meta = RETURN_STATE_META[state];
  return (
    <Badge variant="outline" className={cn("uppercase text-[10px] tracking-wider whitespace-nowrap", meta.className)}>
      {meta.label}
    </Badge>
  );
}

function OverdueDuration({ minutes, state }: { minutes: number; state: OverdueReturnState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap",
        state === "OVERDUE"
          ? "text-red-700"
          : state === "IN_GRACE"
            ? "text-amber-700"
            : "text-muted-foreground",
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      {formatOverdueDuration(minutes)} late
    </span>
  );
}

function CustomerBlock({ row }: { row: OverdueReturn }) {
  const { name, phone, alternatePhone } = row.customer;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="font-medium text-sm truncate">{name || "Unknown customer"}</span>
      {phone ? (
        <a
          href={telHref(phone)}
          className="text-xs text-blue-700 hover:underline inline-flex items-center w-fit"
        >
          <Phone className="h-3 w-3 mr-1" />
          {phone}
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">No phone on file</span>
      )}
      {alternatePhone && (
        <a
          href={telHref(alternatePhone)}
          className="text-xs text-blue-700 hover:underline inline-flex items-center w-fit"
        >
          <Phone className="h-3 w-3 mr-1" />
          {alternatePhone}
          <span className="ml-1 text-muted-foreground">(alt)</span>
        </a>
      )}
    </div>
  );
}

function VehiclesBlock({ row }: { row: OverdueReturn }) {
  if (row.vehicles.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      {row.vehicles.map((vehicle) => (
        <div key={vehicle.publicId} className="flex items-center gap-3">
          <div className="h-10 w-14 bg-muted/30 rounded border overflow-hidden shrink-0">
            {vehicle.imageUrl ? (
              <img src={vehicle.imageUrl} alt="Vehicle" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <Car className="h-4 w-4 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-sm leading-none mb-1 truncate">
              {vehicle.make} {vehicle.model}
            </span>
            <span className="text-xs font-mono text-muted-foreground">{vehicle.regNo}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tags({ row }: { row: OverdueReturn }) {
  // dlStatus is absent (undefined) from servers that predate it — show nothing then
  const hasDl = row.dlStatus !== undefined;
  if (row.bookingType !== "MONTHLY" && !row.extensionPending && !hasDl) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Original licence custody (#3) — what to hand back when the car comes in */}
      {hasDl && <DlStatusBadge status={row.dlStatus} note={row.dlDepositNote} />}
      {row.bookingType === "MONTHLY" && (
        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
          Monthly
        </Badge>
      )}
      {row.extensionPending && (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
          Extension pending
        </Badge>
      )}
    </div>
  );
}

function RowAction({
  state,
  onClick,
  fullWidth,
}: {
  state: OverdueReturnState;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  // The drop is done and only the branch manager can close it — nothing for Fleet to do.
  if (state === "AWAITING_MANAGER_CONFIRMATION") {
    return (
      <span className={cn("text-xs text-muted-foreground", fullWidth && "text-center")}>
        Manager to confirm return
      </span>
    );
  }
  return (
    <Button
      size={fullWidth ? "lg" : "sm"}
      onClick={onClick}
      variant={isVehicleBack(state) ? "outline" : "default"}
      className={cn(
        "font-medium shadow-sm",
        fullWidth ? "w-full font-semibold" : "h-8",
        !isVehicleBack(state) && "bg-orange-600 hover:bg-orange-700 text-white",
      )}
    >
      {state === "RETURN_IN_PROGRESS" ? "Resume return" : "Process return"}
    </Button>
  );
}
