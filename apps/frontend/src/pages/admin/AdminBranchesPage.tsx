import { useEffect, useState } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AdminBranchManagement } from '@/components/admin/AdminBranchManagement';
import { adminService, type AdminBranch } from '@/services/admin.service';
import { toast } from 'sonner';

export const AdminBranchesPage = () => {
    const [branches, setBranches] = useState<AdminBranch[]>([]);
    const [ ,setLoading] = useState(true);

    const fetchBranches = async () => {
        try {
            setLoading(true);
            const data = await adminService.getBranches();
            setBranches(data);
        } catch (error) {
            console.error("Failed to load branches", error);
            toast.error("Failed to load branches");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBranches();
    }, []);

    return (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
            {/* Page Header */}
            <div className="mb-8">
                <Breadcrumb className="mb-4">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/admin/dashboard">Admin</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Branch Management</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Branch Management</h1>
                        <p className="text-neutral-500 mt-2 text-lg">
                            Manage all physical branch locations and their details.
                        </p>
                    </div>
                </div>
            </div>

            {/* Branch Management Table */}
            <div className="bg-white rounded-lg shadow-sm border">
                <AdminBranchManagement branches={branches} onRefresh={fetchBranches} />
            </div>
        </div>
    );
};
