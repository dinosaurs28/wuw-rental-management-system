import apiClient from "@/lib/axios";
import type { ReportFilterOptions } from "./types";

let cache: Promise<ReportFilterOptions> | null = null;

/** Branches, categories and vehicles (publicIds) for the filter pickers. Cached per page load. */
export const getReportFilterOptions = (): Promise<ReportFilterOptions> => {
  if (!cache) {
    cache = apiClient
      .get<ReportFilterOptions>("/admin/dashboard/reports/filter-options")
      .then((r) => r.data)
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
};
