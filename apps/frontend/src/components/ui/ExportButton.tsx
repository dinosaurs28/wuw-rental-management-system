import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { triggerExport, generateFilename } from '@/utils/exportHelpers';
import type { ExportFormat } from '@/types/reports';

// ============================================================================
// ExportButton Component
// ============================================================================

export interface ExportButtonProps {
    apiUrl: string; // API endpoint URL (without export param)
    filename: string; // Base filename for export
    disabled?: boolean;
    className?: string;
}

export const ExportButton = ({ apiUrl, filename, disabled = false, className }: ExportButtonProps) => {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async (format: ExportFormat) => {
        setIsExporting(true);
        try {
            const exportFilename = generateFilename(filename);
            await triggerExport(apiUrl, exportFilename, format);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || isExporting}
                    className={className}
                >
                    <FileDown className="mr-2 h-4 w-4" />
                    {isExporting ? 'Exporting...' : 'Export'}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('xlsx')} disabled={isExporting}>
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
                    Export as Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('csv')} disabled={isExporting}>
                    <FileText className="mr-2 h-4 w-4 text-blue-600" />
                    Export as CSV (.csv)
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
