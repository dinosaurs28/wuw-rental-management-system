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
import { usePaymentStore } from "@/store/payment.store";

import { CashConfirmationsTab } from "./CashConfirmationsPage";
import { SettlementsTab } from "./SettlementsPage";
import { RefundsTab } from "./RefundsPage";
import { CashShiftsTab } from "./CashShiftsPage";
// import { TransactionsTab } from "./TransactionsPage";

export function FinancialsDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pendingCashCount, pendingRefundCount } = usePaymentStore();
  
  const defaultTab = "confirmations";
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
                <BreadcrumbPage>Financials</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="mt-4">
            <h1 className="text-2xl font-bold text-neutral-900">Financials Dashboard</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Manage cash collections, settlements, refunds, and shifts
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="bg-neutral-100/80 mb-6 flex h-auto flex-wrap p-1">
            <TabsTrigger 
              value="confirmations" 
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Cash Confirmations
              {pendingCashCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700">
                  {pendingCashCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="settlements" 
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Settlements
            </TabsTrigger>
            <TabsTrigger 
              value="refunds" 
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Refunds
              {pendingRefundCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700">
                  {pendingRefundCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="shifts" 
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              Cash Shifts
            </TabsTrigger>
            <TabsTrigger
              value="transactions"
              className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm"
            >
              All Transactions
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="confirmations" className="mt-0 outline-none">
            <CashConfirmationsTab />
          </TabsContent>
          
          <TabsContent value="settlements" className="mt-0 outline-none">
            <SettlementsTab />
          </TabsContent>
          
          <TabsContent value="refunds" className="mt-0 outline-none">
            <RefundsTab />
          </TabsContent>
          
          <TabsContent value="shifts" className="mt-0 outline-none">
            <CashShiftsTab />
          </TabsContent>
        </Tabs>
      </div>
    </ManagerLayout>
  );
}
