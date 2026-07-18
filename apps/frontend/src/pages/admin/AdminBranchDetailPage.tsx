import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
    adminService,
    type AdminBranch,
    type BranchManager,
    type CreateManagerInput,
    type UpdateManagerInput,
} from "@/services/admin.service";
import { toast } from "sonner";
import {
    Plus,
    Loader2,
    Edit2,
    UserX,
    UserCheck,
    Users,
    MapPin,
    Phone,
    ArrowLeft,
    Building2,
    Calendar,
} from "lucide-react";

export const AdminBranchDetailPage = () => {
    const { branchId } = useParams<{ branchId: string }>();
    const navigate = useNavigate();

    const [branch, setBranch] = useState<AdminBranch | null>(null);
    const [managers, setManagers] = useState<BranchManager[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAddManagerOpen, setIsAddManagerOpen] = useState(false);
    const [editingManager, setEditingManager] = useState<BranchManager | null>(null);
    const [statusTargetManager, setStatusTargetManager] = useState<BranchManager | null>(null);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    const fetchData = async () => {
        if (!branchId) return;
        try {
            setLoading(true);
            const [branchesData, managersData] = await Promise.all([
                adminService.getBranches(),
                adminService.getBranchManagers(branchId),
            ]);
            const found = branchesData.find((b) => b.publicId === branchId);
            if (!found) {
                toast.error("Branch not found");
                navigate("/admin/branches");
                return;
            }
            setBranch(found);
            setManagers(managersData);
        } catch {
            toast.error("Failed to load branch details");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [branchId]);

    const handleToggleManagerStatus = async () => {
        if (!statusTargetManager || !branchId) return;
        const nextIsActive = !statusTargetManager.isActive;
        try {
            setIsUpdatingStatus(true);
            await adminService.setBranchManagerStatus(branchId, statusTargetManager.publicId, nextIsActive);
            toast.success(`Manager ${nextIsActive ? "activated" : "deactivated"} successfully`);
            setStatusTargetManager(null);
            fetchData();
        } catch {
            toast.error("Failed to update manager status");
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-[#FF5F00]" />
            </div>
        );
    }

    if (!branch) return null;

    return (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-16">
            {/* Breadcrumb */}
            <Breadcrumb className="mb-6">
                <BreadcrumbList>
                    <BreadcrumbItem>
                        <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbLink href="/admin/branches">Branches</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbPage>{branch.name}</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>

            {/* Back + Title */}
            <div className="flex items-center gap-3 mb-8">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => navigate("/admin/branches")}
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
                        {branch.name}
                    </h1>
                    <p className="text-neutral-500 text-sm mt-0.5">
                        Branch details and manager accounts
                    </p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Branch Info Card */}
                <div className="lg:col-span-1">
                    <BranchInfoCard branch={branch} onRefresh={fetchData} />
                </div>

                {/* Managers Section */}
                <div className="lg:col-span-2">
                    <Card className="border border-neutral-200 shadow-sm">
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-lg bg-orange-50 flex items-center justify-center">
                                        <Users className="h-5 w-5 text-[#FF5F00]" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                                            Branch Managers
                                            <Badge
                                                variant="secondary"
                                                className="bg-orange-50 text-[#FF5F00] border-orange-100 text-xs font-semibold"
                                            >
                                                {managers.length}
                                            </Badge>
                                        </CardTitle>
                                        <p className="text-xs text-neutral-500 mt-0.5">
                                            Accounts with manager-level access to this branch
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    onClick={() => setIsAddManagerOpen(true)}
                                    className="bg-[#FF5F00] hover:bg-[#E65600] text-white h-9 px-4 text-sm shadow-sm"
                                >
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    Add Manager
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {/* Desktop Table */}
                            <div className="hidden sm:block">
                                <Table>
                                    <TableHeader className="bg-neutral-50/50">
                                        <TableRow className="hover:bg-transparent border-b-neutral-200">
                                            <TableHead className="pl-6 h-11 font-medium text-neutral-600 text-xs uppercase tracking-wider">Name</TableHead>
                                            <TableHead className="font-medium text-neutral-600 text-xs uppercase tracking-wider">Email</TableHead>
                                            <TableHead className="font-medium text-neutral-600 text-xs uppercase tracking-wider">Status</TableHead>
                                            <TableHead className="font-medium text-neutral-600 text-xs uppercase tracking-wider">Added</TableHead>
                                            <TableHead className="text-right pr-6 font-medium text-neutral-600 text-xs uppercase tracking-wider">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {managers.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="h-[240px] text-center">
                                                    <EmptyManagersState onAdd={() => setIsAddManagerOpen(true)} />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            managers.map((manager) => (
                                                <ManagerRow
                                                    key={manager.publicId}
                                                    manager={manager}
                                                    onEdit={() => setEditingManager(manager)}
                                                    onToggleStatus={() => setStatusTargetManager(manager)}
                                                />
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile Cards */}
                            <div className="block sm:hidden">
                                {managers.length === 0 ? (
                                    <div className="p-6">
                                        <EmptyManagersState onAdd={() => setIsAddManagerOpen(true)} />
                                    </div>
                                ) : (
                                    <div className="divide-y divide-neutral-100">
                                        {managers.map((manager) => (
                                            <ManagerCard
                                                key={manager.publicId}
                                                manager={manager}
                                                onEdit={() => setEditingManager(manager)}
                                                onToggleStatus={() => setStatusTargetManager(manager)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Add Manager Dialog */}
            {isAddManagerOpen && branchId && (
                <AddManagerDialog
                    branchId={branchId}
                    onClose={() => setIsAddManagerOpen(false)}
                    onSuccess={() => {
                        setIsAddManagerOpen(false);
                        fetchData();
                    }}
                />
            )}

            {/* Edit Manager Dialog */}
            {editingManager && branchId && (
                <EditManagerDialog
                    branchId={branchId}
                    manager={editingManager}
                    onClose={() => setEditingManager(null)}
                    onSuccess={() => {
                        setEditingManager(null);
                        fetchData();
                    }}
                />
            )}

            {/* Status Toggle Confirmation Dialog */}
            <Dialog open={!!statusTargetManager} onOpenChange={(open) => !open && setStatusTargetManager(null)}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>
                            {statusTargetManager?.isActive ? "Deactivate Manager" : "Activate Manager"}
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to {statusTargetManager?.isActive ? "deactivate" : "activate"}{" "}
                            <strong>{statusTargetManager?.name}</strong> as a branch manager?{" "}
                            {statusTargetManager?.isActive
                                ? "They will lose access to this branch immediately, but their account and data will be preserved."
                                : "They will regain access to this branch immediately."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setStatusTargetManager(null)}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button
                            className={
                                statusTargetManager?.isActive
                                    ? "bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto"
                                    : "bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto"
                            }
                            onClick={handleToggleManagerStatus}
                            disabled={isUpdatingStatus}
                        >
                            {isUpdatingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {statusTargetManager?.isActive ? "Deactivate Manager" : "Activate Manager"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// ─── Branch Info Card ─────────────────────────────────────────────────────────

function BranchInfoCard({ branch, onRefresh }: { branch: AdminBranch; onRefresh: () => void }) {
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: branch.name,
        address: branch.address,
        phone: branch.phone || "",
    });

    const handleSave = async () => {
        try {
            setIsLoading(true);
            await adminService.updateBranch(branch.publicId, formData);
            toast.success("Branch updated successfully");
            setIsEditing(false);
            onRefresh();
        } catch {
            toast.error("Failed to update branch");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="border border-neutral-200 shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-orange-50 flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-[#FF5F00]" />
                        </div>
                        <CardTitle className="text-base font-semibold text-neutral-900">
                            Branch Info
                        </CardTitle>
                    </div>
                    {!isEditing && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-neutral-500 hover:text-[#FF5F00] hover:bg-orange-50"
                            onClick={() => setIsEditing(true)}
                        >
                            <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                            Edit
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {isEditing ? (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Branch Name</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="h-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Address</Label>
                            <Input
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                className="h-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Phone</Label>
                            <Input
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="h-10"
                                placeholder="Optional"
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 h-9"
                                onClick={() => {
                                    setIsEditing(false);
                                    setFormData({ name: branch.name, address: branch.address, phone: branch.phone || "" });
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                className="flex-1 h-9 bg-[#FF5F00] hover:bg-[#E65600] text-white"
                                onClick={handleSave}
                                disabled={isLoading}
                            >
                                {isLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                Save
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex gap-3">
                            <MapPin className="h-4 w-4 text-neutral-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-xs font-medium text-neutral-500 mb-0.5">Address</p>
                                <p className="text-sm text-neutral-900">{branch.address}</p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Phone className="h-4 w-4 text-neutral-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-xs font-medium text-neutral-500 mb-0.5">Phone</p>
                                <p className="text-sm text-neutral-900">{branch.phone || "Not provided"}</p>
                            </div>
                        </div>
                        {branch._count && (
                            <div className="pt-2 border-t border-neutral-100">
                                <p className="text-xs font-medium text-neutral-500 mb-3 uppercase tracking-wider">Statistics</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: "Staff", value: branch._count.users },
                                        { label: "Vehicles", value: branch._count.vehicles },
                                        { label: "Bookings", value: branch._count.bookings },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="bg-neutral-50 rounded-lg p-2.5 text-center">
                                            <p className="text-lg font-bold text-neutral-900">{value}</p>
                                            <p className="text-xs text-neutral-500">{label}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Manager Row (Desktop) ────────────────────────────────────────────────────

function ManagerRow({
    manager,
    onEdit,
    onToggleStatus,
}: {
    manager: BranchManager;
    onEdit: () => void;
    onToggleStatus: () => void;
}) {
    return (
        <TableRow className="hover:bg-orange-50/20 transition-colors border-b-neutral-100">
            <TableCell className="pl-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-[#FF5F00]">
                            {manager.name.charAt(0).toUpperCase()}
                        </span>
                    </div>
                    <span className="font-medium text-neutral-900 text-sm">{manager.name}</span>
                </div>
            </TableCell>
            <TableCell className="text-neutral-600 text-sm">{manager.email}</TableCell>
            <TableCell>
                <StatusBadge status={manager.isActive ? "ACTIVE" : "INACTIVE"} />
            </TableCell>
            <TableCell className="text-neutral-500 text-sm whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                    {new Date(manager.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                    })}
                </div>
            </TableCell>
            <TableCell className="text-right pr-6">
                <div className="flex items-center justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-neutral-500 hover:text-[#FF5F00] hover:bg-orange-50"
                        onClick={onEdit}
                    >
                        <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={
                            manager.isActive
                                ? "h-8 w-8 text-neutral-500 hover:text-red-600 hover:bg-red-50"
                                : "h-8 w-8 text-neutral-500 hover:text-emerald-600 hover:bg-emerald-50"
                        }
                        onClick={onToggleStatus}
                    >
                        {manager.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}

// ─── Manager Card (Mobile) ────────────────────────────────────────────────────

function ManagerCard({
    manager,
    onEdit,
    onToggleStatus,
}: {
    manager: BranchManager;
    onEdit: () => void;
    onToggleStatus: () => void;
}) {
    return (
        <div className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                    <span className="text-base font-semibold text-[#FF5F00]">
                        {manager.name.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-medium text-neutral-900 text-sm truncate">{manager.name}</p>
                        <StatusBadge status={manager.isActive ? "ACTIVE" : "INACTIVE"} />
                    </div>
                    <p className="text-neutral-500 text-xs truncate">{manager.email}</p>
                    <p className="text-neutral-400 text-xs mt-0.5">
                        Added {new Date(manager.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                </div>
            </div>
            <div className="flex gap-1 shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-neutral-500 hover:text-[#FF5F00] hover:bg-orange-50"
                    onClick={onEdit}
                >
                    <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className={
                        manager.isActive
                            ? "h-8 w-8 text-neutral-500 hover:text-red-600 hover:bg-red-50"
                            : "h-8 w-8 text-neutral-500 hover:text-emerald-600 hover:bg-emerald-50"
                    }
                    onClick={onToggleStatus}
                >
                    {manager.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                </Button>
            </div>
        </div>
    );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyManagersState({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center space-y-3 py-8">
            <div className="h-14 w-14 rounded-full bg-orange-50 flex items-center justify-center">
                <Users className="h-7 w-7 text-[#FF5F00]" />
            </div>
            <div className="text-center">
                <h3 className="text-sm font-semibold text-neutral-900">No managers yet</h3>
                <p className="text-sm text-neutral-500 mt-1 max-w-xs">
                    Add a manager account to give branch-level access to this location.
                </p>
            </div>
            <Button
                variant="outline"
                size="sm"
                onClick={onAdd}
                className="mt-2 border-orange-200 text-[#FF5F00] hover:bg-orange-50 hover:text-[#E65600]"
            >
                <Plus className="h-4 w-4 mr-1.5" />
                Add First Manager
            </Button>
        </div>
    );
}

// ─── Add Manager Dialog ───────────────────────────────────────────────────────

function AddManagerDialog({
    branchId,
    onClose,
    onSuccess,
}: {
    branchId: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState<CreateManagerInput>({
        name: "",
        email: "",
        password: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            await adminService.createBranchManager(branchId, formData);
            toast.success("Manager account created successfully");
            onSuccess();
        } catch (error: any) {
            toast.error(error.response?.data?.message || "Failed to create manager");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[440px] w-[95vw] p-0 overflow-hidden rounded-lg">
                <div className="p-5 pb-4 border-b bg-neutral-50/50">
                    <DialogHeader className="gap-1 text-left">
                        <DialogTitle className="text-lg">Add Branch Manager</DialogTitle>
                        <DialogDescription className="text-sm">
                            Create a new manager account for this branch.
                        </DialogDescription>
                    </DialogHeader>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="mgr-name" className="text-sm font-medium text-neutral-700">
                            Full Name
                        </Label>
                        <Input
                            id="mgr-name"
                            placeholder="e.g. Rahul Sharma"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="h-11"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="mgr-email" className="text-sm font-medium text-neutral-700">
                            Email Address
                        </Label>
                        <Input
                            id="mgr-email"
                            type="email"
                            placeholder="manager@wuw.com"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="h-11"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="mgr-pass" className="text-sm font-medium text-neutral-700">
                            Password
                        </Label>
                        <Input
                            id="mgr-pass"
                            type="password"
                            placeholder="Min. 6 characters"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="h-11"
                            required
                            minLength={6}
                        />
                    </div>
                    <DialogFooter className="pt-2 flex-col-reverse sm:flex-row gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="h-11 w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="bg-[#FF5F00] hover:bg-[#E65600] text-white h-11 w-full sm:w-auto"
                        >
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Manager
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Edit Manager Dialog ──────────────────────────────────────────────────────

function EditManagerDialog({
    branchId,
    manager,
    onClose,
    onSuccess,
}: {
    branchId: string;
    manager: BranchManager;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState<UpdateManagerInput & { password: string }>({
        name: manager.name,
        email: manager.email,
        password: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            const payload: UpdateManagerInput = {
                name: formData.name,
                email: formData.email,
            };
            if (formData.password) {
                payload.password = formData.password;
            }
            await adminService.updateBranchManager(branchId, manager.publicId, payload);
            toast.success("Manager updated successfully");
            onSuccess();
        } catch (error: any) {
            toast.error(error.response?.data?.message || "Failed to update manager");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[440px] w-[95vw] p-0 overflow-hidden rounded-lg">
                <div className="p-5 pb-4 border-b bg-neutral-50/50">
                    <DialogHeader className="gap-1 text-left">
                        <DialogTitle className="text-lg">Edit Manager</DialogTitle>
                        <DialogDescription className="text-sm">
                            Update details for <strong>{manager.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="edit-mgr-name" className="text-sm font-medium text-neutral-700">
                            Full Name
                        </Label>
                        <Input
                            id="edit-mgr-name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="h-11"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="edit-mgr-email" className="text-sm font-medium text-neutral-700">
                            Email Address
                        </Label>
                        <Input
                            id="edit-mgr-email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="h-11"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="edit-mgr-pass" className="text-sm font-medium text-neutral-700">
                            New Password
                            <span className="text-neutral-400 font-normal ml-1">(leave blank to keep current)</span>
                        </Label>
                        <Input
                            id="edit-mgr-pass"
                            type="password"
                            placeholder="Leave blank to keep current"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="h-11"
                            minLength={6}
                        />
                    </div>
                    <DialogFooter className="pt-2 flex-col-reverse sm:flex-row gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="h-11 w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="bg-[#FF5F00] hover:bg-[#E65600] text-white h-11 w-full sm:w-auto"
                        >
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
