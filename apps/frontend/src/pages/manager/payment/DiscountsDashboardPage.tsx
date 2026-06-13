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
import { Clock, Tag, Settings } from "lucide-react";

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
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">

        {/* Header */}
        <div className="mb-8">
          <Breadcrumb className="mb-2">
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
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
            Discounts & Coupons
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Manage manual discount approvals, coupons, and automatic duration-based rules.
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <div className="overflow-x-auto pb-1 mb-6">
            <TabsList className="inline-flex h-auto bg-neutral-100 p-1 rounded-xl gap-0.5 min-w-max">
              <TabsTrigger
                value="approvals"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Clock className="w-4 h-4" />
                <span>Approvals</span>
              </TabsTrigger>
              <TabsTrigger
                value="coupons"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Tag className="w-4 h-4" />
                <span>Coupons</span>
              </TabsTrigger>
              <TabsTrigger
                value="config"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Settings className="w-4 h-4" />
                <span>Configuration</span>
              </TabsTrigger>
            </TabsList>
          </div>

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
