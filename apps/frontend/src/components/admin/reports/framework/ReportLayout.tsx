import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface ReportLayoutProps {
  title: string;
  description?: string;
  /** Spec section, e.g. "2.1" — shown as a small tag. */
  section?: string;
  /** Usually a <ReportFilterBar/>. */
  filters?: ReactNode;
  /** Usually an <ExportCsvButton/>. */
  actions?: ReactNode;
  /** Business-rule notes / "not tracked" explanations shown under the content. */
  notes?: ReactNode[];
  children: ReactNode;
}

/** Consistent page chrome for every admin report. */
export const ReportLayout = ({ title, description, section, filters, actions, notes, children }: ReportLayoutProps) => (
  <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 md:px-6">
    <Breadcrumb className="mb-2">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin/dashboard" className="text-muted-foreground hover:text-[#FF5F00]">
              Admin
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin/reports/hub" className="text-muted-foreground hover:text-[#FF5F00]">
              Reports
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="font-semibold text-neutral-900">{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-neutral-900 md:text-3xl">
          {title}
          {section && (
            <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-500">{section}</span>
          )}
        </h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {filters && <div className="mb-6">{filters}</div>}
    {children}
    {notes && notes.length > 0 && (
      <div className="mt-8 space-y-1 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-600">
        {notes.map((n, i) => (
          <p key={i} className="flex gap-1.5">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" aria-hidden />
            <span>{n}</span>
          </p>
        ))}
      </div>
    )}
  </div>
);
