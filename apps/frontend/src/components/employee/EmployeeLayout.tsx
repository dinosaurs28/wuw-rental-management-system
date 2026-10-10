import type { ReactNode } from "react";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";

/** Fleet web page chrome: the staff navbar over a light page. */
export function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />
      {children}
    </div>
  );
}
