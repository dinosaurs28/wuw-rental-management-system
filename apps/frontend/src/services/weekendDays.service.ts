import apiClient from "@/lib/axios";
import { ISO_WEEKDAYS } from "@repo/schemas";

/**
 * The days the manager's branch bills at the weekend rents (weekend-wise
 * pricing) — ISO weekdays, 1 = Mon … 7 = Sun. Empty = no weekend rates.
 */
export const fetchWeekendDays = async (): Promise<number[]> => {
  const res = await apiClient.get("/branchManager/dashboard/branch/weekend-days");
  return res.data.weekendDays ?? [];
};

export const saveWeekendDays = async (weekendDays: number[]): Promise<number[]> => {
  const res = await apiClient.patch("/branchManager/dashboard/branch/weekend-days", { weekendDays });
  return res.data.weekendDays ?? weekendDays;
};

/** "Sat, Sun" — the picked days in week order. */
export const weekendDaysLabel = (days: number[]): string =>
  ISO_WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(", ");
