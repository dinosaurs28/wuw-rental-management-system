import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, Loader2, Trash2, Pencil, Phone, Copy, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type BranchEmployee,
  branchEmployeeService,
} from "@/services/branchEmployee.service";
import { EditEmployeeDialog } from "./EditEmployeeDialog";

interface EmployeeTableProps {
  data: BranchEmployee[];
  isLoading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
  onPageChange: (page: number) => void;
  onEmployeeUpdated?: () => void;
}

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const avatarColors = [
  "bg-orange-100 text-orange-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
];

const getAvatarColor = (name: string) =>
  avatarColors[name.charCodeAt(0) % avatarColors.length];

const getRoleBadge = (role?: string) => {
  switch ((role || "").toLowerCase()) {
    case "manager":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "admin":
      return "bg-violet-100 text-violet-700 border-violet-200";
    default:
      return "bg-blue-100 text-blue-700 border-blue-200";
  }
};

export function EmployeeTable({
  data,
  isLoading,
  pagination,
  onPageChange,
  onEmployeeUpdated,
}: EmployeeTableProps) {
  const [editingEmployee, setEditingEmployee] = useState<BranchEmployee | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BranchEmployee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await branchEmployeeService.delete(deleteTarget.publicId);
      toast.success("Employee deleted successfully");
      setDeleteTarget(null);
      if (onEmployeeUpdated) onEmployeeUpdated();
    } catch (error) {
      console.error("Failed to delete employee", error);
      toast.error("Failed to delete employee");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-64 flex flex-col items-center justify-center bg-white rounded-xl border border-neutral-200 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
        <p className="text-sm text-neutral-400">Loading employees...</p>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-neutral-200">
        <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
          <Users className="w-7 h-7 text-neutral-300" />
        </div>
        <p className="font-medium text-neutral-700 mb-1">No employees found</p>
        <p className="text-sm text-neutral-400">Add your first staff member to get started.</p>
      </div>
    );
  }

  const startItem = (pagination.page - 1) * 10 + 1;
  const endItem = Math.min(pagination.page * 10, pagination.total);

  return (
    <div className="space-y-4">

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-neutral-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-neutral-100 bg-neutral-50/80">
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Employee</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Contact</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Role</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Joined</th>
              <th className="px-5 py-3.5 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.map((employee) => (
              <tr key={employee.publicId} className="hover:bg-neutral-50/50 transition-colors group">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${getAvatarColor(employee.name)}`}>
                      {getInitials(employee.name)}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900 text-sm">{employee.name}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">{employee.email || "—"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5 text-sm text-neutral-600">
                    <Phone className="w-3.5 h-3.5 text-neutral-400" />
                    {employee.phone}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <Badge className={`${getRoleBadge(employee.role)} border shadow-none font-medium text-xs`}>
                    {employee.role || "Staff"}
                  </Badge>
                </td>
                <td className="px-5 py-4 text-sm text-neutral-500">
                  {format(new Date(employee.createdAt), "MMM d, yyyy")}
                </td>
                <td className="px-5 py-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="gap-2"
                        onClick={() => navigator.clipboard.writeText(employee.phone).then(() => toast.success("Phone copied"))}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Phone
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2"
                        onClick={() => { setEditingEmployee(employee); setIsEditDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit Details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 text-red-600 focus:text-red-600"
                        onClick={() => setDeleteTarget(employee)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {data.map((employee) => (
          <div key={employee.publicId} className="bg-white rounded-xl border border-neutral-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${getAvatarColor(employee.name)}`}>
                  {getInitials(employee.name)}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900 text-sm truncate">{employee.name}</p>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">{employee.email || "—"}</p>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0 flex-shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => navigator.clipboard.writeText(employee.phone).then(() => toast.success("Phone copied"))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Phone
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => { setEditingEmployee(employee); setIsEditDialogOpen(true); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-red-600 focus:text-red-600"
                    onClick={() => setDeleteTarget(employee)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Phone className="w-3 h-3" />
                {employee.phone}
              </div>
              <Badge className={`${getRoleBadge(employee.role)} border shadow-none font-medium text-xs`}>
                {employee.role || "Staff"}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-neutral-500">
          Showing <span className="font-medium text-neutral-700">{startItem}–{endItem}</span> of{" "}
          <span className="font-medium text-neutral-700">{pagination.total}</span> employees
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(pagination.page - 1)}
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
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Edit Dialog */}
      <EditEmployeeDialog
        employee={editingEmployee}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSuccess={() => { if (onEmployeeUpdated) onEmployeeUpdated(); }}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-neutral-900">{deleteTarget?.name}</span>?
              Their account will be permanently removed and they will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</>
              ) : (
                "Delete Employee"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
