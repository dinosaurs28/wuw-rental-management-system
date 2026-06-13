import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Phone,
  Mail,
  Car,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { extensionService, type DisplacedBooking } from "@/services/extension.service";

type ResolveAction = "CONFIRM_SWAP" | "CANCEL_WITH_REFUND" | "CANCEL_NO_REFUND";

interface ResolveState {
  booking: DisplacedBooking;
  action: ResolveAction | null;
  refundAmount: string;
  refundMethod: "CASH" | "ONLINE";
  notes: string;
}

function fmtDate(iso: string) {
  return format(new Date(iso), "dd MMM yyyy, hh:mm a");
}

export function DisplacedBookingsPage() {
  const queryClient = useQueryClient();
  const [resolveState, setResolveState] = useState<ResolveState | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["displaced-bookings"],
    queryFn: () => extensionService.getDisplacedBookings(),
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: () => {
      if (!resolveState) throw new Error("No resolve state");
      return extensionService.resolveDisplacedBooking(resolveState.booking.publicId, {
        action: resolveState.action!,
        refundAmount:
          resolveState.action === "CANCEL_WITH_REFUND"
            ? Number(resolveState.refundAmount)
            : undefined,
        refundMethod:
          resolveState.action === "CANCEL_WITH_REFUND"
            ? resolveState.refundMethod
            : undefined,
        notes: resolveState.notes || undefined,
      });
    },
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["displaced-bookings"] });
      setResolveState(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? "Failed to resolve booking");
    },
  });

  const bookings: DisplacedBooking[] = data ?? [];

  function openResolve(booking: DisplacedBooking) {
    setResolveState({
      booking,
      action: null,
      refundAmount: "",
      refundMethod: "CASH",
      notes: "",
    });
  }

  const canSubmit =
    resolveState?.action === "CONFIRM_SWAP" ||
    resolveState?.action === "CANCEL_NO_REFUND" ||
    (resolveState?.action === "CANCEL_WITH_REFUND" &&
      Number(resolveState.refundAmount) > 0);

  return (
    <ManagerLayout>
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/manager/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/manager/payment/extensions">Extensions</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Displaced Bookings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              Displaced Bookings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bookings whose vehicle was reassigned due to an extension conflict.
              Contact the customer to confirm or arrange alternatives.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">No displaced bookings</p>
            <p className="text-xs text-muted-foreground mt-1">
              All extension conflicts have been resolved
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b) => (
              <div
                key={b.publicId}
                className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 space-y-4"
              >
                {/* Top row: booking ref + dates */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 rounded px-1.5 py-0.5">
                        {b.publicId.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">
                        Displaced {b.extensionDisplacedAt ? fmtDate(b.extensionDisplacedAt) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-gray-700">
                      <span>{format(new Date(b.startAt), "dd MMM yyyy")}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                      <span className="font-semibold">{format(new Date(b.endAt), "dd MMM yyyy")}</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="bg-orange-500 hover:bg-orange-600 text-white rounded-full px-4"
                    onClick={() => openResolve(b)}
                  >
                    Resolve
                  </Button>
                </div>

                {/* Customer info */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Customer
                  </p>
                  <p className="font-semibold text-gray-900 text-sm">{b.customer.name}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                    {b.customer.phone && (
                      <a
                        href={`tel:${b.customer.phone}`}
                        className="flex items-center gap-1.5 text-blue-600 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {b.customer.phone}
                      </a>
                    )}
                    {b.customer.email && (
                      <a
                        href={`mailto:${b.customer.email}`}
                        className="flex items-center gap-1.5 text-blue-600 hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {b.customer.email}
                      </a>
                    )}
                  </div>
                </div>

                {/* New vehicle assigned */}
                {b.newVehicle && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Car className="h-4 w-4 text-gray-400" />
                    <span>Reassigned to:</span>
                    <span className="font-semibold text-gray-900">
                      {b.newVehicle.make} {b.newVehicle.model}
                    </span>
                    <span className="font-mono text-xs text-gray-500">({b.newVehicle.regNo})</span>
                  </div>
                )}

                {/* Extension that caused displacement */}
                {b.displacingExtension && (
                  <p className="text-xs text-gray-400">
                    Caused by extension{" "}
                    <span className="font-mono">
                      {b.displacingExtension.publicId.slice(0, 8).toUpperCase()}
                    </span>{" "}
                    — new end{" "}
                    {format(new Date(b.displacingExtension.requestedEndAt), "dd MMM yyyy")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveState} onOpenChange={(o) => !o && setResolveState(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Displaced Booking</DialogTitle>
            <DialogDescription>
              {resolveState?.booking.customer.name} — Booking{" "}
              {resolveState?.booking.publicId.slice(0, 8).toUpperCase()}
            </DialogDescription>
          </DialogHeader>

          {resolveState && (
            <div className="space-y-5 py-2">
              {/* Action selector */}
              <div className="space-y-3">
                <Label>What did the customer decide?</Label>

                <button
                  onClick={() =>
                    setResolveState((s) => s && { ...s, action: "CONFIRM_SWAP" })
                  }
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    resolveState.action === "CONFIRM_SWAP"
                      ? "border-green-400 bg-green-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`h-5 w-5 ${
                        resolveState.action === "CONFIRM_SWAP"
                          ? "text-green-500"
                          : "text-gray-300"
                      }`}
                    />
                    <div>
                      <p className="font-semibold text-sm text-gray-800">
                        Customer agreed to the new vehicle
                      </p>
                      <p className="text-xs text-gray-500">
                        Confirms the swap — removes from this list
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() =>
                    setResolveState((s) => s && { ...s, action: "CANCEL_WITH_REFUND" })
                  }
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    resolveState.action === "CANCEL_WITH_REFUND"
                      ? "border-red-400 bg-red-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <XCircle
                      className={`h-5 w-5 ${
                        resolveState.action === "CANCEL_WITH_REFUND"
                          ? "text-red-500"
                          : "text-gray-300"
                      }`}
                    />
                    <div>
                      <p className="font-semibold text-sm text-gray-800">
                        Customer declined — cancel and refund
                      </p>
                      <p className="text-xs text-gray-500">
                        Cancels booking and creates a refund request
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() =>
                    setResolveState((s) => s && { ...s, action: "CANCEL_NO_REFUND" })
                  }
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    resolveState.action === "CANCEL_NO_REFUND"
                      ? "border-gray-500 bg-gray-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <XCircle
                      className={`h-5 w-5 ${
                        resolveState.action === "CANCEL_NO_REFUND"
                          ? "text-gray-600"
                          : "text-gray-300"
                      }`}
                    />
                    <div>
                      <p className="font-semibold text-sm text-gray-800">
                        Customer declined — cancel without refund
                      </p>
                      <p className="text-xs text-gray-500">
                        Cancels booking, no refund issued
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Refund fields — shown only for CANCEL_WITH_REFUND */}
              {resolveState.action === "CANCEL_WITH_REFUND" && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-4 space-y-3">
                  <p className="text-sm font-semibold text-red-800">Refund Details</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Refund amount (₹)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={resolveState.refundAmount}
                      onChange={(e) =>
                        setResolveState((s) => s && { ...s, refundAmount: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Refund method</Label>
                    <Select
                      value={resolveState.refundMethod}
                      onValueChange={(v) =>
                        setResolveState((s) =>
                          s ? { ...s, refundMethod: v as "CASH" | "ONLINE" } : s,
                        )
                      }
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="ONLINE">Online transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">Notes (optional)</Label>
                <Input
                  placeholder="e.g. Customer called at 2pm and agreed to the new vehicle"
                  value={resolveState.notes}
                  onChange={(e) =>
                    setResolveState((s) => s && { ...s, notes: e.target.value })
                  }
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setResolveState(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  disabled={!canSubmit || resolveMutation.isPending}
                  onClick={() => resolveMutation.mutate()}
                >
                  {resolveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Confirm"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ManagerLayout>
  );
}
