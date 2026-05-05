import { ManagerLayout } from "@/components/manager/ManagerLayout";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { useBranchManagerAuthStore } from "@/store/branchManagerAuth.store";

export const ManagerProfilePage = () => {
  const { user } = useBranchManagerAuthStore();

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8">
        <div className="mb-8">
          <Breadcrumb className="mb-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">
                  Dashboard
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Profile</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            My Profile
          </h1>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border max-w-2xl">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-neutral-500">
                Name
              </label>
              <p className="text-lg font-medium">
                {user?.name || "Manager Name"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-500">
                Email
              </label>
              <p className="text-lg font-medium">
                {user?.email || "support@whatuwantrental.in"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-500">
                Role
              </label>
              <p className="text-lg font-medium">
                {user?.role || "Branch Manager"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </ManagerLayout>
  );
};
