import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, ReceiptText } from "lucide-react";
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
import { FinancialsTab } from "@/components/manager/financials/FinancialsTab";
import { ActionQueues, type ActionQueue } from "@/components/manager/financials/ActionQueues";
import { defaultFinancialsState, type FinancialsViewState } from "@/components/manager/financials/financialsState";
import { CashShiftTab } from "@/components/manager/financials/CashShiftTab";

type SubTab = "financials" | "shift";

/** Old ?tab= values (Oct 2026 restructure): kept so bookmarks and notifications still land. */
const LEGACY_TABS: Record<string, SubTab> = {
  financials: "financials",
  transactions: "financials",
  shift: "shift",
  shifts: "shift",
  // Cash confirmations moved into the Cash Shift sub-tab (shift close / awaiting confirmation)
  confirmations: "shift",
};
const LEGACY_QUEUES: Record<string, ActionQueue> = { settlements: "settlements", refunds: "refunds" };

/**
 * Branch Manager → Financials. Two sub-tabs: "Financials" (default, view-only list of
 * every payment collected) and "Cash Shift". URL: ?tab=financials | ?tab=shift[&shift=<CashShift publicId>].
 * The Financials filters live here, so they survive switching sub-tabs.
 */
export function FinancialsDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pendingCashCount } = usePaymentStore();
  const [finState, setFinState] = useState<FinancialsViewState>(defaultFinancialsState);

  const rawTab = searchParams.get("tab") ?? "financials";
  const tab: SubTab = LEGACY_TABS[rawTab] ?? "financials";
  const shiftId = tab === "shift" ? searchParams.get("shift") : null;
  // ?queue=… or the old ?tab=settlements / ?tab=refunds open the action sheet
  const queue: ActionQueue | null = LEGACY_QUEUES[searchParams.get("queue") ?? ""] ?? LEGACY_QUEUES[rawTab] ?? null;

  const update = (next: { tab?: SubTab; shift?: string | null; queue?: ActionQueue | null }) => {
    const t = next.tab ?? tab;
    const params: Record<string, string> = { tab: t };
    const s = next.shift !== undefined ? next.shift : shiftId;
    if (t === "shift" && s) params.shift = s;
    const q = next.queue !== undefined ? next.queue : queue;
    if (q) params.queue = q;
    setSearchParams(params);
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
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
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Financials</h1>
            <p className="text-sm text-neutral-500 mt-1">Payments collected by your branch, and cash shifts.</p>
          </div>
          <ActionQueues open={queue} onOpenChange={(q) => update({ queue: q })} />
        </div>

        <Tabs value={tab} onValueChange={(v) => update({ tab: v as SubTab, shift: null })} className="w-full">
          <div className="overflow-x-auto pb-1 mb-6">
            <TabsList className="inline-flex h-auto bg-neutral-100 p-1 rounded-xl gap-0.5 min-w-max">
              <TabsTrigger
                value="financials"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <ReceiptText className="w-4 h-4" />
                <span>Financials</span>
              </TabsTrigger>
              <TabsTrigger
                value="shift"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600
                  data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm transition-all"
              >
                <Clock className="w-4 h-4" />
                <span>Cash Shift</span>
                {pendingCashCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white px-1">
                    {pendingCashCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="financials" className="mt-0 outline-none">
            <FinancialsTab
              state={finState}
              onChange={setFinState}
              onOpenShift={(id) => update({ tab: "shift", shift: id })}
            />
          </TabsContent>
          <TabsContent value="shift" className="mt-0 outline-none">
            <CashShiftTab shiftId={shiftId} onShiftIdChange={(id) => update({ tab: "shift", shift: id })} />
          </TabsContent>
        </Tabs>
      </div>
    </ManagerLayout>
  );
}
