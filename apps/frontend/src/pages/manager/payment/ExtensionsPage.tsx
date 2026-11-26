import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ArrowUpRight, RefreshCw, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { ExtensionStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import {
  extensionService,
  type BookingExtension,
  type ExtensionStatus,
} from "@/services/extension.service";
import { gstSplitText } from "@/lib/gst";
import { paymentService } from "@/services/payment.service";
import {
  ExtensionDetailSheet,
  needsConfirmation,
  paymentMethodLabel,
} from "@/components/manager/payment/ExtensionDetailSheet";
import { formatIstDateTime } from "@/utils/overdueReturns";

/** A monthly booking's extension is a renewal (client TODO 7). */
function RenewalTag() {
  return (
    <span className="mr-1.5 inline-flex items-center rounded bg-orange-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-700">
      Renewal
    </span>
  );
}

const resolutionLabels: Record<string, string> = {
  SAME_VEHICLE: "Same vehicle",
  SWAP_CURRENT_TO_OTHER: "Vehicle swapped",
  SWAP_FUTURE_BOOKING: "Future booking reassigned",
  PARTIAL_EXTENSION: "Partial extension",
  NO_RESOLUTION: "No resolution",
};

/** "26 Nov 2026, 06:00 PM" in IST — an extension is often a few hours, so the time matters. */
function formatDate(iso: string) {
  return formatIstDateTime(iso);
}

function formatDateTime(iso: string) {
  return formatIstDateTime(iso);
}

function fmtMoney(val: string) {
  return (
    "₹ " +
    parseFloat(val).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

const PAGE_SIZE = 20;

export function ExtensionsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ExtensionStatus | "ALL">(
    "ALL"
  );

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["extensions-list", page, statusFilter],
    queryFn: () =>
      extensionService.listBranchExtensions(
        page,
        PAGE_SIZE,
        undefined,
        statusFilter === "ALL" ? undefined : statusFilter
      ),
  });

  const extensions: BookingExtension[] = data?.data?.extensions || [];
  const total = data?.data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = extensions.find((e) => e.publicId === openId) ?? null;

  // How many extensions have a payment waiting for the manager (any page)
  const { data: pendingData } = useQuery({
    queryKey: ["extensions-list", "pending-count"],
    queryFn: () => extensionService.listBranchExtensions(1, 1, undefined, "PAYMENT_COLLECTED"),
  });
  const pendingCount = pendingData?.data?.total ?? 0;

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["extensions-list"] });
    qc.invalidateQueries({ queryKey: ["pending-cash"] });
  }, [qc]);

  const quickConfirm = useMutation({
    mutationFn: (txnId: string) => paymentService.confirmCash(txnId),
    onSuccess: () => {
      toast.success("Payment confirmed — the extension is now confirmed.");
      reload();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Could not confirm the payment."),
  });

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  return (
    <ManagerLayout>
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/manager/dashboard">
                Dashboard
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Extensions</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Rental Extensions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              All booking extensions for this branch. Click one to see every detail and confirm its payment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700"
              onClick={() => navigate("/manager/extensions/displaced")}
            >
              <AlertTriangle className="h-4 w-4" />
              Displaced Bookings
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {pendingCount > 0 && statusFilter !== "PAYMENT_COLLECTED" && (
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setStatusFilter("PAYMENT_COLLECTED");
            }}
            className="w-full flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100 transition-colors"
          >
            <span>
              <span className="font-semibold">
                {pendingCount} extension payment{pendingCount !== 1 ? "s" : ""} waiting for your confirmation.
              </span>{" "}
              Staff can't finish those returns until you confirm.
            </span>
            <span className="flex items-center gap-1 font-semibold shrink-0">
              Show <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setPage(1);
              setStatusFilter(v as ExtensionStatus | "ALL");
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PENDING_PAYMENT">Awaiting Payment</SelectItem>
              <SelectItem value="PAYMENT_COLLECTED">Waiting for confirmation</SelectItem>
              <SelectItem value="CONFIRMED">Confirmed</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              {total} extension{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : extensions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <ArrowUpRight className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">
              No extensions found
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Extension requests will appear here once created
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Booking
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Customer
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Extended To
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Additional
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Resolution
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Actor
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Created
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {extensions.map((ext) => (
                    <tr
                      key={ext.publicId}
                      onClick={() => setOpenId(ext.publicId)}
                      className={`cursor-pointer hover:bg-gray-50/80 transition-colors ${needsConfirmation(ext) ? "bg-amber-50/40" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 rounded px-1.5 py-0.5">
                          {(ext.bookingPublicId || "").slice(0, 8).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">
                        <span className="block font-medium text-gray-900 text-sm">{ext.customerName ?? "—"}</span>
                        {ext.vehicle?.regNo && <span className="text-gray-500">{ext.vehicle.regNo}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">
                        <span className="font-medium">
                          {formatDate(ext.oldEndAt)}
                        </span>
                        <span className="mx-1.5 text-gray-400">→</span>
                        <span className="font-semibold text-gray-900">
                          {formatDate(
                            ext.actualNewEndAt || ext.requestedEndAt
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                        {fmtMoney(ext.additionalAmount)}
                        {ext.taxAmount != null && ext.taxableAmount != null && (
                          <span
                            className="block text-[11px] font-normal text-gray-500"
                            title={gstSplitText(ext.cgstAmount, ext.sgstAmount)}
                          >
                            {/* GST-inclusive extension rent (item 17) */}
                            Rent without GST {fmtMoney(ext.taxableAmount)} + GST{" "}
                            {ext.taxRate ? `${Number(ext.taxRate)}% ` : ""}
                            {fmtMoney(ext.taxAmount)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {ext.isRenewal && <RenewalTag />}
                        {ext.resolutionType
                          ? resolutionLabels[ext.resolutionType] ??
                            ext.resolutionType
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        <span className="capitalize">
                          {(ext.actorRole || "").toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {formatDateTime(ext.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <ExtensionStatusBadge status={ext.extensionStatus} />
                        {ext.payment && needsConfirmation(ext) && (
                          <span className="block mt-1 text-[11px] text-gray-500">{paymentMethodLabel(ext.payment)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {needsConfirmation(ext) && ext.payment ? (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                            disabled={quickConfirm.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              // UPI / card: open the details so the payment photo is checked first
                              if (ext.payment!.proofs?.length || ext.payment!.proofPhotoUrl) setOpenId(ext.publicId);
                              else quickConfirm.mutate(ext.payment!.publicId);
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {ext.payment.proofs?.length || ext.payment.proofPhotoUrl ? "Review" : "Confirm"}
                          </Button>
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-300 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {extensions.map((ext) => (
                <button
                  type="button"
                  key={ext.publicId}
                  onClick={() => setOpenId(ext.publicId)}
                  className={`w-full text-left rounded-lg border p-4 space-y-3 shadow-sm ${needsConfirmation(ext) ? "border-amber-300 bg-amber-50/50" : "border-gray-200 bg-white"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 rounded px-1.5 py-0.5">
                      {(ext.bookingPublicId || "").slice(0, 8).toUpperCase()}
                    </span>
                    <ExtensionStatusBadge status={ext.extensionStatus} />
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-gray-800">
                    <span>{formatDate(ext.oldEndAt)}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-semibold">
                      {formatDate(ext.actualNewEndAt || ext.requestedEndAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {ext.isRenewal && <RenewalTag />}
                      {ext.resolutionType
                        ? resolutionLabels[ext.resolutionType] ??
                          ext.resolutionType
                        : "—"}
                    </span>
                    <span className="font-mono font-semibold text-gray-800 text-right">
                      +{fmtMoney(ext.additionalAmount)}
                      {ext.taxAmount != null && (
                        <span className="block text-[11px] font-normal text-gray-500">
                          incl. GST {fmtMoney(ext.taxAmount)}
                        </span>
                      )}
                    </span>
                  </div>
                  {ext.customerName && (
                    <div className="text-sm text-gray-800">
                      {ext.customerName}
                      {ext.vehicle?.regNo && <span className="text-gray-500"> · {ext.vehicle.regNo}</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatDateTime(ext.createdAt)}</span>
                    {needsConfirmation(ext) && (
                      <span className="font-semibold text-amber-700">Tap to confirm payment</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ExtensionDetailSheet extension={opened} onClose={() => setOpenId(null)} onChanged={reload} />
    </ManagerLayout>
  );
}
