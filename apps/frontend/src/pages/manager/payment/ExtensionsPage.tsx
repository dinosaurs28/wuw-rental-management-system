import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowUpRight, RefreshCw, AlertTriangle } from "lucide-react";
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
import { format } from "date-fns";

const resolutionLabels: Record<string, string> = {
  SAME_VEHICLE: "Same vehicle",
  SWAP_CURRENT_TO_OTHER: "Vehicle swapped",
  SWAP_FUTURE_BOOKING: "Future booking reassigned",
  PARTIAL_EXTENSION: "Partial extension",
  NO_RESOLUTION: "No resolution",
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd MMM yyyy");
}

function formatDateTime(iso: string) {
  return format(new Date(iso), "dd MMM yyyy, hh:mm a");
}

function fmtMoney(val: string) {
  return (
    "₹ " +
    parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 0 })
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
              All booking extensions for this branch
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
              <SelectItem value="PAYMENT_COLLECTED">Cash Collected</SelectItem>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {extensions.map((ext) => (
                    <tr
                      key={ext.publicId}
                      className="hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 rounded px-1.5 py-0.5">
                          {(ext.bookingPublicId || "").slice(0, 8).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
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
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {extensions.map((ext) => (
                <div
                  key={ext.publicId}
                  className="rounded-lg border border-gray-200 bg-white p-4 space-y-3 shadow-sm"
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
                      {ext.resolutionType
                        ? resolutionLabels[ext.resolutionType] ??
                          ext.resolutionType
                        : "—"}
                    </span>
                    <span className="font-mono font-semibold text-gray-800">
                      +{fmtMoney(ext.additionalAmount)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDateTime(ext.createdAt)}
                  </div>
                </div>
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
    </ManagerLayout>
  );
}
