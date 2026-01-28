import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, Loader2 } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { type BranchEmployee } from "@/services/branchEmployee.service";
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

export function EmployeeTable({
    data,
    isLoading,
    pagination,
    onPageChange,
    onEmployeeUpdated
}: EmployeeTableProps) {
    const [editingEmployee, setEditingEmployee] = useState<BranchEmployee | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    if (isLoading) {
        return (
            <div className="w-full h-64 flex items-center justify-center border rounded-lg bg-white">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            </div>
        );
    }

    if (!data.length) {
        return (
            <div className="w-full h-64 flex flex-col items-center justify-center border rounded-lg bg-white text-neutral-500">
                <p>No employees found</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border bg-white overflow-hidden">
                <Table>
                    <TableHeader className="bg-neutral-50">
                        <TableRow>
                            <TableHead className="font-semibold text-neutral-900">Name</TableHead>
                            <TableHead className="font-semibold text-neutral-900">Email</TableHead>
                            <TableHead className="font-semibold text-neutral-900">Phone</TableHead>
                            <TableHead className="font-semibold text-neutral-900">Role</TableHead>
                            <TableHead className="font-semibold text-neutral-900">Created At</TableHead>
                            <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((employee) => (
                            <TableRow key={employee.publicId} className="hover:bg-neutral-50/50">
                                <TableCell className="font-medium text-neutral-900">
                                    {employee.name}
                                </TableCell>
                                <TableCell>{employee.email}</TableCell>
                                <TableCell>{employee.phone}</TableCell>
                                <TableCell>
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {employee.role || 'Staff'}
                                    </span>
                                </TableCell>
                                <TableCell className="text-neutral-500">
                                    {format(new Date(employee.createdAt), "MMM d, y")}
                                </TableCell>
                                <TableCell>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" className="h-8 w-8 p-0">
                                                <span className="sr-only">Open menu</span>
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            <DropdownMenuItem
                                                onClick={() => navigator.clipboard.writeText(employee.phone)}
                                            >
                                                Copy Phone
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => {
                                                setEditingEmployee(employee);
                                                setIsEditDialogOpen(true);
                                            }}>
                                                Edit Details
                                            </DropdownMenuItem>
                                            {/* No delete option as per requirements */}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-2">
                <div className="text-sm text-neutral-500">
                    Page {pagination.page} of {pagination.totalPages}
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(pagination.page - 1)}
                        disabled={pagination.page <= 1}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(pagination.page + 1)}
                        disabled={pagination.page >= pagination.totalPages}
                    >
                        Next
                    </Button>
                </div>
            </div>

            <EditEmployeeDialog
                employee={editingEmployee}
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                onSuccess={() => {
                    if (onEmployeeUpdated) onEmployeeUpdated();
                }}
            />
        </div>
    );
}
