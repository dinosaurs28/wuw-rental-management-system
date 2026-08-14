import { useCallback, useEffect, useState } from "react";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    Users,
    Building2,
    Loader2,
    ArrowRightLeft,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import {
    adminService,
    type AdminBranch,
    type BranchStaffingStats,
    type TransferableUser,
} from "@/services/admin.service";

const getRoleBadge = (role: string) => {
    switch (role) {
        case "MANAGER":
            return "bg-orange-100 text-orange-700 border-orange-200";
        default:
            return "bg-blue-100 text-blue-700 border-blue-200";
    }
};

export const AdminUserTransferPage = () => {
    const [branches, setBranches] = useState<AdminBranch[]>([]);
    const [stats, setStats] = useState<BranchStaffingStats[]>([]);
    const [totals, setTotals] = useState<{ managers: { active: number; inactive: number; total: number }; employees: { active: number; inactive: number; total: number } } | null>(null);
    const [isLoadingStats, setIsLoadingStats] = useState(true);

    const [branchFilter, setBranchFilter] = useState("");
    const [roleFilter, setRoleFilter] = useState("");
    const [search, setSearch] = useState("");

    const [users, setUsers] = useState<TransferableUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

    const [transferTarget, setTransferTarget] = useState<TransferableUser | null>(null);
    const [toBranchId, setToBranchId] = useState("");
    const [reason, setReason] = useState("");
    const [isTransferring, setIsTransferring] = useState(false);

    const fetchStats = useCallback(async () => {
        setIsLoadingStats(true);
        try {
            const res = await adminService.getBranchStaffingStats();
            setStats(res.data);
            setTotals(res.totals);
        } catch {
            toast.error("Failed to load staffing stats");
        } finally {
            setIsLoadingStats(false);
        }
    }, []);

    const fetchUsers = useCallback(async (page = 1) => {
        setIsLoadingUsers(true);
        try {
            const res = await adminService.getBranchUsers({
                branchId: branchFilter || undefined,
                role: (roleFilter as "MANAGER" | "STAFF") || undefined,
                search: search || undefined,
                page,
                limit: 10,
            });
            setUsers(res.data);
            setPagination({ page: res.meta.page, totalPages: res.meta.totalPages, total: res.meta.total });
        } catch {
            toast.error("Failed to load users");
        } finally {
            setIsLoadingUsers(false);
        }
    }, [branchFilter, roleFilter, search]);

    useEffect(() => {
        adminService.getBranches().then(setBranches).catch(() => {});
        fetchStats();
    }, [fetchStats]);

    useEffect(() => {
        fetchUsers(1);
    }, [fetchUsers]);

    const openTransferDialog = (user: TransferableUser) => {
        setTransferTarget(user);
        setToBranchId("");
        setReason("");
    };

    const handleTransfer = async () => {
        if (!transferTarget || !toBranchId) return;
        try {
            setIsTransferring(true);
            await adminService.transferUser(transferTarget.publicId, {
                toBranchId,
                reason: reason.trim() || undefined,
            });
            toast.success(`${transferTarget.name} transferred successfully`);
            setTransferTarget(null);
            fetchStats();
            fetchUsers(pagination.page);
        } catch (error: any) {
            toast.error(error?.response?.data?.message ?? "Failed to transfer user");
        } finally {
            setIsTransferring(false);
        }
    };

    const targetBranchOptions = branches.filter((b) => b.publicId !== transferTarget?.branchId);

    return (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-16">
            <Breadcrumb className="mb-6">
                <BreadcrumbList>
                    <BreadcrumbItem>
                        <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbPage>Branch Transfer</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>

            <div className="mb-8">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Branch Transfer</h1>
                <p className="text-neutral-500 text-sm mt-0.5">
                    Staffing overview across branches, and moving managers or employees between them.
                </p>
            </div>

            {/* Stats Overview */}
            <div className="mb-8">
                {isLoadingStats ? (
                    <div className="h-32 flex items-center justify-center bg-white rounded-xl border border-neutral-200">
                        <Loader2 className="h-6 w-6 animate-spin text-[#FF5F00]" />
                    </div>
                ) : (
                    <>
                        {totals && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                <StatCard label="Total Managers" value={totals.managers.total} sub={`${totals.managers.active} active`} icon={Building2} />
                                <StatCard label="Total Employees" value={totals.employees.total} sub={`${totals.employees.active} active`} icon={Users} />
                                <StatCard label="Inactive Managers" value={totals.managers.inactive} sub="across all branches" icon={Building2} tone="muted" />
                                <StatCard label="Inactive Employees" value={totals.employees.inactive} sub="across all branches" icon={Users} tone="muted" />
                            </div>
                        )}
                        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                            <Table>
                                <TableHeader className="bg-neutral-50/50">
                                    <TableRow className="hover:bg-transparent border-b-neutral-200">
                                        <TableHead className="pl-6 h-11 font-medium text-neutral-600 text-xs uppercase tracking-wider">Branch</TableHead>
                                        <TableHead className="font-medium text-neutral-600 text-xs uppercase tracking-wider">Managers</TableHead>
                                        <TableHead className="font-medium text-neutral-600 text-xs uppercase tracking-wider">Employees</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stats.map((s) => (
                                        <TableRow key={s.branchId} className="hover:bg-orange-50/20 border-b-neutral-100">
                                            <TableCell className="pl-6 py-3 font-medium text-neutral-900 text-sm">{s.branchName}</TableCell>
                                            <TableCell className="py-3 text-sm text-neutral-600">
                                                {s.managers.total} total <span className="text-neutral-400">({s.managers.active} active, {s.managers.inactive} inactive)</span>
                                            </TableCell>
                                            <TableCell className="py-3 text-sm text-neutral-600">
                                                {s.employees.total} total <span className="text-neutral-400">({s.employees.active} active, {s.employees.inactive} inactive)</span>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </div>

            {/* Filters */}
            <Card className="mb-6 border border-neutral-200 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Filters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Select value={branchFilter} onValueChange={setBranchFilter}>
                            <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.publicId} value={b.publicId}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="MANAGER">Branch Manager</SelectItem>
                                <SelectItem value="STAFF">Employee</SelectItem>
                            </SelectContent>
                        </Select>

                        <Input
                            placeholder="Search name, email, phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Users Table */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                {isLoadingUsers ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
                        <p className="text-sm text-neutral-400">Loading users...</p>
                    </div>
                ) : !users.length ? (
                    <div className="py-20 flex flex-col items-center justify-center border-dashed">
                        <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                            <Users className="w-7 h-7 text-neutral-300" />
                        </div>
                        <p className="font-medium text-neutral-700 mb-1">No users found</p>
                        <p className="text-sm text-neutral-400">Try adjusting your filters.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader className="bg-neutral-50/80">
                            <TableRow className="hover:bg-transparent border-b-neutral-100">
                                <TableHead className="pl-5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">User</TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Role</TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Status</TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Branch</TableHead>
                                <TableHead className="pr-5 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.publicId} className="hover:bg-neutral-50/50 border-b-neutral-100">
                                    <TableCell className="pl-5 py-4">
                                        <p className="font-medium text-neutral-900 text-sm">{user.name}</p>
                                        <p className="text-xs text-neutral-400 mt-0.5">{user.email || user.phone}</p>
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={`${getRoleBadge(user.role)} border shadow-none font-medium text-xs`}>
                                            {user.role === "MANAGER" ? "Branch Manager" : "Employee"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <StatusBadge status={user.isActive ? "ACTIVE" : "INACTIVE"} />
                                    </TableCell>
                                    <TableCell className="text-sm text-neutral-600">{user.branchName ?? "—"}</TableCell>
                                    <TableCell className="pr-5 text-right">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5 border-orange-200 text-[#FF5F00] hover:bg-orange-50 hover:text-[#E65600]"
                                            onClick={() => openTransferDialog(user)}
                                        >
                                            <ArrowRightLeft className="h-3.5 w-3.5" />
                                            Transfer
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}

                {/* Pagination */}
                {!!users.length && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-100">
                        <p className="text-sm text-neutral-500">
                            Showing <span className="font-medium text-neutral-700">{users.length}</span> of{" "}
                            <span className="font-medium text-neutral-700">{pagination.total}</span> users
                        </p>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => fetchUsers(pagination.page - 1)}
                                disabled={pagination.page <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm text-neutral-600 px-2 min-w-[80px] text-center">
                                Page {pagination.page} of {pagination.totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => fetchUsers(pagination.page + 1)}
                                disabled={pagination.page >= pagination.totalPages}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Transfer Dialog */}
            <Dialog open={!!transferTarget} onOpenChange={(open) => !open && setTransferTarget(null)}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Transfer User</DialogTitle>
                        <DialogDescription>
                            Move <strong>{transferTarget?.name}</strong> ({transferTarget?.role === "MANAGER" ? "Branch Manager" : "Employee"}) from{" "}
                            <strong>{transferTarget?.branchName ?? "no branch"}</strong> to another branch.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Target Branch</Label>
                            <Select value={toBranchId} onValueChange={setToBranchId}>
                                <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
                                <SelectContent>
                                    {targetBranchOptions.map((b) => (
                                        <SelectItem key={b.publicId} value={b.publicId}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Reason (optional)</Label>
                            <Input
                                placeholder="e.g. Branch understaffed"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setTransferTarget(null)}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button
                            className="bg-[#FF5F00] hover:bg-[#E65600] text-white w-full sm:w-auto"
                            onClick={handleTransfer}
                            disabled={isTransferring || !toBranchId}
                        >
                            {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm Transfer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

function StatCard({
    label,
    value,
    sub,
    icon: Icon,
    tone = "default",
}: {
    label: string;
    value: number;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    tone?: "default" | "muted";
}) {
    return (
        <Card className="border border-neutral-200 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${tone === "muted" ? "bg-neutral-100" : "bg-orange-50"}`}>
                    <Icon className={`h-5 w-5 ${tone === "muted" ? "text-neutral-500" : "text-[#FF5F00]"}`} />
                </div>
                <div>
                    <p className="text-xl font-bold text-neutral-900">{value}</p>
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="text-[11px] text-neutral-400">{sub}</p>
                </div>
            </CardContent>
        </Card>
    );
}
