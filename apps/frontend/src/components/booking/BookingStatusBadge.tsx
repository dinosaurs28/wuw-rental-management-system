import { cn } from "@/lib/utils";

interface BookingStatusBadgeProps {
  status: "CONFIRMED" | "RETURNED" | "CANCELLED" | string;
  type?: "booking" | "payment";
  className?: string;
}

const statusStyles: Record<string, { bg: string; text: string }> = {
  // Booking statuses
  CONFIRMED: { bg: "bg-green-100", text: "text-green-700" },
  RETURNED: { bg: "bg-blue-100", text: "text-blue-700" },
  CANCELLED: { bg: "bg-red-100", text: "text-red-700" },

  // Payment statuses
  PAID: { bg: "bg-green-100", text: "text-green-700" },
  PENDING: { bg: "bg-yellow-100", text: "text-yellow-700" },
  FAILED: { bg: "bg-red-100", text: "text-red-700" },
  REFUNDED: { bg: "bg-gray-100", text: "text-gray-700" },

  // Default fallback
  DEFAULT: { bg: "bg-gray-100", text: "text-gray-700" },
};

export function BookingStatusBadge({
  status,
  type = "booking",
  className,
}: BookingStatusBadgeProps) {
  const normalizedStatus = status.toUpperCase();
  const style = statusStyles[normalizedStatus] || statusStyles.DEFAULT;

  // Format display text
  const displayText =
    status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.bg,
        style.text,
        className,
      )}
    >
      {type === "payment" ? `Payment: ${displayText}` : displayText}
    </span>
  );
}
