import { useSearchParams } from "react-router-dom";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { ManagerConfirmations } from "@/components/manager/dashboard/ManagerConfirmations";
import { SafetyDepositRequests } from "@/components/manager/dashboard/SafetyDepositRequests";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { MANAGER_CONFIRMATIONS_CHANGED_EVENT } from "@/services/managerDashboard.service";

// ManagerLayout refreshes its pending-confirmations badge on this event
const announceChange = () => window.dispatchEvent(new Event(MANAGER_CONFIRMATIONS_CHANGED_EVENT));

/**
 * Everything Fleet sent to the Branch Manager to act on: pickups and returns
 * sent for confirmation, and safety deposits requested at pickup.
 * `?booking=<publicId>` opens that booking's review (notification links,
 * the overdue list's "awaiting confirmation" rows).
 */
export const ConfirmationsPage = () => {
  const [searchParams] = useSearchParams();
  const focusBookingId = searchParams.get("booking");

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12 space-y-6">
        <div>
          <Breadcrumb className="mb-2">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Confirmations</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Confirmations</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Pickups, returns and safety deposits Fleet sent for your approval.
          </p>
        </div>

        <ManagerConfirmations focusBookingId={focusBookingId} onChanged={announceChange} />
        <SafetyDepositRequests onChanged={announceChange} />
      </div>
    </ManagerLayout>
  );
};
