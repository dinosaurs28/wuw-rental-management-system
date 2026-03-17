import { cn } from "@/lib/utils";
import { formatStatus } from "@/utils/formatters";

// ============================================================================
// StatusBadge Component
// ============================================================================

export interface StatusBadgeProps {
  status: string;
  variant?: "default" | "outline";
  className?: string;
}

const statusColors: Record<string, string> = {
  // Booking statuses
  HOLD: "bg-yellow-100 text-yellow-800 border-yellow-200",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-200",
  PICKED_UP: "bg-indigo-100 text-indigo-800 border-indigo-200",
  RETURNED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",

  // Vehicle statuses
  AVAILABLE: "bg-green-100 text-green-800 border-green-200",
  OUT_FOR_RENTAL: "bg-blue-100 text-blue-800 border-blue-200",
  MAINTENANCE: "bg-orange-100 text-orange-800 border-orange-200",
  INACTIVE: "bg-gray-100 text-gray-800 border-gray-200",

  // Approval statuses
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",

  // Payment statuses
  SUCCESS: "bg-green-100 text-green-800 border-green-200",
  FAILED: "bg-red-100 text-red-800 border-red-200",
  CREATED: "bg-gray-100 text-gray-800 border-gray-200",
  REFUNDED: "bg-purple-100 text-purple-800 border-purple-200",

  // Payment methods
  CASH: "bg-green-100 text-green-800 border-green-200",
  UPI: "bg-blue-100 text-blue-800 border-blue-200",
  ONLINE_RAZORPAY: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

export const StatusBadge = ({
  status,
  variant = "default",
  className,
}: StatusBadgeProps) => {
  const colorClass =
    statusColors[status] || "bg-gray-100 text-gray-800 border-gray-200";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        colorClass,
        variant === "outline" && "bg-transparent",
        className,
      )}
    >
      {formatStatus(status)}
    </span>
  );
};
