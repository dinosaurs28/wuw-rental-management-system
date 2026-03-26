import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminService, type AdminBranch, type CreateBranchInput } from "@/services/admin.service";
import { toast } from "sonner";
import { Edit2, Trash2, Plus, Loader2, ChevronRight, Users } from "lucide-react";

interface AdminBranchManagementProps {
    branches: AdminBranch[];
    onRefresh: () => void;
}

export function AdminBranchManagement({ branches, onRefresh }: AdminBranchManagementProps) {
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    return (
        <div className="space-y-6">
            {/* Header / Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h3 className="text-xl font-semibold tracking-tight text-neutral-900">Branch Network</h3>
                    <p className="text-sm text-neutral-500 mt-1">Manage your physical locations and assigned managers.</p>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-[#FF5F00] hover:bg-[#E65600] text-white shadow-sm transition-all text-base px-6 h-12 border-0">
                            <Plus className="mr-2 h-5 w-5" />
                            Add New Branch
                        </Button>
                    </DialogTrigger>
                    <CreateBranchDialog
                        onClose={() => setIsCreateOpen(false)}
                        onSuccess={() => {
                            setIsCreateOpen(false);
                            onRefresh();
                        }}
                    />
                </Dialog>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="shadow-sm">
                    <CardContent className="p-6">
                        <div className="text-sm font-medium text-neutral-500">Total Branches</div>
                        <div className="text-2xl font-bold text-neutral-900 mt-1">{branches.length}</div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm">
                    <CardContent className="p-6">
                        <div className="text-sm font-medium text-neutral-500">Total Managers</div>
                        <div className="text-2xl font-bold text-neutral-900 mt-1">
                            {branches.reduce((sum, b) => sum + (b.users?.length ?? 0), 0)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content - Mobile View (Cards) */}
            <div className="block md:hidden space-y-4">
                {branches.length === 0 ? (
                    <Card className="border-dashed border-2 p-6 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                            <div className="h-12 w-12 rounded-full bg-orange-50 flex items-center justify-center mb-2">
                                <div className="h-6 w-6 text-[#FF5F00]">📍</div>
                            </div>
                            <h3 className="text-lg font-medium text-neutral-900">No branches found</h3>
                            <Button
                                variant="outline"
                                onClick={() => setIsCreateOpen(true)}
                                className="mt-4 border-orange-200 text-[#FF5F00] hover:text-[#E65600] hover:bg-orange-50"
                            >
                                Create Branch
                            </Button>
                        </div>
                    </Card>
                ) : (
                    branches.map((branch) => (
                        <BranchCard key={branch.id} branch={branch} onRefresh={onRefresh} />
                    ))
                )}
            </div>

            {/* Main Content - Desktop View (Table) */}
            <Card className="hidden md:block border border-neutral-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-neutral-50/50">
                            <TableRow className="hover:bg-transparent border-b-neutral-200">
                                <TableHead className="pl-6 h-12 font-medium text-neutral-600 whitespace-nowrap">Name</TableHead>
                                <TableHead className="font-medium text-neutral-600 whitespace-nowrap">Address</TableHead>
                                <TableHead className="font-medium text-neutral-600 whitespace-nowrap">Contact</TableHead>
                                <TableHead className="font-medium text-neutral-600 whitespace-nowrap">Managers</TableHead>
                                <TableHead className="text-right pr-6 font-medium text-neutral-600 whitespace-nowrap">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {branches.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-[400px] text-center">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <div className="h-12 w-12 rounded-full bg-orange-50 flex items-center justify-center mb-2">
                                                <div className="h-6 w-6 text-[#FF5F00]">📍</div>
                                            </div>
                                            <h3 className="text-lg font-medium text-neutral-900">No branches found</h3>
                                            <p className="text-neutral-500 max-w-sm mx-auto">
                                                Get started by adding your first branch location to the system.
                                            </p>
                                            <Button
                                                variant="outline"
                                                onClick={() => setIsCreateOpen(true)}
                                                className="mt-4 border-orange-200 text-[#FF5F00] hover:text-[#E65600] hover:bg-orange-50"
                                            >
                                                Create Branch
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                branches.map((branch) => (
                                    <BranchRow key={branch.id} branch={branch} onRefresh={onRefresh} />
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
}

function BranchCard({ branch, onRefresh }: { branch: AdminBranch; onRefresh: () => void }) {
    const navigate = useNavigate();
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);

    const handleDelete = async () => {
        try {
            await adminService.deleteBranch(branch.publicId);
            toast.success("Branch deleted successfully");
            setIsDeleteOpen(false);
            onRefresh();
        } catch (error) {
            toast.error("Failed to delete branch");
        }
    };

    return (
        <Card className="overflow-hidden">
            <CardContent className="p-4 space-y-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-semibold text-neutral-900">{branch.name}</h4>
                        <p className="text-sm text-neutral-500 mt-1">{branch.address}</p>
                    </div>
                    <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
                        <Users className="h-3 w-3" />
                        {branch.users?.length ?? 0}
                    </Badge>
                </div>

                <div className="flex items-center text-sm text-neutral-600">
                    <span className="font-medium mr-2">Contact:</span>
                    {branch.phone || "—"}
                </div>

                <div className="flex justify-between gap-2 pt-2 border-t border-neutral-100">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-[#FF5F00] border-orange-200 hover:bg-orange-50 hover:text-[#E65600]"
                        onClick={() => navigate(`/admin/branches/${branch.publicId}`)}
                    >
                        <Users className="h-3.5 w-3.5 mr-2" />
                        View Members
                    </Button>
                    <div className="flex gap-2">
                        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-9">
                                    <Edit2 className="h-3.5 w-3.5 mr-2" />
                                    Edit
                                </Button>
                            </DialogTrigger>
                            {isEditOpen && (
                                <EditBranchDialog
                                    branch={branch}
                                    onClose={() => setIsEditOpen(false)}
                                    onSuccess={() => {
                                        setIsEditOpen(false);
                                        onRefresh();
                                    }}
                                />
                            )}
                        </Dialog>

                        <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-9 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                                    Delete
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Delete Branch</DialogTitle>
                                    <DialogDescription>
                                        Are you sure you want to delete <strong>{branch.name}</strong>?
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogFooter className="flex-col sm:flex-row gap-2">
                                    <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                                    <Button className="bg-red-600 text-white" onClick={handleDelete}>Delete</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function BranchRow({ branch, onRefresh }: { branch: AdminBranch; onRefresh: () => void }) {
    const navigate = useNavigate();
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);

    const handleDelete = async () => {
        try {
            await adminService.deleteBranch(branch.publicId);
            toast.success("Branch deleted successfully", {
                description: `${branch.name} has been removed from the system.`
            });
            setIsDeleteOpen(false);
            onRefresh();
        } catch (error) {
            toast.error("Failed to delete branch", {
                description: "There was an error processing your request."
            });
        }
    };

    return (
        <TableRow className="hover:bg-orange-50/30 transition-colors border-b-neutral-100 group">
            <TableCell className="font-semibold text-neutral-900 pl-6 py-4 whitespace-nowrap">{branch.name}</TableCell>
            <TableCell className="text-neutral-600 max-w-[200px] sm:max-w-[300px] truncate" title={branch.address}>{branch.address}</TableCell>
            <TableCell className="text-neutral-600 font-mono text-sm whitespace-nowrap">{branch.phone || "—"}</TableCell>
            <TableCell className="whitespace-nowrap">
                <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                    <Users className="h-3 w-3" />
                    {branch.users?.length ?? 0} manager{(branch.users?.length ?? 0) !== 1 ? "s" : ""}
                </Badge>
            </TableCell>
            <TableCell className="text-right space-x-1 pr-6 whitespace-nowrap">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[#FF5F00] hover:text-[#E65600] hover:bg-orange-50 text-xs"
                    onClick={() => navigate(`/admin/branches/${branch.publicId}`)}
                >
                    <Users className="h-3.5 w-3.5 mr-1" />
                    Members
                    <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
                <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500 hover:text-[#FF5F00] hover:bg-orange-50">
                            <Edit2 className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    {isEditOpen && (
                        <EditBranchDialog
                            branch={branch}
                            onClose={() => setIsEditOpen(false)}
                            onSuccess={() => {
                                setIsEditOpen(false);
                                onRefresh();
                            }}
                        />
                    )}
                </Dialog>

                <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500 hover:text-red-600 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Delete Branch</DialogTitle>
                            <DialogDescription>
                                Are you sure you want to delete <strong>{branch.name}</strong>? This action cannot be undone and will affect associated data.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="flex-col sm:flex-row gap-2">
                            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} className="w-full sm:w-auto">Cancel</Button>
                            <Button className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto" onClick={handleDelete}>Delete Branch</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </TableCell>
        </TableRow>
    );
}

function CreateBranchDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState<CreateBranchInput>({
        name: "",
        address: "",
        phone: "",
        managerName: "",
        managerEmail: "",
        managerPassword: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            await adminService.createBranch(formData);
            toast.success("Branch created successfully");
            onSuccess();
        } catch (error: any) {
            console.error(error);
            toast.error(error.response?.data?.message || "Failed to create branch");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-[500px] w-[95vw] p-0 overflow-hidden gap-0 rounded-lg">
            <div className="p-4 sm:p-6 pb-4 border-b bg-neutral-50/50">
                <DialogHeader className="gap-1 text-left">
                    <DialogTitle className="text-lg sm:text-xl">Add New Branch</DialogTitle>
                    <DialogDescription className="text-sm">
                        Enter the details for the new physical location.
                    </DialogDescription>
                </DialogHeader>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[70vh]">
                <div className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-neutral-700">Branch Name</Label>
                        <Input
                            id="name"
                            placeholder="e.g. Downtown Hub"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="h-12"
                            required
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="address" className="text-neutral-700">Full Address</Label>
                        <Input
                            id="address"
                            placeholder="Street, City, Zip"
                            value={formData.address}
                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                            className="h-12"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="phone" className="text-neutral-700">Phone Number</Label>
                            <Input
                                id="phone"
                                placeholder="+91..."
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                className="h-12"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="managerName" className="text-neutral-700">Manager Name</Label>
                            <Input
                                id="managerName"
                                placeholder="Manager Full Name"
                                value={formData.managerName}
                                onChange={e => setFormData({ ...formData, managerName: e.target.value })}
                                className="h-12"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="manager" className="text-neutral-700">Manager Email</Label>
                            <Input
                                id="manager"
                                type="email"
                                placeholder="manager@WUW.com"
                                value={formData.managerEmail}
                                onChange={e => setFormData({ ...formData, managerEmail: e.target.value })}
                                className="h-12"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="managerPassword" className="text-neutral-700">Manager Password</Label>
                            <Input
                                id="managerPassword"
                                type="password"
                                placeholder="******"
                                value={formData.managerPassword}
                                onChange={e => setFormData({ ...formData, managerPassword: e.target.value })}
                                className="h-12"
                                required
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-8 flex-col-reverse sm:flex-row gap-2">
                    <Button type="button" variant="outline" onClick={onClose} className="h-12 px-6 w-full sm:w-auto">Cancel</Button>
                    <Button type="submit" disabled={isLoading} className="bg-[#FF5F00] hover:bg-[#E65600] text-white h-12 px-6 w-full sm:w-auto">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Branch
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    );
}

function EditBranchDialog({ branch, onClose, onSuccess }: { branch: AdminBranch; onClose: () => void; onSuccess: () => void }) {
    const [isLoading, setIsLoading] = useState(false);

    // Safely access manager details from the users array (if it exists)
    const manager = branch.users && branch.users.length > 0 ? branch.users[0] : null;

    const [formData, setFormData] = useState({
        name: branch.name,
        address: branch.address,
        phone: branch.phone || "",
        managerName: manager?.name || "",
        managerEmail: manager?.email || "",
        managerPassword: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            const payload = { ...formData };
            if (!payload.managerPassword) {
                // Remove password field if empty to avoid validation error
                const { managerPassword, ...rest } = payload;
                await adminService.updateBranch(branch.publicId, rest);
            } else {
                await adminService.updateBranch(branch.publicId, payload);
            }
            toast.success("Branch updated successfully");
            onSuccess();
        } catch (error: any) {
            console.error(error);
            toast.error(error.response?.data?.message || "Failed to update branch");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-[425px] w-[95vw] rounded-lg">
            <DialogHeader>
                <DialogTitle>Edit Branch</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 py-4 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-name" className="text-left sm:text-right">Name</Label>
                    <Input
                        id="edit-name"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                        required
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-address" className="text-left sm:text-right">Address</Label>
                    <Input
                        id="edit-address"
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                        required
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-contact" className="text-left sm:text-right">Contact</Label>
                    <Input
                        id="edit-contact"
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                    />
                </div>
                <div className="border-t my-2"></div>
                {/* Manager Section */}
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-manager-name" className="text-left sm:text-right">Manager Name</Label>
                    <Input
                        id="edit-manager-name"
                        value={formData.managerName}
                        onChange={e => setFormData({ ...formData, managerName: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                        placeholder="Manager Name"
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-manager-email" className="text-left sm:text-right">Manager Email</Label>
                    <Input
                        id="edit-manager-email"
                        type="email"
                        value={formData.managerEmail}
                        onChange={e => setFormData({ ...formData, managerEmail: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                        placeholder="Manager Email"
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-start sm:items-center gap-2 sm:gap-4">
                    <Label htmlFor="edit-manager-pass" className="text-left sm:text-right">Reset Pass</Label>
                    <Input
                        id="edit-manager-pass"
                        type="password"
                        value={formData.managerPassword}
                        onChange={e => setFormData({ ...formData, managerPassword: e.target.value })}
                        className="col-span-1 sm:col-span-3 h-12"
                        placeholder="Leave blank to keep current"
                    />
                </div>
                <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
                    <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto h-12">Cancel</Button>
                    <Button type="submit" disabled={isLoading} className="w-full sm:w-auto h-12">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    );
}
