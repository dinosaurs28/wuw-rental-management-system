import { useEffect, useState, useCallback } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { adminService, type AuditLog } from "@/services/admin.service";
import { format, formatDistanceToNow } from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "BOOKING",
  "PAYMENT",
  "VEHICLE",
  "CUSTOMER",
  "EMPLOYEE",
  "BRANCH",
  "AUTH",
  "SYSTEM",
  "DISCOUNT",
  "CHARGE",
];

const SEVERITIES = ["INFO", "WARNING", "CRITICAL"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityBadge(severity: string) {
  if (severity === "CRITICAL")
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        Critical
      </Badge>
    );
  if (severity === "WARNING")
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Info className="h-3 w-3" />
      Info
    </Badge>
  );
}

function categoryBadge(category: string) {
  const colorMap: Record<string, string> = {
    BOOKING: "bg-blue-100 text-blue-700 border-blue-200",
    PAYMENT: "bg-green-100 text-green-700 border-green-200",
    VEHICLE: "bg-purple-100 text-purple-700 border-purple-200",
    CUSTOMER: "bg-cyan-100 text-cyan-700 border-cyan-200",
    EMPLOYEE: "bg-indigo-100 text-indigo-700 border-indigo-200",
    BRANCH: "bg-orange-100 text-orange-700 border-orange-200",
    AUTH: "bg-rose-100 text-rose-700 border-rose-200",
    SYSTEM: "bg-neutral-100 text-neutral-600 border-neutral-200",
    DISCOUNT: "bg-yellow-100 text-yellow-700 border-yellow-200",
    CHARGE: "bg-teal-100 text-teal-700 border-teal-200",
  };
  const cls = colorMap[category] ?? "bg-neutral-100 text-neutral-600 border-neutral-200";
  return (
    <Badge variant="outline" className={`text-xs font-medium border ${cls}`}>
      {category}
    </Badge>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-full p-2 bg-muted">{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function AuditLogDetail({
  log,
  onClose,
}: {
  log: AuditLog | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {log && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2">
                {severityBadge(log.severity)}
                <span className="font-mono text-sm text-muted-foreground">
                  {log.publicId}
                </span>
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 text-sm">
              <Section title="Event">
                <Row label="Action" value={<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.action}</code>} />
                <Row label="Category" value={categoryBadge(log.category)} />
                <Row label="Severity" value={severityBadge(log.severity)} />
                <Row label="Description" value={log.description || "—"} />
                <Row
                  label="Time"
                  value={format(new Date(log.createdAt), "dd MMM yyyy, hh:mm:ss a")}
                />
              </Section>

              <Separator />

              <Section title="Actor">
                <Row label="Name" value={log.actorName || "—"} />
                <Row label="Role" value={log.actorRole} />
                {log.approverName && (
                  <Row label="Approver" value={`${log.approverName} (${log.approverRole})`} />
                )}
              </Section>

              <Separator />

              <Section title="Entity">
                <Row label="Type" value={log.entity || "—"} />
                <Row label="ID" value={<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.entityId || "—"}</code>} />
                {log.entityLabel && <Row label="Label" value={log.entityLabel} />}
              </Section>

              {log.changedFields?.length > 0 && (
                <>
                  <Separator />
                  <Section title="Changed Fields">
                    <div className="flex flex-wrap gap-1 mt-1">
                      {log.changedFields.map((f) => (
                        <Badge key={f} variant="outline" className="text-xs font-mono">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {(log.before || log.after) && (
                <>
                  <Separator />
                  <Section title="Data Diff">
                    {log.before && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Before</p>
                        <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(log.before, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.after && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">After</p>
                        <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(log.after, null, 2)}
                        </pre>
                      </div>
                    )}
                  </Section>
                </>
              )}

              {log.metadata && (
                <>
                  <Separator />
                  <Section title="Metadata">
                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </Section>
                </>
              )}

              {(log.ipAddress || log.userAgent) && (
                <>
                  <Separator />
                  <Section title="Request">
                    {log.ipAddress && <Row label="IP" value={log.ipAddress} />}
                    {log.userAgent && (
                      <Row
                        label="User Agent"
                        value={
                          <span className="text-xs text-muted-foreground break-all">
                            {log.userAgent}
                          </span>
                        }
                      />
                    )}
                  </Section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground shrink-0 w-28">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1,
  });

  const [stats, setStats] = useState<{
    info: number;
    warning: number;
    critical: number;
    total: number;
  }>({ info: 0, warning: 0, critical: 0, total: 0 });

  // Filters
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params: Record<string, any> = { page, limit: pagination.limit };
        if (category) params.category = category;
        if (severity) params.severity = severity;
        if (search) params.action = search;
        if (startDate && endDate) {
          params.startDate = new Date(startDate).toISOString();
          params.endDate = new Date(endDate).toISOString();
        }
        const res = await adminService.getAuditLogs(params);
        setLogs(res.data);
        setPagination(res.pagination);
      } catch {
        // silently fail — table stays empty
      } finally {
        setLoading(false);
      }
    },
    [category, severity, search, startDate, endDate, pagination.limit]
  );

  const fetchStats = useCallback(async () => {
    try {
      const res = await adminService.getAuditStats({});
      const sev = res.data.bySeverity;
      const get = (s: string) => sev.find((x) => x.severity === s)?.count ?? 0;
      const total = sev.reduce((a, b) => a + b.count, 0);
      setStats({
        info: get("INFO"),
        warning: get("WARNING"),
        critical: get("CRITICAL"),
        total,
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchLogs(1);
  }, [category, severity, search, startDate, endDate]);

  const hasFilters = !!(category || severity || search || startDate || endDate);

  const clearFilters = () => {
    setCategory("");
    setSeverity("");
    setSearch("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Audit Log</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Title */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            Audit Log
          </h1>
          <p className="text-neutral-500 mt-1">
            Full activity trail across all system actions.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { fetchLogs(pagination.page); fetchStats(); }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Events"
          value={stats.total}
          icon={<Info className="h-4 w-4 text-neutral-500" />}
        />
        <StatCard
          label="Info"
          value={stats.info}
          icon={<Info className="h-4 w-4 text-blue-500" />}
        />
        <StatCard
          label="Warnings"
          value={stats.warning}
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        />
        <StatCard
          label="Critical"
          value={stats.critical}
          icon={<ShieldAlert className="h-4 w-4 text-red-500" />}
        />
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search action…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-sm"
            />
          </div>

          {hasFilters && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Active filters:</span>
              {category && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {category}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setCategory("")} />
                </Badge>
              )}
              {severity && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {severity}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setSeverity("")} />
                </Badge>
              )}
              {search && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  action: {search}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setSearch("")} />
                </Badge>
              )}
              {(startDate || endDate) && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {startDate} → {endDate}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => { setStartDate(""); setEndDate(""); }} />
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>
                Clear all
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Info className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">No audit logs found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="max-w-[260px]">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow
                      key={log.publicId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <span title={format(new Date(log.createdAt), "dd MMM yyyy, hh:mm:ss a")}>
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{log.actorName || "System"}</div>
                        <div className="text-xs text-muted-foreground">{log.actorRole}</div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {log.action}
                        </code>
                      </TableCell>
                      <TableCell>{categoryBadge(log.category)}</TableCell>
                      <TableCell>{severityBadge(log.severity)}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground">{log.entity}</span>
                        {log.entityLabel && (
                          <span className="block font-medium text-neutral-700">{log.entityLabel}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                        {log.description || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              {((pagination.page - 1) * pagination.limit) + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total.toLocaleString()} events
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => fetchLogs(pagination.page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchLogs(pagination.page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Sheet */}
      <AuditLogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}
