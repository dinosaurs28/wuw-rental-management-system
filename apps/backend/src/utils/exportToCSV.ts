import { Parser } from "json2csv";
import type { Response } from "express";

// ============================================================================
// CSV Export Utility Functions
// ============================================================================

/**
 * Format currency for CSV (remove ₹ symbol for better compatibility)
 */
const formatCurrencyForCSV = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "0";
  }
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

/**
 * Format date for CSV
 */
const formatDateForCSV = (date: Date | string): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "-";

  const day = dateObj.getDate().toString().padStart(2, "0");
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const year = dateObj.getFullYear();
  return `${day}-${month}-${year}`;
};

/**
 * Send CSV data as response
 */
export const sendCSVFile = (
  res: Response,
  csvData: string,
  filename: string,
): void => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.csv"`,
  );
  res.send(csvData);
};

/**
 * Convert array of objects to CSV
 */
export const arrayToCSV = (data: any[], fields: string[]): string => {
  try {
    const parser = new Parser({ fields });
    return parser.parse(data);
  } catch (error) {
    console.error("Error converting to CSV:", error);
    throw new Error("Failed to generate CSV");
  }
};

// ============================================================================
// Report-Specific CSV Export Functions
// ============================================================================

/**
 * Export Daily Summary Report to CSV
 */
export const exportDailySummaryToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  // Create a flattened array for CSV
  const csvData: any[] = [];

  // Metadata
  csvData.push({
    section: "Metadata",
    key: "Date",
    value: formatDateForCSV(data.metadata.date),
  });
  csvData.push({
    section: "Metadata",
    key: "Branch",
    value: data.metadata.branch,
  });
  csvData.push({
    section: "Metadata",
    key: "Generated At",
    value: formatDateForCSV(data.metadata.generatedAt),
  });

  // Revenue Section
  csvData.push({
    section: "Revenue",
    key: "New Bookings",
    value: formatCurrencyForCSV(data.revenue.newBookings),
  });
  csvData.push({
    section: "Revenue",
    key: "Advance Collected",
    value: formatCurrencyForCSV(data.revenue.advanceCollected),
  });
  csvData.push({
    section: "Revenue",
    key: "Deposit Collected",
    value: formatCurrencyForCSV(data.revenue.depositCollected),
  });
  csvData.push({
    section: "Revenue",
    key: "Total Collected",
    value: formatCurrencyForCSV(data.revenue.totalCollected),
  });

  // Bookings Section
  csvData.push({
    section: "Bookings",
    key: "New Bookings",
    value: data.bookings.newBookings.toString(),
  });
  csvData.push({
    section: "Bookings",
    key: "Pickups",
    value: data.bookings.pickups.toString(),
  });
  csvData.push({
    section: "Bookings",
    key: "Returns",
    value: data.bookings.returns.toString(),
  });
  csvData.push({
    section: "Bookings",
    key: "Cancellations",
    value: data.bookings.cancellations.toString(),
  });
  csvData.push({
    section: "Bookings",
    key: "Active",
    value: data.bookings.active.toString(),
  });

  // Collections Breakdown
  data.collections.breakdown.forEach((item: any) => {
    csvData.push({
      section: "Collections",
      key: item.method,
      value: `${formatCurrencyForCSV(item.amount)} (${item.count} transactions)`,
    });
  });

  const csv = arrayToCSV(csvData, ["section", "key", "value"]);
  sendCSVFile(res, csv, filename);
};

/**
 * Export Sales Report to CSV
 */
export const exportSalesReportToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.data.map((booking: any) => ({
    "Booking ID": booking.bookingId,
    "Booking Date": formatDateForCSV(booking.bookingDate),
    "Customer Name": booking.customer.name,
    "Customer Phone": booking.customer.phone,
    "Customer Email": booking.customer.email,
    Vehicle: booking.vehicle.details,
    "Reg No": booking.vehicle.regNo,
    "Start Date": formatDateForCSV(booking.period.startDate),
    "End Date": formatDateForCSV(booking.period.endDate),
    Days: booking.period.days.toString(),
    "Base Amount": formatCurrencyForCSV(booking.financial.baseAmount),
    Discount: formatCurrencyForCSV(booking.financial.discount),
    Tax: formatCurrencyForCSV(booking.financial.totalTax),
    "Total Amount": formatCurrencyForCSV(booking.financial.totalAmount),
    "Amount Paid": formatCurrencyForCSV(booking.financial.amountPaid),
    Balance: formatCurrencyForCSV(booking.financial.balanceAmount),
    "Payment Method": booking.payment.depositMethod,
    "Payment Status": booking.payment.paymentStatus,
    Status: booking.status,
    Branch: booking.branch,
    "Created By": booking.createdBy,
  }));

  const fields = [
    "Booking ID",
    "Booking Date",
    "Customer Name",
    "Customer Phone",
    "Customer Email",
    "Vehicle",
    "Reg No",
    "Start Date",
    "End Date",
    "Days",
    "Base Amount",
    "Discount",
    "Tax",
    "Total Amount",
    "Amount Paid",
    "Balance",
    "Payment Method",
    "Payment Status",
    "Status",
    "Branch",
    "Created By",
  ];

  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

/**
 * Export Vehicle History Report to CSV
 */
export const exportVehicleHistoryToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.bookingHistory.data.map((booking: any) => ({
    "Booking ID": booking.bookingId,
    "Customer Name": booking.customerName,
    "Customer Phone": booking.customerPhone,
    "Start Date": formatDateForCSV(booking.startDate),
    "End Date": formatDateForCSV(booking.endDate),
    Days: booking.days.toString(),
    Revenue: formatCurrencyForCSV(booking.revenue),
    Deposit: formatCurrencyForCSV(booking.depositAmount),
    Status: booking.status,
    "Damage Reported": booking.damageReported ? "Yes" : "No",
    "Return Condition": booking.returnCondition,
  }));

  const fields = [
    "Booking ID",
    "Customer Name",
    "Customer Phone",
    "Start Date",
    "End Date",
    "Days",
    "Revenue",
    "Deposit",
    "Status",
    "Damage Reported",
    "Return Condition",
  ];

  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

/**
 * Export Collection Report to CSV
 */
export const exportCollectionToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.payments.map((payment: any) => ({
    "Payment ID": payment.paymentId,
    "Booking ID": payment.bookingId,
    Date: formatDateForCSV(payment.collectedAt),
    Customer: payment.customerName,
    Phone: payment.customerPhone,
    Amount: formatCurrencyForCSV(payment.amount),
    Method: payment.method,
    Branch: payment.branch,
    Type: payment.type,
  }));

  const fields = [
    "Payment ID",
    "Booking ID",
    "Date",
    "Customer",
    "Phone",
    "Amount",
    "Method",
    "Branch",
    "Type",
  ];
  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

/**
 * Export Fleet Executive Report to CSV
 */
export const exportFleetExecutiveToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.branchPerformance.map((branch: any) => ({
    Branch: branch.branchName,
    "Total Vehicles": branch.totalVehicles.toString(),
    "Active Vehicles": branch.activeVehicles.toString(),
    "Total Bookings": branch.totalBookings.toString(),
    "Total Revenue": formatCurrencyForCSV(branch.totalRevenue),
    "Avg Booking Value": formatCurrencyForCSV(branch.averageBookingValue),
    Utilization: `${branch.utilization.toFixed(1)}%`,
  }));

  const fields = [
    "Branch",
    "Total Vehicles",
    "Active Vehicles",
    "Total Bookings",
    "Total Revenue",
    "Avg Booking Value",
    "Utilization",
  ];
  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

/**
 * Export GST Report to CSV
 */
export const exportGSTToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.invoices.map((invoice: any) => ({
    "Invoice Number": invoice.invoiceNumber,
    Date: formatDateForCSV(invoice.invoiceDate),
    Customer: invoice.customerName,
    "Taxable Amount": formatCurrencyForCSV(invoice.taxableAmount),
    CGST: formatCurrencyForCSV(invoice.cgst),
    SGST: formatCurrencyForCSV(invoice.sgst),
    IGST: formatCurrencyForCSV(invoice.igst),
    "Total GST": formatCurrencyForCSV(invoice.totalGST),
    "Total Amount": formatCurrencyForCSV(invoice.totalAmount),
    "GST Rate": `${invoice.gstRate}%`,
    Type: invoice.isInterState ? "Inter-State" : "Intra-State",
  }));

  const fields = [
    "Invoice Number",
    "Date",
    "Customer",
    "Taxable Amount",
    "CGST",
    "SGST",
    "IGST",
    "Total GST",
    "Total Amount",
    "GST Rate",
    "Type",
  ];
  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

/**
 * Export Vehicle Availability Report to CSV
 */
export const exportVehicleAvailabilityToCSV = (
  res: Response,
  data: any,
  filename: string,
): void => {
  const csvData = data.vehicles.map((vehicle: any) => ({
    "Reg No": vehicle.regNo,
    Make: vehicle.make,
    Model: vehicle.model,
    Category: vehicle.category,
    Branch: vehicle.branch,
    Status: vehicle.status,
    "Current Status": vehicle.currentStatus,
    Utilization: `${vehicle.utilizationRate.toFixed(1)}%`,
    "Booked Days": vehicle.bookedDays,
    "Total Days": vehicle.totalDays,
    "Upcoming Bookings": vehicle.bookings.filter(
      (b: any) => new Date(b.startDate) > new Date(),
    ).length,
  }));

  const fields = [
    "Reg No",
    "Make",
    "Model",
    "Category",
    "Branch",
    "Status",
    "Current Status",
    "Utilization",
    "Booked Days",
    "Total Days",
    "Upcoming Bookings",
  ];
  const csv = arrayToCSV(csvData, fields);
  sendCSVFile(res, csv, filename);
};

export default {
  sendCSVFile,
  arrayToCSV,
  exportDailySummaryToCSV,
  exportSalesReportToCSV,
  exportVehicleHistoryToCSV,
  exportCollectionToCSV,
  exportFleetExecutiveToCSV,
  exportGSTToCSV,
  exportVehicleAvailabilityToCSV,
};
