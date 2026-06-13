import { useState, useEffect } from "react";
import { Search, Users } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { CreateEmployeeDialog } from "@/components/manager/employees/CreateEmployeeDialog";
import { EmployeeTable } from "@/components/manager/employees/EmployeeTable";
import {
  branchEmployeeService,
  type BranchEmployee,
} from "@/services/branchEmployee.service";

export const ManagerEmployeesPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [employees, setEmployees] = useState<BranchEmployee[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
    limit: 10,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPagination((prev) => ({ ...prev, page: 1 }));
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchEmployees = async () => {
    try {
      setIsLoading(true);
      const response = await branchEmployeeService.getAll({
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch,
      });
      setEmployees(response.data);
      setPagination((prev) => ({
        ...prev,
        totalPages: response.meta.totalPages,
        total: response.meta.total,
      }));
    } catch (error) {
      console.error("Failed to fetch employees", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [debouncedSearch, pagination.page]);

  const handlePageChange = (newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handleEmployeeCreated = () => {
    fetchEmployees();
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div>
            <Breadcrumb className="mb-2">
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
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
                Employee Management
              </h1>
              {!isLoading && pagination.total > 0 && (
                <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-neutral-100 text-neutral-600 text-xs font-semibold">
                  {pagination.total}
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              Manage branch staff accounts and their access.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              placeholder="Search by name or phone..."
              className="pl-9 h-11 bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex-shrink-0">
            <CreateEmployeeDialog onSuccess={handleEmployeeCreated} />
          </div>
        </div>

        <EmployeeTable
          data={employees}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={handlePageChange}
          onEmployeeUpdated={handleEmployeeCreated}
        />
      </div>
    </ManagerLayout>
  );
};
