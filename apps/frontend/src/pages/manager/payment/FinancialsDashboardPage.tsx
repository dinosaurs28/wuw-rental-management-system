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
import { Banknote, Scale, RotateCcw, Clock, ReceiptText } from "lucide-react";

import { CashConfirmationsTab } from "./CashConfirmationsPage";
import { SettlementsTab } from "./SettlementsPage";
import { RefundsTab } from "./RefundsPage";
import { CashShiftsTab } from "./CashShiftsPage";
import { TransactionsTab } from "./TransactionsPage";

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
                <BreadcrumbPage>Financials</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
            Financials
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Manage cash collections, settlements, refunds, and shift records.
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <div className="overflow-x-auto pb-1 mb-6">
            <TabsList className="inline-flex h-auto bg-neutral-100 p-1 rounded-xl gap-0.5 min-w-max">
              <TabsTrigger
                value="confirmations"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Banknote className="w-4 h-4" />
                <span>Cash Confirmations</span>
                {pendingCashCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white px-1">
                    {pendingCashCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="settlements"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Scale className="w-4 h-4" />
                <span>Settlements</span>
              </TabsTrigger>
              <TabsTrigger
                value="refunds"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Refunds</span>
                {pendingRefundCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white px-1">
                    {pendingRefundCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="shifts"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Clock className="w-4 h-4" />
                <span>Cash Shifts</span>
              </TabsTrigger>
              <TabsTrigger
                value="transactions"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <ReceiptText className="w-4 h-4" />
                <span>All Transactions</span>
              </TabsTrigger>
            </TabsList>
          </div>

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
          <TabsContent value="transactions" className="mt-0 outline-none">
            <TransactionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </ManagerLayout>
  );
}
