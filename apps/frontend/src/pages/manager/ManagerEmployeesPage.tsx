import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";

export const ManagerEmployeesPage = () => {
    return (
        <ManagerLayout>
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
                <div className="mb-8">
                    <Breadcrumb className="mb-4">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Employees</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                    <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Employees Management</h1>
                </div>
                <div className="p-8 border border-dashed rounded-lg text-center text-neutral-400">
                    Employees management table will appear here.
                </div>
            </div>
        </ManagerLayout>
    );
};
