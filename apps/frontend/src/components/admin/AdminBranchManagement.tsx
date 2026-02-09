import { useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminService, type AdminBranch, type CreateBranchInput } from "@/services/admin.service";
import { toast } from "sonner";
import { Edit2, Trash2, Plus, Loader2 } from "lucide-react";

interface AdminBranchManagementProps {
    branches: AdminBranch[];
    onRefresh: () => void;
}

export function AdminBranchManagement({ branches, onRefresh }: AdminBranchManagementProps) {
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    // Calculate stats for a mini-header within the tab
    const activeBranches = branches.filter(b => b.status === "ACTIVE").length;

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
                        <Button className="bg-[#FF5F00] hover:bg-[#E65600] text-white shadow-sm transition-all text-base px-6 h-11 border-0">
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-neutral-100 shadow-sm">
                    <div className="text-sm font-medium text-neutral-500">Total Branches</div>
                    <div className="text-2xl font-bold text-neutral-900 mt-1">{branches.length}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-neutral-100 shadow-sm">
                    <div className="text-sm font-medium text-neutral-500">Active Locations</div>
                    <div className="text-2xl font-bold text-[#FF5F00] mt-1">{activeBranches}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-neutral-100 shadow-sm">
                    <div className="text-sm font-medium text-neutral-500">Total Managers</div>
                    {/* Assuming 1 manager per branch for now */}
                    <div className="text-2xl font-bold text-neutral-900 mt-1">{activeBranches}</div>
                </div>
            </div>

            {/* Main Content Card */}
            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                <Table>
                    <TableHeader className="bg-neutral-50/50">
                        <TableRow className="hover:bg-transparent border-b-neutral-200">
                            <TableHead className="pl-6 h-12 font-medium text-neutral-600">Name</TableHead>
                            <TableHead className="font-medium text-neutral-600">Address</TableHead>
                            <TableHead className="font-medium text-neutral-600">Status</TableHead>
                            <TableHead className="font-medium text-neutral-600">Contact</TableHead>
                            <TableHead className="text-right pr-6 font-medium text-neutral-600">Actions</TableHead>
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
        </div>
    );
}

function BranchRow({ branch, onRefresh }: { branch: AdminBranch; onRefresh: () => void }) {
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
            <TableCell className="font-semibold text-neutral-900 pl-6 py-4">{branch.name}</TableCell>
            <TableCell className="text-neutral-600 max-w-[300px] truncate" title={branch.address}>{branch.address}</TableCell>
            <TableCell>
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${branch.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : branch.status === 'MAINTENANCE'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                    }`}>
                    {branch.status || "ACTIVE"}
                </div>
            </TableCell>
            <TableCell className="text-neutral-600 font-mono text-sm">{branch.phone || "—"}</TableCell>
            <TableCell className="text-right space-x-1 pr-6">
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
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete Branch</DialogTitle>
                            <DialogDescription>
                                Are you sure you want to delete <strong>{branch.name}</strong>? This action cannot be undone and will affect associated data.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>Delete Branch</Button>
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
        contactNumber: "",
        managerEmail: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            await adminService.createBranch(formData);
            toast.success("Branch created successfully");
            onSuccess();
        } catch (error) {
            toast.error("Failed to create branch");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden gap-0">
            <div className="p-6 pb-4 border-b bg-neutral-50/50">
                <DialogHeader className="gap-1">
                    <DialogTitle className="text-xl">Add New Branch</DialogTitle>
                    <DialogDescription>
                        Enter the details for the new physical location.
                    </DialogDescription>
                </DialogHeader>
            </div>

            <form onSubmit={handleSubmit} className="p-6 spc-y-4">
                <div className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-neutral-700">Branch Name</Label>
                        <Input
                            id="name"
                            placeholder="e.g. Downtown Hub"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="h-11"
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
                            className="h-11"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="contact" className="text-neutral-700">Phone Number</Label>
                            <Input
                                id="contact"
                                placeholder="+91..."
                                value={formData.contactNumber}
                                onChange={e => setFormData({ ...formData, contactNumber: e.target.value })}
                                className="h-11"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="manager" className="text-neutral-700">Manager Email</Label>
                            <Input
                                id="manager"
                                type="email"
                                placeholder="manager@wow.com"
                                value={formData.managerEmail}
                                onChange={e => setFormData({ ...formData, managerEmail: e.target.value })}
                                className="h-11"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-8">
                    <Button type="button" variant="outline" onClick={onClose} className="h-11 px-6">Cancel</Button>
                    <Button type="submit" disabled={isLoading} className="bg-[#FF5F00] hover:bg-[#E65600] text-white h-11 px-6">
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
        status: branch.status || "ACTIVE",
        managerName: manager?.name || "",
        managerEmail: manager?.email || "",
        managerPassword: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setIsLoading(true);
            await adminService.updateBranch(branch.publicId, formData);
            toast.success("Branch updated successfully");
            onSuccess();
        } catch (error) {
            toast.error("Failed to update branch");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>Edit Branch</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-name" className="text-right">Name</Label>
                    <Input
                        id="edit-name"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="col-span-3"
                        required
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-address" className="text-right">Address</Label>
                    <Input
                        id="edit-address"
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        className="col-span-3"
                        required
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-contact" className="text-right">Contact</Label>
                    <Input
                        id="edit-contact"
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        className="col-span-3"
                    />
                </div>
                <div className="border-t my-2"></div>
                {/* Manager Section */}
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-manager-name" className="text-right">Manager Name</Label>
                    <Input
                        id="edit-manager-name"
                        value={formData.managerName}
                        onChange={e => setFormData({ ...formData, managerName: e.target.value })}
                        className="col-span-3"
                        placeholder="Manager Name"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-manager-email" className="text-right">Manager Email</Label>
                    <Input
                        id="edit-manager-email"
                        type="email"
                        value={formData.managerEmail}
                        onChange={e => setFormData({ ...formData, managerEmail: e.target.value })}
                        className="col-span-3"
                        placeholder="Manager Email"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-manager-pass" className="text-right">Reset Pass</Label>
                    <Input
                        id="edit-manager-pass"
                        type="password"
                        value={formData.managerPassword}
                        onChange={e => setFormData({ ...formData, managerPassword: e.target.value })}
                        className="col-span-3"
                        placeholder="Leave blank to keep current"
                    />
                </div>
                <div className="border-t my-2"></div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-status" className="text-right">Status</Label>
                    <Select value={formData.status} onValueChange={val => setFormData({ ...formData, status: val })}>
                        <SelectTrigger className="col-span-3">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ACTIVE">Active</SelectItem>
                            <SelectItem value="INACTIVE">Inactive</SelectItem>
                            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    );
}
