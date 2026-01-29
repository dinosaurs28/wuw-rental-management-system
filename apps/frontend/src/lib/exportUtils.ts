/**
 * Export utilities for dashboard data
 */

/**
 * Convert data to CSV format and trigger download
 */
export const exportToCSV = (data: any[], filename: string): void => {
    if (!data || data.length === 0) {
        console.warn('No data to export');
        return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV content
    const csvContent = [
        // Header row
        headers.join(','),
        // Data rows
        ...data.map(row =>
            headers.map(header => {
                const value = row[header];
                // Escape values containing commas or quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? '';
            }).join(',')
        )
    ].join('\n');

    // Create blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(url);
};

/**
 * Format dashboard data for CSV export
 */
export const formatDashboardDataForExport = (data: {
    revenueTrends: any[];
    categoryBreakdown: any[];
    branchComparison: any[];
    paymentMethods: any[];
}) => {
    const timestamp = new Date().toISOString().split('T')[0];

    return {
        revenueTrends: {
            filename: `revenue-trends_${timestamp}.csv`,
            data: data.revenueTrends.map(item => ({
                Period: item.period,
                'Total Revenue (₹)': item.totalRevenue,
                'Booking Count': item.bookingCount,
                'Avg Revenue Per Booking (₹)': item.avgRevenuePerBooking?.toFixed(2) || 0,
                Branch: item.branchName || 'All Branches'
            }))
        },
        categoryBreakdown: {
            filename: `category-breakdown_${timestamp}.csv`,
            data: data.categoryBreakdown.map(item => ({
                Category: item.categoryName,
                'Total Revenue (₹)': item.totalRevenue,
                'Booking Count': item.bookingCount,
                'Vehicle Count': item.vehicleCount,
                'Avg Revenue Per Vehicle (₹)': item.avgRevenuePerVehicle?.toFixed(2) || 0
            }))
        },
        branchComparison: {
            filename: `branch-comparison_${timestamp}.csv`,
            data: data.branchComparison.map(item => ({
                Branch: item.branchName,
                'Total Revenue (₹)': item.totalRevenue,
                'Net Profit (₹)': item.netProfit || 0,
                Currency: item.currency || 'INR'
            }))
        },
        paymentMethods: {
            filename: `payment-methods_${timestamp}.csv`,
            data: data.paymentMethods.map(item => ({
                'Payment Method': item.paymentMethod === 'ONLINE_RAZORPAY' ? 'Online' : item.paymentMethod,
                'Total Revenue (₹)': item.totalRevenue,
                'Transaction Count': item.transactionCount,
                'Avg Transaction Value (₹)': item.avgTransactionValue?.toFixed(2) || 0,
                'Share (%)': item.percentageShare?.toFixed(2) || 0
            }))
        },
        combined: {
            filename: `dashboard-analytics_${timestamp}.csv`,
            data: [
                { Section: 'Revenue Trends', 'Data Points': data.revenueTrends.length },
                { Section: 'Category Breakdown', 'Data Points': data.categoryBreakdown.length },
                { Section: 'Branch Comparison', 'Data Points': data.branchComparison.length },
                { Section: 'Payment Methods', 'Data Points': data.paymentMethods.length },
                { Section: 'Total Revenue', 'Data Points': `₹${data.branchComparison.reduce((sum, b) => sum + b.totalRevenue, 0).toLocaleString()}` }
            ]
        }
    };
};

/**
 * Export all dashboard data as a single CSV
 */
export const exportAllDashboardData = (data: {
    revenueTrends: any[];
    categoryBreakdown: any[];
    branchComparison: any[];
    paymentMethods: any[];
}): void => {
    const formatted = formatDashboardDataForExport(data);

    // Combine all data into sections
    const combinedData: any[] = [];

    // Add revenue trends
    combinedData.push({ 'Section': 'REVENUE TRENDS' });
    combinedData.push(...formatted.revenueTrends.data);
    combinedData.push({}); // Empty row separator

    // Add category breakdown
    combinedData.push({ 'Section': 'CATEGORY BREAKDOWN' });
    combinedData.push(...formatted.categoryBreakdown.data);
    combinedData.push({});

    // Add branch comparison
    combinedData.push({ 'Section': 'BRANCH COMPARISON' });
    combinedData.push(...formatted.branchComparison.data);
    combinedData.push({});

    // Add payment methods
    combinedData.push({ 'Section': 'PAYMENT METHOD DISTRIBUTION' });
    combinedData.push(...formatted.paymentMethods.data);

    exportToCSV(combinedData, formatted.combined.filename);
};
