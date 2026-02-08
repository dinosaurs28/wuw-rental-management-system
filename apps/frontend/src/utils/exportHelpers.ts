import type { ExportFormat } from '@/types/reports';
import { toast } from 'sonner';

// ============================================================================
// Date Range Helper Functions
// ============================================================================

export type DateRangePreset = 'current' | '15days' | '30days' | '60days' | '90days' | 'custom';

/**
 * Get start and end dates based on preset
 * @param preset - Date range preset
 * @returns Object with start and end dates
 */
export const getDateRangeFromPreset = (preset: DateRangePreset): { startDate: Date; endDate: Date } => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    switch (preset) {
        case 'current':
            // Today only
            break;
        case '15days':
            startDate.setDate(startDate.getDate() - 15);
            break;
        case '30days':
            startDate.setDate(startDate.getDate() - 30);
            break;
        case '60days':
            startDate.setDate(startDate.getDate() - 60);
            break;
        case '90days':
            startDate.setDate(startDate.getDate() - 90);
            break;
        case 'custom':
            // Will be overridden by custom date picker
            break;
    }

    return { startDate, endDate };
};

// ============================================================================
// Export Helper Functions
// ============================================================================

/**
 * Trigger file download from blob
 * @param blob - File blob
 * @param filename - Filename for download
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
};

/**
 * Trigger export download from backend
 * @param url - API endpoint URL with export=xlsx or export=csv param
 * @param filename - Base filename (extension will be added)
 * @param format - Export format
 */
export const triggerExport = async (
    url: string,
    filename: string,
    format: ExportFormat
): Promise<void> => {
    try {
        // Add export format to URL
        const exportUrl = new URL(url, window.location.origin);
        exportUrl.searchParams.set('export', format);

        // Show loading toast
        const toastId = toast.loading(`Generating ${format.toUpperCase()} file...`);

        // Fetch the file
        const response = await fetch(exportUrl.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Include cookies for auth
        });

        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }

        // Get the blob
        const blob = await response.blob();

        // Determine file extension
        const extension = format === 'xlsx' ? 'xlsx' : 'csv';
        const fullFilename = `${filename}.${extension}`;

        // Trigger download
        downloadBlob(blob, fullFilename);

        // Show success toast
        toast.success(`${format.toUpperCase()} file downloaded successfully`, {
            id: toastId,
        });
    } catch (error) {
        console.error('Export error:', error);
        toast.error(`Failed to export ${format.toUpperCase()} file. Please try again.`);
    }
};

/**
 * Generate filename with date
 * @param baseName - Base name for file
 * @param includeDate - Whether to include date in filename (default: true)
 * @returns Filename string
 */
export const generateFilename = (baseName: string, includeDate: boolean = true): string => {
    if (!includeDate) {
        return baseName;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    return `${baseName}_${dateStr}`;
};

// ============================================================================
// API URL Helper Functions
// ============================================================================

/**
 * Build API URL with query parameters
 * @param endpoint - API endpoint path
 * @param params - Query parameters object
 * @returns Complete URL string
 */
export const buildApiUrl = (endpoint: string, params?: Record<string, any>): string => {
    const url = new URL(endpoint, window.location.origin);

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                // Convert Date objects to ISO strings
                if (value instanceof Date) {
                    url.searchParams.set(key, value.toISOString());
                } else {
                    url.searchParams.set(key, String(value));
                }
            }
        });
    }

    return url.toString();
};
