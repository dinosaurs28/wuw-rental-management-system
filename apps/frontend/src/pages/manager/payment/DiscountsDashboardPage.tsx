import { useSearchParams } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManagerLayout } from "@/components/manager/ManagerLayout";

import { DiscountApprovalsTab } from "./DiscountApprovalsPage";
import { CouponsTab } from "./CouponsPage";
import { DiscountConfigTab } from "./DiscountConfigPage";

export function DiscountsDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const defaultTab = "approvals";
  const currentTab = searchParams.get("tab") || defaultTab;

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Discounts & Coupons</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="mt-4">
            <h1 className="text-2xl font-bold text-neutral-900">Discounts & Coupons</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Manage manual discount approvals, coupons, and automatic duration-based rules
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="bg-neutral-100/80 mb-6 flex h-auto flex-wrap p-1">
            <TabsTrigger 
              value="approvals" 
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Approvals
            </TabsTrigger>
            <TabsTrigger 
              value="coupons" 
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Coupons
            </TabsTrigger>
            <TabsTrigger 
              value="config" 
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Configuration
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="approvals" className="mt-0 outline-none">
            <DiscountApprovalsTab />
          </TabsContent>
          
          <TabsContent value="coupons" className="mt-0 outline-none">
            <CouponsTab />
          </TabsContent>
          
          <TabsContent value="config" className="mt-0 outline-none">
            <DiscountConfigTab />
          </TabsContent>
        </Tabs>
      </div>
    </ManagerLayout>
  );
}
