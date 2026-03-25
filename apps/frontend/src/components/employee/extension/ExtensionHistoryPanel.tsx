import { useQuery } from "@tanstack/react-query";
import { Loader2, History } from "lucide-react";
import { format } from "date-fns";
import { extensionService, type BookingExtension } from "@/services/extension.service";
import { ExtensionStatusBadge } from "@/components/manager/payment/PaymentStateBadge";

const resolutionLabels: Record<string, string> = {
  SAME_VEHICLE: "Same vehicle",
  SWAP_CURRENT_TO_OTHER: "Vehicle swapped",
  SWAP_FUTURE_BOOKING: "Future booking reassigned",
  PARTIAL_EXTENSION: "Partial extension",
  NO_RESOLUTION: "No resolution",
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd MMM");
}

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(parseFloat(amount));
}

interface ExtensionHistoryPanelProps {
  bookingPublicId: string;
  role?: "employee" | "manager";
}

export function ExtensionHistoryPanel({
  bookingPublicId,
  role = "manager",
}: ExtensionHistoryPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["extensions", bookingPublicId, role],
    queryFn: () =>
      role === "employee"
        ? extensionService.listEmployeeExtensions(1, 50, bookingPublicId)
        : extensionService.listBranchExtensions(1, 50, bookingPublicId),
    enabled: !!bookingPublicId,
  });

  const extensions: BookingExtension[] = data?.data?.extensions || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (extensions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
        <History className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No extensions recorded</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gray-50/80 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-gray-700">
          Extension History
        </span>
        <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold px-1.5">
          {extensions.length}
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-white">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                #
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Extended To
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Additional
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Resolution
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {extensions.map((ext, idx) => (
              <tr key={ext.publicId} className="bg-white hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                  {idx + 1}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-800">
                    {formatDate(ext.oldEndAt)}
                  </span>
                  <span className="mx-1.5 text-gray-400">→</span>
                  <span className="font-semibold text-gray-900">
                    {formatDate(ext.actualNewEndAt || ext.requestedEndAt)}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                  {formatCurrency(ext.additionalAmount)}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {ext.resolutionType
                    ? resolutionLabels[ext.resolutionType] ?? ext.resolutionType
                    : "—"}
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
      <div className="sm:hidden divide-y divide-gray-100">
        {extensions.map((ext, idx) => (
          <div key={ext.publicId} className="px-4 py-3 bg-white">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-gray-400">#{idx + 1}</span>
              <ExtensionStatusBadge status={ext.extensionStatus} />
            </div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-1">
              <span>{formatDate(ext.oldEndAt)}</span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold">
                {formatDate(ext.actualNewEndAt || ext.requestedEndAt)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                {ext.resolutionType
                  ? resolutionLabels[ext.resolutionType] ?? ext.resolutionType
                  : "—"}
              </span>
              <span className="font-mono font-semibold text-gray-700">
                +{formatCurrency(ext.additionalAmount)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
