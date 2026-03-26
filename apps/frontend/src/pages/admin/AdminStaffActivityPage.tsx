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
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import {
  adminService,
  type StaffActivityLog,
  type AdminStaffActivityParams,
} from "@/services/admin.service";
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
  CREATED: "bg-green-100 text-green-700 border-green-200",
  APPROVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-rose-100 text-rose-700 border-rose-200",
  DELETED: "bg-red-100 text-red-700 border-red-200",
  UPDATED: "bg-blue-100 text-blue-700 border-blue-200",
  CONFIRMED: "bg-blue-100 text-blue-700 border-blue-200",
  REFUNDED: "bg-purple-100 text-purple-700 border-purple-200",
  SETTLED: "bg-teal-100 text-teal-700 border-teal-200",
  COMPLETED: "bg-teal-100 text-teal-700 border-teal-200",
};

function actionBadge(action: string) {
  const cls = ACTION_COLORS[action] ?? "bg-neutral-100 text-neutral-600 border-neutral-200";
  return (
    <Badge variant="outline" className={`text-xs font-medium border ${cls}`}>
      {action}
    </Badge>
  );
}

function entityBadge(entity: string) {
  return (
    <Badge variant="secondary" className="text-xs font-mono">
      {entity}
    </Badge>
  );
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function DetailSheet({
  log,
  onClose,
}: {
  log: StaffActivityLog | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {log && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2">
                {actionBadge(log.actionType)}
                {entityBadge(log.entityType)}
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 text-sm">
              <Section title="Action">
                <Row label="Action" value={actionBadge(log.actionType)} />
                <Row label="Entity" value={entityBadge(log.entityType)} />
                <Row label="Entity Ref" value={<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.entityRef}</code>} />
                <Row label="Description" value={log.description} />
                <Row label="Time" value={format(new Date(log.createdAt), "dd MMM yyyy, hh:mm:ss a")} />
              </Section>

              <Separator />

              <Section title="Actor">
                <Row label="Name" value={log.actorName} />
                <Row label="Role" value={log.actorRole} />
                <Row label="Public ID" value={<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.actorPublicId}</code>} />
              </Section>

              <Separator />

              <Section title="Branch">
                <Row label="Name" value={log.branchName} />
                <Row label="ID" value={String(log.branchId)} />
              </Section>

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
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground shrink-0 w-24">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AdminStaffActivityPage() {
  const [logs, setLogs] = useState<StaffActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 25, totalPages: 1 });
  const [branches, setBranches] = useState<{ publicId: string; name: string; id: string }[]>([]);

  const [branchId, setBranchId] = useState("");
  const [actionType, setActionType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedLog, setSelectedLog] = useState<StaffActivityLog | null>(null);

  useEffect(() => {
    adminService.getBranches().then((b) => setBranches(b)).catch(() => {});
  }, []);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: AdminStaffActivityParams = { page, limit: 25 };
      if (branchId) params.branchId = branchId;
      if (actionType) params.actionType = actionType;
      if (entityType) params.entityType = entityType;
      if (startDate && endDate) {
        params.startDate = new Date(startDate).toISOString();
        params.endDate = new Date(endDate).toISOString();
      }
      const res = await adminService.getStaffActivity(params);
      setLogs(res.data);
      setPagination(res.meta);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [branchId, actionType, entityType, startDate, endDate]);

  useEffect(() => { fetchLogs(1); }, [branchId, actionType, entityType, startDate, endDate]);

  const hasFilters = !!(branchId || actionType || entityType || startDate || endDate);
  const clearFilters = () => { setBranchId(""); setActionType(""); setEntityType(""); setStartDate(""); setEndDate(""); };

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Staff Activity</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Staff Activity</h1>
          <p className="text-neutral-500 mt-1">All staff actions across every branch.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchLogs(pagination.page)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Branch */}
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger><SelectValue placeholder="All Actions" /></SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger><SelectValue placeholder="All Entities" /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>

            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="text-sm" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="text-sm" />
          </div>

          {hasFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Active:</span>
              {branchId && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  Branch #{branchId}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setBranchId("")} />
                </Badge>
              )}
              {actionType && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {actionType}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setActionType("")} />
                </Badge>
              )}
              {entityType && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {entityType}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setEntityType("")} />
                </Badge>
              )}
              {(startDate || endDate) && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  {startDate} → {endDate}
                  <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => { setStartDate(""); setEndDate(""); }} />
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>Clear all</Button>
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
              <Activity className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">No staff activity found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead className="max-w-[240px]">Description</TableHead>
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
                        <div className="text-sm font-medium">{log.actorName}</div>
                        <div className="text-xs text-muted-foreground">{log.actorRole}</div>
                      </TableCell>
                      <TableCell className="text-sm">{log.branchName}</TableCell>
                      <TableCell>{actionBadge(log.actionType)}</TableCell>
                      <TableCell>{entityBadge(log.entityType)}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.entityRef}</code>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">
                        {log.description || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {!loading && logs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              {((pagination.page - 1) * pagination.limit) + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total.toLocaleString()} records
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => fetchLogs(pagination.page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => fetchLogs(pagination.page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <DetailSheet log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}
