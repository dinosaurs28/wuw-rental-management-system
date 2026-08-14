import { useEffect, useState, useCallback } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  Filter,
  Clock,
  User,
  Building2,
  Tag,
  FileText,
  Hash,
} from "lucide-react";
import {
  managerDashboardService,
  type StaffActivityLog,
  type StaffActivityParams,
} from "@/services/managerDashboard.service";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { format, formatDistanceToNow } from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_TYPES = [
  "CREATED","APPROVED","REJECTED","CANCELLED","CONFIRMED","UPDATED","DELETED",
  "UPLOADED","SWAPPED","REFUNDED","ASSESSED","INITIATED","COMPLETED","APPLIED",
  "OVERRIDDEN","RECALCULATED","FLAGGED","COLLECTED","RECONCILED","SETTLED",
  "DISBURSED","EXTENDED",
];

const ENTITY_TYPES = [
  "BOOKING","INVOICE","PAYMENT","CUSTOMER","VEHICLE","KYC","DAMAGE_REPORT",
  "DEPOSIT","EMPLOYEE","PRICING","CAPTURE_CONFIG","DISCOUNT_RULE",
  "DISCOUNT_APPLICATION","MANUAL_DISCOUNT","PAYMENT_TRANSACTION","CASH_SHIFT",
  "REFUND_REQUEST","BOOKING_EXTENSION","CHARGE_ENTRY","CHARGE_OVERRIDE",
  "FUEL_RECORD","SAFETY_DEPOSIT_REQUEST","BRANCH_CHARGE_CONFIG","PAYMENT_SESSION",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  CREATED:  "bg-green-100 text-green-700 border-green-200",
  APPROVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED:"bg-rose-100 text-rose-700 border-rose-200",
  DELETED:  "bg-red-100 text-red-700 border-red-200",
  UPDATED:  "bg-blue-100 text-blue-700 border-blue-200",
  CONFIRMED:"bg-blue-100 text-blue-700 border-blue-200",
  REFUNDED: "bg-purple-100 text-purple-700 border-purple-200",
  SETTLED:  "bg-teal-100 text-teal-700 border-teal-200",
  COMPLETED:"bg-teal-100 text-teal-700 border-teal-200",
};

const ACTION_DOT: Record<string, string> = {
  CREATED:  "bg-green-500",
  APPROVED: "bg-emerald-500",
  REJECTED: "bg-red-500",
  CANCELLED:"bg-rose-500",
  DELETED:  "bg-red-500",
  UPDATED:  "bg-blue-500",
  CONFIRMED:"bg-blue-500",
  REFUNDED: "bg-purple-500",
  SETTLED:  "bg-teal-500",
  COMPLETED:"bg-teal-500",
};

function actionBadge(action: string) {
  const cls = ACTION_COLORS[action] ?? "bg-neutral-100 text-neutral-600 border-neutral-200";
  const dot = ACTION_DOT[action] ?? "bg-neutral-400";
  return (
    <Badge variant="outline" className={`text-[11px] font-medium border gap-1.5 ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {action}
    </Badge>
  );
}

function entityBadge(entity: string) {
  return (
    <Badge variant="secondary" className="text-[11px] font-mono text-neutral-600 bg-neutral-100 border-neutral-200">
      {entity}
    </Badge>
  );
}

const avatarColors = [
  "bg-orange-100 text-orange-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
];

const getInitials = (name: string) =>
  name?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";

const getAvatarColor = (name: string) =>
  avatarColors[(name?.charCodeAt(0) ?? 0) % avatarColors.length];

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function DetailSheet({ log, onClose }: { log: StaffActivityLog | null; onClose: () => void }) {
  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px] p-0 overflow-y-auto flex flex-col">
        {log && (
          <>
            {/* Sheet header */}
            <SheetHeader className="px-6 pt-6 pb-5 border-b border-neutral-100 bg-neutral-50/60 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center flex-wrap gap-1.5">
                    {actionBadge(log.actionType)}
                    {entityBadge(log.entityType)}
                  </div>
                  <SheetTitle className="text-[15px] font-semibold text-neutral-900 leading-snug">
                    {log.description || "No description"}
                  </SheetTitle>
                  <p className="text-xs text-neutral-400">
                    {format(new Date(log.createdAt), "dd MMM yyyy 'at' hh:mm:ss a")}
                  </p>
                </div>
              </div>
            </SheetHeader>

            <div className="px-6 py-5 space-y-6 text-sm flex-1">

              {/* Actor */}
              <SheetSection icon={<User className="w-3.5 h-3.5" />} title="Actor">
                <div className="flex items-center gap-3 p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${getAvatarColor(log.actorName || "")}`}>
                    {getInitials(log.actorName || "")}
                  </div>
                  <div>
                    <p className="font-semibold text-neutral-900 text-sm">{log.actorName || "—"}</p>
                    <p className="text-xs text-neutral-500 font-mono mt-0.5">{log.actorRole}</p>
                  </div>
                </div>
                <SheetField label="Public ID">
                  <code className="text-xs bg-neutral-100 px-2 py-1 rounded font-mono text-neutral-600 break-all">
                    {log.actorPublicId}
                  </code>
                </SheetField>
              </SheetSection>

              <Separator />

              {/* Activity */}
              <SheetSection icon={<Tag className="w-3.5 h-3.5" />} title="Activity">
                <div className="grid grid-cols-2 gap-3">
                  <SheetField label="Action">{actionBadge(log.actionType)}</SheetField>
                  <SheetField label="Entity">{entityBadge(log.entityType)}</SheetField>
                </div>
                <SheetField label="Entity Reference">
                  <code className="text-xs bg-neutral-100 px-2 py-1 rounded font-mono text-neutral-600">
                    {log.entityRef || "—"}
                  </code>
                </SheetField>
                {log.description && (
                  <SheetField label="Description">
                    <p className="text-sm text-neutral-700 leading-relaxed bg-neutral-50 p-3 rounded-lg border border-neutral-100">
                      {log.description}
                    </p>
                  </SheetField>
                )}
              </SheetSection>

              <Separator />

              {/* Branch */}
              <SheetSection icon={<Building2 className="w-3.5 h-3.5" />} title="Branch">
                <div className="grid grid-cols-2 gap-3">
                  <SheetField label="Name">
                    <span className="font-medium text-neutral-900">{log.branchName || "—"}</span>
                  </SheetField>
                  <SheetField label="Branch ID">
                    <code className="text-xs bg-neutral-100 px-2 py-1 rounded font-mono text-neutral-600">
                      {log.branchId}
                    </code>
                  </SheetField>
                </div>
              </SheetSection>

              {log.metadata && (
                <>
                  <Separator />
                  <SheetSection icon={<FileText className="w-3.5 h-3.5" />} title="Metadata">
                    <pre className="text-xs bg-neutral-950 text-neutral-200 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </SheetSection>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">{icon}</span>
        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-widest">{title}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SheetField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-neutral-400 font-medium uppercase tracking-wide">{label}</span>
      <div>{children}</div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ManagerStaffActivityPage() {
  const [logs, setLogs] = useState<StaffActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 25, totalPages: 1 });

  const [actionType, setActionType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(Date.now() + 86400000), "yyyy-MM-dd"));

  const [selectedLog, setSelectedLog] = useState<StaffActivityLog | null>(null);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: StaffActivityParams = { page, limit: 25 };
      if (actionType) params.actionType = actionType;
      if (entityType) params.entityType = entityType;
      if (startDate && endDate) {
        params.startDate = new Date(startDate).toISOString();
        params.endDate = new Date(endDate).toISOString();
      }
      const res = await managerDashboardService.getStaffActivityFull(params);
      setLogs(res.data);
      setPagination(res.meta);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [actionType, entityType, startDate, endDate]);

  useEffect(() => { fetchLogs(1); }, [actionType, entityType, startDate, endDate]);

  const hasFilters = !!(actionType || entityType || startDate || endDate);
  const clearFilters = () => { setActionType(""); setEntityType(""); setStartDate(""); setEndDate(""); };

  const startItem = ((pagination.page - 1) * pagination.limit) + 1;
  const endItem = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div>
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Staff Activity</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
                Staff Activity
              </h1>
              {!loading && pagination.total > 0 && (
                <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-neutral-100 text-neutral-600 text-xs font-semibold">
                  {pagination.total.toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              All actions performed by your branch staff.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-shrink-0 h-9"
            onClick={() => fetchLogs(pagination.page)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden mb-5">
          {/* Filter bar header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50/60">
            <Filter className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Filters</span>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto text-xs text-orange-500 hover:text-orange-600 font-medium transition-colors flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>

          <div className="p-4">
            <div className="flex flex-wrap gap-4 items-end">

              {/* Action type */}
              <div className="flex flex-col gap-1.5 w-[180px]">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Action</label>
                <Select value={actionType} onValueChange={setActionType}>
                  <SelectTrigger className="h-9 text-sm bg-neutral-50 border-neutral-200">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4} className="w-[var(--radix-select-trigger-width)] max-h-60">
                    {ACTION_TYPES.map((a) => (
                      <SelectItem key={a} value={a} className="text-sm">{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity type */}
              <div className="flex flex-col gap-1.5 w-[210px]">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Entity</label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger className="h-9 text-sm bg-neutral-50 border-neutral-200">
                    <SelectValue placeholder="All entities" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4} className="w-[var(--radix-select-trigger-width)] max-h-60">
                    {ENTITY_TYPES.map((e) => (
                      <SelectItem key={e} value={e} className="text-sm font-mono">{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date range */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Date Range</label>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-neutral-400 font-medium px-0.5">From</span>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-9 text-sm w-[148px] bg-neutral-50 border-neutral-200"
                    />
                  </div>
                  <span className="text-neutral-300 mt-4 text-base select-none">→</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-neutral-400 font-medium px-0.5">To</span>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-9 text-sm w-[148px] bg-neutral-50 border-neutral-200"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Active chips */}
            {hasFilters && (
              <div className="mt-4 pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-400 font-medium">Active:</span>
                {actionType && (
                  <Badge variant="secondary" className="gap-1 text-xs h-6 pl-2 pr-1.5 font-medium">
                    {actionType}
                    <button className="hover:text-neutral-900 transition-colors" onClick={() => setActionType("")}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {entityType && (
                  <Badge variant="secondary" className="gap-1 text-xs h-6 pl-2 pr-1.5 font-mono">
                    {entityType}
                    <button className="hover:text-neutral-900 transition-colors" onClick={() => setEntityType("")}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {(startDate || endDate) && (
                  <Badge variant="secondary" className="gap-1 text-xs h-6 pl-2 pr-1.5">
                    {startDate} → {endDate}
                    <button className="hover:text-neutral-900 transition-colors" onClick={() => { setStartDate(""); setEndDate(""); }}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 bg-neutral-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                <Activity className="h-7 w-7 text-neutral-300" />
              </div>
              <p className="font-medium text-neutral-700 mb-1">No activity found</p>
              <p className="text-sm text-neutral-400">Try adjusting your filters or date range.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap w-[130px]">
                        <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" />Time</span>
                      </th>
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Actor</th>
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Action</th>
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Entity</th>
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                        <span className="flex items-center gap-1.5"><Hash className="w-3 h-3" />Ref</span>
                      </th>
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {logs.map((log) => (
                      <tr
                        key={log.publicId}
                        className="cursor-pointer hover:bg-orange-50/40 transition-colors group"
                        onClick={() => setSelectedLog(log)}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className="text-xs text-neutral-600 font-medium">
                            {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                          </p>
                          <p className="text-[10px] text-neutral-400 mt-0.5 font-mono">
                            {format(new Date(log.createdAt), "dd MMM, HH:mm")}
                          </p>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${getAvatarColor(log.actorName || "")}`}>
                              {getInitials(log.actorName || "")}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-neutral-900 leading-none">{log.actorName}</p>
                              <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">{log.actorRole}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">{actionBadge(log.actionType)}</td>
                        <td className="px-5 py-3.5">{entityBadge(log.entityType)}</td>
                        <td className="px-5 py-3.5">
                          <code className="text-[11px] bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded font-mono">
                            {log.entityRef || "—"}
                          </code>
                        </td>
                        <td className="px-5 py-3.5 max-w-[240px]">
                          <p className="text-xs text-neutral-500 truncate">
                            {log.description || <span className="text-neutral-300">—</span>}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-neutral-100 bg-neutral-50/40">
                <p className="text-sm text-neutral-500">
                  Showing{" "}
                  <span className="font-medium text-neutral-700">{startItem}–{endItem}</span>{" "}
                  of{" "}
                  <span className="font-medium text-neutral-700">{pagination.total.toLocaleString()}</span>{" "}
                  records
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pagination.page <= 1}
                    onClick={() => fetchLogs(pagination.page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-neutral-600 px-2 min-w-[90px] text-center">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchLogs(pagination.page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <DetailSheet log={selectedLog} onClose={() => setSelectedLog(null)} />
      </div>
    </ManagerLayout>
  );
}
