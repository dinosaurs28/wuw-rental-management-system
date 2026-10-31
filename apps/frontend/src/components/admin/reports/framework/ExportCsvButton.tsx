import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { istToday } from "./format";

export interface ExportCsvButtonProps {
  /** API path relative to the axios base, e.g. "/admin/dashboard/reports/finance/revenue". */
  endpoint: string;
  /** Current filter params (from useReportFilters().params) plus any report-specific ones. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Download name without extension; the date is appended. */
  filename: string;
  label?: string;
  disabled?: boolean;
}

/** Downloads the row-level CSV of a report: GET endpoint?…filters&export=csv. */
export const ExportCsvButton = ({ endpoint, params = {}, filename, label = "Export CSV", disabled }: ExportCsvButtonProps) => {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    try {
      setBusy(true);
      const res = await apiClient.get(endpoint, { params: { ...params, export: "csv" }, responseType: "blob" });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}-${istToday()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      let message = "Export failed";
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        try {
          message = JSON.parse(await data.text()).message ?? message;
        } catch {
          /* keep default */
        }
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" onClick={run} disabled={busy || disabled} className="h-9" data-testid="export-csv">
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
};
