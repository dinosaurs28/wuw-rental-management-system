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
    return (
        <div className="space-y-4">
            {/* Toolbar similar to Manager Dashboard */}
            <div className="bg-white p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-72">
                    {/* Placeholder for search if needed later */}
                    <div className="text-sm font-medium text-muted-foreground">
                        Total Branches: {branches.length}
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="w-full md:w-auto">
                                <Plus className="mr-2 h-4 w-4" />
                                Add Branch
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
            </div>

            <div className="border-t">
                <Table>
                    <TableHeader className="bg-neutral-50">
                        <TableRow>
                            <TableHead className="pl-6">Name</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead className="text-right pr-6">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {branches.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No branches found.
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
            await adminService.deleteBranch(branch.publicId); // or id? using publicId mostly
            toast.success("Branch deleted successfully");
            setIsDeleteOpen(false);
            onRefresh();
        } catch (error) {
            toast.error("Failed to delete branch");
        }
    };

    return (
        <TableRow className="hover:bg-neutral-50/50">
            <TableCell className="font-medium pl-6">{branch.name}</TableCell>
            <TableCell>{branch.location}</TableCell>
            <TableCell>
                <Badge variant={branch.status === 'ACTIVE' ? 'default' : 'secondary'} className="rounded-md font-normal">
                    {branch.status}
                </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{branch.contactNumber || "N/A"}</TableCell>
            <TableCell className="text-right space-x-2 pr-6">
                <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Edit2 className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <EditBranchDialog
                        branch={branch}
                        onClose={() => setIsEditOpen(false)}
                        onSuccess={() => {
                            setIsEditOpen(false);
                            onRefresh();
                        }}
                    />
                </Dialog>

                <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete Branch</DialogTitle>
                            <DialogDescription>
                                Are you sure you want to delete <strong>{branch.name}</strong>? This action cannot be undone.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
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
        location: "",
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
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>Add New Branch</DialogTitle>
                <DialogDescription>
                    Create a new branch location for the system.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">Name</Label>
                    <Input
                        id="name"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="col-span-3"
                        required
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="location" className="text-right">Location</Label>
                    <Input
                        id="location"
                        value={formData.location}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                        className="col-span-3"
                        required
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="contact" className="text-right">Contact</Label>
                    <Input
                        id="contact"
                        value={formData.contactNumber}
                        onChange={e => setFormData({ ...formData, contactNumber: e.target.value })}
                        className="col-span-3"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="manager" className="text-right">Manager Email</Label>
                    <Input
                        id="manager"
                        type="email"
                        value={formData.managerEmail}
                        onChange={e => setFormData({ ...formData, managerEmail: e.target.value })}
                        className="col-span-3"
                        placeholder="Invite manager (optional)"
                    />
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={isLoading}>
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
    const [formData, setFormData] = useState({
        name: branch.name,
        location: branch.location,
        contactNumber: branch.contactNumber || "",
        status: branch.status
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
                    <Label htmlFor="edit-location" className="text-right">Location</Label>
                    <Input
                        id="edit-location"
                        value={formData.location}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                        className="col-span-3"
                        required
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-contact" className="text-right">Contact</Label>
                    <Input
                        id="edit-contact"
                        value={formData.contactNumber}
                        onChange={e => setFormData({ ...formData, contactNumber: e.target.value })}
                        className="col-span-3"
                    />
                </div>
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
