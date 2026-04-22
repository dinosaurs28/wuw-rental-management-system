import ExcelJS from "exceljs";
import type { Response } from "express";

// ============================================================================
// Excel Export Utility Functions
// ============================================================================

/**
 * Format currency for Excel display
 */
const formatCurrencyForExcel = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "₹0";
  }
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

/**
 * Format date for Excel display
 */
const formatDateForExcel = (date: Date | string): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "-";

  const day = dateObj.getDate().toString().padStart(2, "0");
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const year = dateObj.getFullYear();
  return `${day}-${month}-${year}`;
};

/**
 * Generate Excel file and send as response
 * @param res - Express response object
 * @param workbook - ExcelJS workbook
 * @param filename - Filename for download
 */
export const sendExcelFile = async (
  res: Response,
  workbook: ExcelJS.Workbook,
  filename: string,
): Promise<void> => {
  try {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.xlsx"`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error sending Excel file:", error);
    throw error;
  }
};

/**
 * Create styled header row
 */
export const createHeaderRow = (
  worksheet: ExcelJS.Worksheet,
  headers: string[],
  rowNumber: number = 1,
): void => {
  const headerRow = worksheet.getRow(rowNumber);

  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFF5F00" }, // Orange color
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  headerRow.height = 25;
};

/**
 * Auto-fit columns based on content
 */
export const autoFitColumns = (worksheet: ExcelJS.Worksheet): void => {
  worksheet.columns.forEach((column) => {
    if (!column || !column.eachCell) return;

    let maxLength = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value ? cell.value.toString() : "";
      maxLength = Math.max(maxLength, cellValue.length);
    });

    column.width = Math.min(maxLength + 2, 50); // Min 12, max 50
  });
};

/**
 * Add a title row to the worksheet
 */
export const addTitleRow = (
  worksheet: ExcelJS.Worksheet,
  title: string,
  columnCount: number,
): void => {
  const titleRow = worksheet.getRow(1);
  const titleCell = titleRow.getCell(1);

  titleCell.value = title;
  titleCell.font = { size: 16, bold: true, color: { argb: "FFFF5F00" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };

  worksheet.mergeCells(1, 1, 1, columnCount);
  titleRow.height = 30;
};

// ============================================================================
// Report-Specific Export Functions
// ============================================================================

/**
 * Export Daily Summary Report to Excel
 */
export const exportDailySummaryToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet("Summary");

  addTitleRow(
    summarySheet,
    `Daily Summary - ${formatDateForExcel(data.metadata.date)}`,
    4,
  );

  summarySheet.addRow(["Branch", data.metadata.branch]);
  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  // Booking vs Billed Section
  summarySheet.addRow(["BOOKING VALUE vs BILLED AMOUNT"]);
  summarySheet.addRow(["Note: Booking Value = amount committed at booking time. Billed Amount = actual invoice total after vehicle return."]);
  createHeaderRow(summarySheet, ["Metric", "Amount", "Count"], (summarySheet.lastRow?.number ?? 0) + 1);
  summarySheet.addRow(["Booking Value (New Bookings Today)", formatCurrencyForExcel(data.revenue.bookingValue), data.bookings.newBookings]);
  summarySheet.addRow(["Billed Amount (Invoices Finalized Today)", formatCurrencyForExcel(data.revenue.invoicedAmount), data.revenue.invoicedCount]);
  summarySheet.addRow([]);

  // Collections Section
  summarySheet.addRow(["COLLECTIONS — WHAT WAS ACTUALLY RECEIVED TODAY"]);
  createHeaderRow(summarySheet, ["Metric", "Amount"], (summarySheet.lastRow?.number ?? 0) + 1);
  summarySheet.addRow(["Advance Collected", formatCurrencyForExcel(data.revenue.advanceCollected)]);
  summarySheet.addRow(["Safety Deposit Collected", formatCurrencyForExcel(data.revenue.safetyDepositCollected)]);
  summarySheet.addRow(["Damage Fees Collected", formatCurrencyForExcel(data.revenue.damageFeesCollected)]);
  summarySheet.addRow(["Total Collected (All Purposes)", formatCurrencyForExcel(data.revenue.totalCollected)]);
  summarySheet.addRow([]);

  // Damage Section
  summarySheet.addRow(["DAMAGE — CHARGED vs COLLECTED"]);
  createHeaderRow(summarySheet, ["Metric", "Amount / Count"], (summarySheet.lastRow?.number ?? 0) + 1);
  summarySheet.addRow(["New Damage Reports Filed", data.damages.newReports]);
  summarySheet.addRow(["Estimated Cost (at filing)", formatCurrencyForExcel(data.damages.totalEstimatedCost)]);
  summarySheet.addRow(["Approved Reports", data.damages.approvedCount]);
  summarySheet.addRow(["Final Cost Charged (approved)", formatCurrencyForExcel(data.damages.totalFinalCost)]);
  summarySheet.addRow(["Damage Fees Collected", formatCurrencyForExcel(data.damages.collected)]);
  summarySheet.addRow(["Pending Approval", data.damages.pendingApproval]);
  summarySheet.addRow([]);

  // Bookings Section
  summarySheet.addRow(["BOOKING ACTIVITY"]);
  createHeaderRow(summarySheet, ["Metric", "Count"], (summarySheet.lastRow?.number ?? 0) + 1);
  summarySheet.addRow(["New Bookings", data.bookings.newBookings]);
  summarySheet.addRow(["Pickups", data.bookings.pickups]);
  summarySheet.addRow(["Returns", data.bookings.returns]);
  summarySheet.addRow(["Cancellations", data.bookings.cancellations]);
  summarySheet.addRow(["Active (Currently Out)", data.bookings.active]);
  summarySheet.addRow([]);

  // Collections by Method Breakdown
  summarySheet.addRow(["COLLECTIONS BY PAYMENT METHOD"]);
  createHeaderRow(summarySheet, ["Payment Method", "Amount", "Transactions"], (summarySheet.lastRow?.number ?? 0) + 1);
  data.collections.breakdown.forEach((item: any) => {
    summarySheet.addRow([item.method, formatCurrencyForExcel(item.amount), item.count]);
  });

  autoFitColumns(summarySheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export Sales Report to Excel
 */
export const exportSalesReportToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet("Summary");

  addTitleRow(summarySheet, "Sales Report Summary", 2);

  summarySheet.addRow([
    "Period",
    `${formatDateForExcel(data.metadata.period.start)} to ${formatDateForExcel(data.metadata.period.end)}`,
  ]);
  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  createHeaderRow(
    summarySheet,
    ["Metric", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow([
    "Total Revenue",
    formatCurrencyForExcel(data.summary.totalRevenue),
  ]);
  summarySheet.addRow(["Total Bookings", data.summary.totalBookings]);
  summarySheet.addRow([
    "Average Booking Value",
    formatCurrencyForExcel(data.summary.averageBookingValue),
  ]);
  summarySheet.addRow([
    "Tax Collected",
    formatCurrencyForExcel(data.summary.taxCollected),
  ]);
  summarySheet.addRow([
    "Deposits Collected",
    formatCurrencyForExcel(data.summary.depositsCollected),
  ]);
  summarySheet.addRow([
    "Net Revenue",
    formatCurrencyForExcel(data.summary.netRevenue),
  ]);

  autoFitColumns(summarySheet);

  // Sheet 2: Detailed Bookings
  const detailsSheet = workbook.addWorksheet("Bookings");

  const headers = [
    "Booking ID",
    "Date",
    "Customer",
    "Phone",
    "Vehicle",
    "Start Date",
    "End Date",
    "Days",
    "Amount",
    "Status",
    "Branch",
  ];
  createHeaderRow(detailsSheet, headers);

  data.data.forEach((booking: any) => {
    detailsSheet.addRow([
      booking.bookingId,
      formatDateForExcel(booking.bookingDate),
      booking.customer.name,
      booking.customer.phone,
      booking.vehicle.details,
      formatDateForExcel(booking.period.startDate),
      formatDateForExcel(booking.period.endDate),
      booking.period.days,
      formatCurrencyForExcel(booking.financial.totalAmount),
      booking.status,
      booking.branch,
    ]);
  });

  autoFitColumns(detailsSheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export Vehicle History Report to Excel
 */
export const exportVehicleHistoryToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Vehicle Summary
  const summarySheet = workbook.addWorksheet("Vehicle Summary");

  addTitleRow(summarySheet, `Vehicle History - ${data.vehicle.regNo}`, 2);

  summarySheet.addRow([
    "Vehicle",
    `${data.vehicle.make} ${data.vehicle.model}`,
  ]);
  summarySheet.addRow(["Category", data.vehicle.category]);
  summarySheet.addRow(["Branch", data.vehicle.branch]);
  summarySheet.addRow(["Status", data.vehicle.status]);
  summarySheet.addRow([]);

  createHeaderRow(
    summarySheet,
    ["Performance Metric", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow([
    "Total Revenue",
    formatCurrencyForExcel(data.performanceMetrics.totalRevenue),
  ]);
  summarySheet.addRow([
    "Total Bookings",
    data.performanceMetrics.totalBookings,
  ]);
  summarySheet.addRow([
    "Utilization Rate",
    `${data.performanceMetrics.utilizationRate}%`,
  ]);
  summarySheet.addRow([
    "Total Maintenance Cost",
    formatCurrencyForExcel(data.performanceMetrics.totalMaintenanceCost),
  ]);
  summarySheet.addRow([
    "Net Profitability",
    formatCurrencyForExcel(data.performanceMetrics.netProfitability),
  ]);
  summarySheet.addRow(["ROI", `${data.performanceMetrics.roi}%`]);

  autoFitColumns(summarySheet);

  // Sheet 2: Booking History
  const bookingsSheet = workbook.addWorksheet("Booking History");

  const bookingHeaders = [
    "Booking ID",
    "Customer",
    "Phone",
    "Start Date",
    "End Date",
    "Days",
    "Revenue",
    "Status",
    "Return Condition",
  ];
  createHeaderRow(bookingsSheet, bookingHeaders);

  data.bookingHistory.data.forEach((booking: any) => {
    bookingsSheet.addRow([
      booking.bookingId,
      booking.customerName,
      booking.customerPhone,
      formatDateForExcel(booking.startDate),
      formatDateForExcel(booking.endDate),
      booking.days,
      formatCurrencyForExcel(booking.revenue),
      booking.status,
      booking.returnCondition,
    ]);
  });

  autoFitColumns(bookingsSheet);

  // Sheet 3: Maintenance Records
  const maintenanceSheet = workbook.addWorksheet("Maintenance");

  const maintenanceHeaders = [
    "Date",
    "Description",
    "Cost",
    "Odometer",
    "Serviced By",
  ];
  createHeaderRow(maintenanceSheet, maintenanceHeaders);

  data.maintenanceHistory.forEach((record: any) => {
    maintenanceSheet.addRow([
      formatDateForExcel(record.date),
      record.description,
      formatCurrencyForExcel(record.cost),
      record.odometer,
      record.servicedBy,
    ]);
  });

  autoFitColumns(maintenanceSheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export Collection Report to Excel
 */
export const exportCollectionToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet("Summary");
  addTitleRow(
    summarySheet,
    `Collection Report - ${formatDateForExcel(data.metadata.dateRange.startDate)} to ${formatDateForExcel(data.metadata.dateRange.endDate)}`,
    4,
  );

  summarySheet.addRow(["Branch", data.metadata.branch]);
  summarySheet.addRow(["Payment Method", data.metadata.paymentMethod]);
  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["SUMMARY METRICS"]);
  createHeaderRow(
    summarySheet,
    ["Metric", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow([
    "Total Collected",
    formatCurrencyForExcel(data.summary.totalCollected),
  ]);
  summarySheet.addRow(["Total Transactions", data.summary.totalTransactions]);
  summarySheet.addRow([
    "Average Transaction",
    formatCurrencyForExcel(data.summary.averageTransaction),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["METHOD BREAKDOWN"]);
  createHeaderRow(
    summarySheet,
    ["Method", "Amount", "Count"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  Object.entries(data.summary.methodBreakdown).forEach(
    ([method, values]: [string, any]) => {
      summarySheet.addRow([
        method,
        formatCurrencyForExcel(values.amount),
        values.count,
      ]);
    },
  );

  autoFitColumns(summarySheet);

  // Sheet 2: Payments
  const paymentsSheet = workbook.addWorksheet("Payments");
  const headers = [
    "Payment ID",
    "Booking ID",
    "Date",
    "Customer",
    "Phone",
    "Amount",
    "Method",
    "Branch",
  ];
  createHeaderRow(paymentsSheet, headers);

  data.payments.forEach((payment: any) => {
    paymentsSheet.addRow([
      payment.paymentId,
      payment.bookingId,
      formatDateForExcel(payment.collectedAt),
      payment.customerName,
      payment.customerPhone,
      formatCurrencyForExcel(payment.amount),
      payment.method,
      payment.branch,
    ]);
  });
  autoFitColumns(paymentsSheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export Fleet Executive Report to Excel
 */
export const exportFleetExecutiveToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Executive Summary
  const summarySheet = workbook.addWorksheet("Executive Summary");
  addTitleRow(
    summarySheet,
    `Fleet Executive Report - ${formatDateForExcel(data.metadata.dateRange.startDate)} to ${formatDateForExcel(data.metadata.dateRange.endDate)}`,
    4,
  );

  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["KEY PERFORMANCE INDICATORS"]);
  createHeaderRow(
    summarySheet,
    ["KPI", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow(["Total Vehicles", data.kpis.totalVehicles]);
  summarySheet.addRow(["Active Bookings", data.kpis.activeBookings]);
  summarySheet.addRow(["Total Bookings", data.kpis.totalBookings]);
  summarySheet.addRow([
    "Total Revenue",
    formatCurrencyForExcel(data.kpis.totalRevenue),
  ]);
  summarySheet.addRow([
    "Avg Booking Value",
    formatCurrencyForExcel(data.kpis.averageBookingValue),
  ]);
  summarySheet.addRow([
    "Fleet Utilization",
    `${data.kpis.fleetUtilization.toFixed(1)}%`,
  ]);
  summarySheet.addRow([
    "Revenue Per Vehicle",
    formatCurrencyForExcel(data.kpis.revenuePerVehicle),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["OPERATIONAL METRICS"]);
  createHeaderRow(
    summarySheet,
    ["Metric", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow([
    "Damage Reports",
    data.operationalMetrics.damageReports,
  ]);
  summarySheet.addRow([
    "Maintenance Records",
    data.operationalMetrics.maintenanceRecords,
  ]);
  summarySheet.addRow([
    "Damage Rate",
    `${data.operationalMetrics.damageReportRate.toFixed(1)}%`,
  ]);
  summarySheet.addRow([
    "Maintenance Rate",
    `${data.operationalMetrics.maintenanceRate.toFixed(1)}%`,
  ]);

  autoFitColumns(summarySheet);

  // Sheet 2: Branch Performance
  const branchSheet = workbook.addWorksheet("Branch Performance");
  const branchHeaders = [
    "Branch",
    "Total Vehicles",
    "Active",
    "Bookings",
    "Revenue",
    "Avg Booking Value",
    "Utilization",
  ];
  createHeaderRow(branchSheet, branchHeaders);

  data.branchPerformance.forEach((branch: any) => {
    branchSheet.addRow([
      branch.branchName,
      branch.totalVehicles,
      branch.activeVehicles,
      branch.totalBookings,
      formatCurrencyForExcel(branch.totalRevenue),
      formatCurrencyForExcel(branch.averageBookingValue),
      `${branch.utilization.toFixed(1)}%`,
    ]);
  });
  autoFitColumns(branchSheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export GST Report to Excel
 */
export const exportGSTToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet("GST Summary");
  addTitleRow(
    summarySheet,
    `GST Report - ${formatDateForExcel(data.metadata.dateRange.startDate)} to ${formatDateForExcel(data.metadata.dateRange.endDate)}`,
    4,
  );

  summarySheet.addRow(["Branch", data.metadata.branch]);
  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["TAX SUMMARY"]);
  createHeaderRow(
    summarySheet,
    ["Metric", "Amount"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow(["Total Invoices", data.summary.totalInvoices]);
  summarySheet.addRow([
    "Total Taxable Amount",
    formatCurrencyForExcel(data.summary.totalTaxableAmount),
  ]);
  summarySheet.addRow([
    "Total CGST",
    formatCurrencyForExcel(data.summary.totalCGST),
  ]);
  summarySheet.addRow([
    "Total SGST",
    formatCurrencyForExcel(data.summary.totalSGST),
  ]);
  summarySheet.addRow([
    "Total IGST",
    formatCurrencyForExcel(data.summary.totalIGST),
  ]);
  summarySheet.addRow([
    "Total GST",
    formatCurrencyForExcel(data.summary.totalGST),
  ]);
  summarySheet.addRow([
    "Total Invoice Amount",
    formatCurrencyForExcel(data.summary.totalInvoiceAmount),
  ]);

  autoFitColumns(summarySheet);

  // Sheet 2: Invoices (B2B/B2C)
  const invoiceSheet = workbook.addWorksheet("Invoices");
  const invoiceHeaders = [
    "Invoice No",
    "Date",
    "Customer",
    "GSTIN",
    "Taxable Value",
    "CGST",
    "SGST",
    "IGST",
    "Total Tax",
    "Total Amount",
    "Place of Supply",
  ];
  createHeaderRow(invoiceSheet, invoiceHeaders);

  data.invoices.forEach((invoice: any) => {
    invoiceSheet.addRow([
      invoice.invoiceNumber,
      formatDateForExcel(invoice.invoiceDate),
      invoice.customerName,
      invoice.gstin || "-",
      formatCurrencyForExcel(invoice.taxableAmount),
      formatCurrencyForExcel(invoice.cgst),
      formatCurrencyForExcel(invoice.sgst),
      formatCurrencyForExcel(invoice.igst),
      formatCurrencyForExcel(invoice.totalGST),
      formatCurrencyForExcel(invoice.totalAmount),
      invoice.isInterState ? "Inter-State" : "Intra-State",
    ]);
  });
  autoFitColumns(invoiceSheet);

  await sendExcelFile(res, workbook, filename);
};

/**
 * Export Vehicle Availability Report to Excel
 */
export const exportVehicleAvailabilityToExcel = async (
  res: Response,
  data: any,
  filename: string,
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet("Summary");
  addTitleRow(
    summarySheet,
    `Vehicle Availability - ${formatDateForExcel(data.metadata.dateRange.startDate)} to ${formatDateForExcel(data.metadata.dateRange.endDate)}`,
    4,
  );

  summarySheet.addRow(["Branch", data.metadata.branch]);
  summarySheet.addRow([
    "Generated At",
    formatDateForExcel(data.metadata.generatedAt),
  ]);
  summarySheet.addRow([]);

  summarySheet.addRow(["FLEET SUMMARY"]);
  createHeaderRow(
    summarySheet,
    ["Metric", "Value"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );
  summarySheet.addRow(["Total Vehicles", data.summary.totalVehicles]);
  summarySheet.addRow(["Currently Available", data.summary.currentlyAvailable]);
  summarySheet.addRow(["Currently Rented", data.summary.currentlyRented]);
  summarySheet.addRow(["In Maintenance", data.summary.inMaintenance]);
  summarySheet.addRow(["Inactive", data.summary.inactive]);
  summarySheet.addRow(["Upcoming Bookings", data.summary.upcomingBookings]);
  summarySheet.addRow([
    "Overall Utilization",
    `${data.summary.overallUtilization.toFixed(1)}%`,
  ]);

  autoFitColumns(summarySheet);

  summarySheet.addRow([]);
  summarySheet.addRow(["CATEGORY BREAKDOWN"]);
  createHeaderRow(
    summarySheet,
    ["Category", "Total", "Available", "Rented", "Utilization"],
    (summarySheet.lastRow?.number ?? 0) + 1,
  );

  data.categoryBreakdown.forEach((cat: any) => {
    summarySheet.addRow([
      cat.category,
      cat.total,
      cat.available,
      cat.rented,
      `${cat.avgUtilization.toFixed(1)}%`,
    ]);
  });

  // Sheet 2: Vehicles
  const vehicleSheet = workbook.addWorksheet("Vehicles");
  const vehicleHeaders = [
    "Reg No",
    "Make",
    "Model",
    "Category",
    "Branch",
    "Status",
    "Current Status",
    "Utilization",
    "Booked Days",
  ];
  createHeaderRow(vehicleSheet, vehicleHeaders);

  data.vehicles.forEach((vehicle: any) => {
    vehicleSheet.addRow([
      vehicle.regNo,
      vehicle.make,
      vehicle.model,
      vehicle.category,
      vehicle.branch,
      vehicle.status,
      vehicle.currentStatus,
      `${vehicle.utilizationRate.toFixed(1)}%`,
      `${vehicle.bookedDays} / ${vehicle.totalDays}`,
    ]);
  });
  autoFitColumns(vehicleSheet);

  await sendExcelFile(res, workbook, filename);
};

export default {
  sendExcelFile,
  createHeaderRow,
  autoFitColumns,
  addTitleRow,
  exportDailySummaryToExcel,
  exportSalesReportToExcel,
  exportVehicleHistoryToExcel,
  exportCollectionToExcel,
  exportFleetExecutiveToExcel,
  exportGSTToExcel,
  exportVehicleAvailabilityToExcel,
};
