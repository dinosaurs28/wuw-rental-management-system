// ============================================================================
// Currency and Number Formatting
// ============================================================================

/**
 * Format number as Indian Rupees with ₹ symbol
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted currency string (e.g., "₹1,25,000")
 */
export const formatCurrency = (
  amount: number | null | undefined,
  decimals: number = 0,
): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "₹0";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
};

/**
 * Format number with Indian numbering system (lakhs, etc.)
 * @param num - The number to format
 * @returns Formatted number string (e.g., "1,25,000")
 */
export const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined || isNaN(num)) {
    return "0";
  }

  return new Intl.NumberFormat("en-IN").format(num);
};

/**
 * Abbreviate large numbers (e.g., 125000 -> "₹1.25L", 2350000 -> "₹23.5L")
 * @param amount - The amount to abbreviate
 * @param includeCurrency - Whether to include ₹ symbol (default: true)
 * @returns Abbreviated string
 */
export const abbreviateAmount = (
  amount: number | null | undefined,
  includeCurrency: boolean = true,
): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return includeCurrency ? "₹0" : "0";
  }

  const prefix = includeCurrency ? "₹" : "";

  if (amount >= 10000000) {
    // 1 Crore or more
    return `${prefix}${(amount / 10000000).toFixed(2)}Cr`;
  } else if (amount >= 100000) {
    // 1 Lakh or more
    return `${prefix}${(amount / 100000).toFixed(2)}L`;
  } else if (amount >= 1000) {
    // 1 Thousand or more
    return `${prefix}${(amount / 1000).toFixed(1)}K`;
  }

  return `${prefix}${amount.toFixed(0)}`;
};

/**
 * Format percentage
 * @param value - The percentage value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "65.8%")
 */
export const formatPercentage = (
  value: number | null | undefined,
  decimals: number = 1,
): string => {
  if (value === null || value === undefined || isNaN(value)) {
    return "0%";
  }

  return `${value.toFixed(decimals)}%`;
};

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format date for display in reports (DD-MM-YYYY)
 * @param date - Date string or Date object
 * @returns Formatted date string
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return "-";

  const dateObj = typeof date === "string" ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) return "-";

  const day = dateObj.getDate().toString().padStart(2, "0");
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const year = dateObj.getFullYear();

  return `${day}-${month}-${year}`;
};

/**
 * Format date and time for display (DD-MM-YYYY HH:MM)
 * @param date - Date string or Date object
 * @returns Formatted datetime string
 */
export const formatDateTime = (
  date: string | Date | null | undefined,
): string => {
  if (!date) return "-";

  const dateObj = typeof date === "string" ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) return "-";

  const day = dateObj.getDate().toString().padStart(2, "0");
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const year = dateObj.getFullYear();
  const hours = dateObj.getHours().toString().padStart(2, "0");
  const minutes = dateObj.getMinutes().toString().padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

/**
 * Format date range for display
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Formatted date range string (e.g., "01-02-2026 to 07-02-2026")
 */
export const formatDateRange = (
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
): string => {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (start === "-" && end === "-") return "-";
  if (start === "-") return `Until ${end}`;
  if (end === "-") return `From ${start}`;

  return `${start} to ${end}`;
};

/**
 * Get relative date label (e.g., "Today", "Yesterday", "2 days ago")
 * @param date - Date string or Date object
 * @returns Relative date label
 */
export const getRelativeDateLabel = (date: string | Date): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const today = new Date();
  const diffTime = today.getTime() - dateObj.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

// ============================================================================
// Phone Number Formatting
// ============================================================================

/**
 * Format phone number with +91 country code
 * @param phone - Phone number string
 * @returns Formatted phone number (e.g., "+91-9876543210")
 */
export const formatPhone = (phone: string | null | undefined): string => {
  if (!phone) return "-";

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // If starts with 91, format as +91-XXXXXXXXXX
  if (digits.startsWith("91") && digits.length === 12) {
    return `+${digits.slice(0, 2)}-${digits.slice(2)}`;
  }

  // If 10 digits, assume Indian number and add +91
  if (digits.length === 10) {
    return `+91-${digits}`;
  }

  // Return as is if format is unexpected
  return phone;
};

// ============================================================================
// Vehicle Registration Number Formatting
// ============================================================================

/**
 * Format vehicle registration number (e.g., "KA01AB1234" -> "KA-01-AB-1234")
 * @param regNo - Registration number
 * @returns Formatted registration number
 */
export const formatRegNo = (regNo: string | null | undefined): string => {
  if (!regNo) return "-";

  // Remove existing hyphens and spaces
  const cleaned = regNo.replace(/[-\s]/g, "").toUpperCase();

  // Try to match Indian registration pattern: KA01AB1234
  const match = cleaned.match(/^([A-Z]{2})(\d{2})([A-Z]{1,2})(\d{4})$/);

  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}-${match[4]}`;
  }

  // Return as is if pattern doesn't match
  return regNo;
};

// ============================================================================
// Time Helpers
// ============================================================================

export function snapTo15Minutes(h: number, m: number): { h: number; m: number } {
  const snapped = Math.ceil(m / 15) * 15;
  if (snapped >= 60) return { h: (h + 1) % 24, m: 0 };
  return { h, m: snapped };
}

export function getCurrentTime(): string {
  const now = new Date();
  const { h, m } = snapTo15Minutes(now.getHours(), now.getMinutes());
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ============================================================================
// Status Formatting
// ============================================================================

/**
 * Get human-readable status label
 * @param status - Status enum value
 * @returns Human-readable label
 */
export const formatStatus = (status: string): string => {
  const statusLabels: Record<string, string> = {
    HOLD: "On Hold",
    CONFIRMED: "Confirmed",
    PICKED_UP: "Picked Up",
    RETURNED: "Returned",
    CANCELLED: "Cancelled",
    AVAILABLE: "Available",
    OUT_FOR_RENTAL: "Out for Rental",
    MAINTENANCE: "Maintenance",
    INACTIVE: "Inactive",
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SUCCESS: "Success",
    FAILED: "Failed",
    CREATED: "Created",
    REFUNDED: "Refunded",
    CASH: "Cash",
    UPI: "UPI",
    ONLINE_RAZORPAY: "Online (Razorpay)",
  };

  return statusLabels[status] || status;
};

// ============================================================================
// Booking/Invoice ID Formatting
// ============================================================================

/**
 * Extract display ID from public ID (e.g., "BKG-67890" from full UUID)
 * @param publicId - Public ID string
 * @returns Shortened ID for display
 */
export const formatPublicId = (publicId: string | null | undefined): string => {
  if (!publicId) return "-";

  // If already in format XXX-XXXXX, return as is
  if (/^[A-Z]{3}-\d{5}/.test(publicId)) {
    return publicId;
  }

  // Otherwise return as is
  return publicId;
};
