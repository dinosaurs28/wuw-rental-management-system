import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceStrict } from "date-fns";
import {
  AlarmClock,
  ArrowLeftRight,
  Banknote,
  Bell,
  BellRing,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  IndianRupee,
  KeyRound,
  Loader2,
  Repeat2,
  Scale,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { NotificationItem } from "@repo/schemas";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth.store";
import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { useBranchManagerAuthStore } from "@/store/branchManagerAuth.store";
import type { NotificationRole } from "@/services/notification.service";
import {
  isNotificationAuthError,
  notificationErrorMessage,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useNotificationUnreadCount,
} from "@/hooks/useNotifications";
import { notificationLink } from "./notificationLinks";

interface NotificationBellProps {
  /** Whose inbox this bell reads — it only ever calls that role's endpoints. */
  role: NotificationRole;
  /** "dark" for the transparent/black landing navbar. */
  tone?: "light" | "dark";
  className?: string;
}

type Tone = "green" | "red" | "amber" | "sky";

const TONE_CLASS: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-600",
  sky: "bg-sky-50 text-sky-600",
};

const TYPE_VISUAL: Record<string, { icon: LucideIcon; tone: Tone }> = {
  BOOKING_CONFIRMED: { icon: CalendarCheck, tone: "green" },
  BOOKING_CANCELLED: { icon: CalendarX, tone: "red" },
  BOOKING_DISPLACED: { icon: ArrowLeftRight, tone: "amber" },
  PAYMENT_NEEDS_REFUND: { icon: IndianRupee, tone: "red" },
  REFUND_COMPLETED: { icon: IndianRupee, tone: "green" },
  EXTENSION_CONFIRMED: { icon: CalendarPlus, tone: "green" },
  EXTENSION_REJECTED: { icon: CalendarX, tone: "red" },
  PICKUP_COMPLETED: { icon: KeyRound, tone: "green" },
  PICKUP_APPROVAL_REQUESTED: { icon: ClipboardCheck, tone: "amber" },
  RETURN_COMPLETED: { icon: CircleCheck, tone: "green" },
  RETURN_APPROVAL_REQUESTED: { icon: ClipboardCheck, tone: "amber" },
  RETURN_OVERDUE: { icon: AlarmClock, tone: "red" },
  DAMAGE_REPORTED: { icon: TriangleAlert, tone: "amber" },
  DAMAGE_CHARGED: { icon: TriangleAlert, tone: "red" },
  VEHICLE_SWAPPED: { icon: Repeat2, tone: "sky" },
  APPROVAL_REQUESTED: { icon: ClipboardCheck, tone: "amber" },
  APPROVAL_RESOLVED: { icon: ShieldCheck, tone: "green" },
  CASH_DELAYED: { icon: Banknote, tone: "amber" },
  SHIFT_DISCREPANCY: { icon: Scale, tone: "red" },
};

const EMPTY_HINT: Record<NotificationRole, string> = {
  CUSTOMER: "Updates about your bookings will show up here.",
  STAFF: "Booking and approval updates for your branch will show up here.",
  MANAGER: "Approvals, payment alerts and booking updates for your branch will show up here.",
};

function visualFor(item: NotificationItem): { icon: LucideIcon; tone: Tone } {
  if (item.type === "APPROVAL_RESOLVED" && item.data?.approved === false) {
    return { icon: ShieldX, tone: "red" };
  }
  return TYPE_VISUAL[item.type] ?? { icon: Bell, tone: "sky" };
}

const IST_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const IST_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "08 Mar 2026, 02:30 PM IST" — whatever the browser's timezone. */
function formatIst(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const parts = IST_DATE_TIME.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} IST`;
}

/** "Just now", "5 minutes ago", … then a plain IST date after a week. */
function relativeTime(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  if (isNaN(time)) return "";
  const diff = now - time;
  if (diff < 60_000) return "Just now";
  if (diff < 7 * 24 * 60 * 60_000) {
    return formatDistanceStrict(time, now, { addSuffix: true });
  }
  return IST_DATE.format(new Date(time));
}

/** The signed-in user's id for this role's store, or null when signed out. */
function useNotificationUserKey(role: NotificationRole): string | null {
  const customerId = useAuthStore((s) =>
    s.isAuthenticated && s.user && (!s.user.role || s.user.role === "CUSTOMER")
      ? s.user.id
      : null,
  );
  const staffId = useEmployeeAuthStore((s) =>
    s.isAuthenticated && s.user ? s.user.id : null,
  );
  const managerId = useBranchManagerAuthStore((s) =>
    s.isAuthenticated && s.user ? s.user.id : null,
  );
  if (role === "CUSTOMER") return customerId;
  if (role === "STAFF") return staffId;
  return managerId;
}

export function NotificationBell({ role, tone = "light", className }: NotificationBellProps) {
  const navigate = useNavigate();
  const userId = useNotificationUserKey(role);
  const userKey = userId ?? "";
  const signedIn = userId !== null;

  const [open, setOpen] = useState(false);
  // Reference time for relative labels, refreshed each time the bell opens.
  const [now, setNow] = useState(() => Date.now());

  const unreadQuery = useNotificationUnreadCount(role, userKey, signedIn);
  const listQuery = useNotificationList(role, userKey, signedIn && open);
  const markRead = useMarkNotificationRead(role, userKey);
  const markAllRead = useMarkAllNotificationsRead(role, userKey);

  // Not signed in for this role, or the shared cookie belongs to another
  // role: render nothing rather than a bell that can't load.
  if (!signedIn || isNotificationAuthError(unreadQuery.error)) return null;

  const unreadCount = unreadQuery.data ?? 0;
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const handleOpenChange = (next: boolean) => {
    if (next) setNow(Date.now());
    setOpen(next);
  };

  const handleSelect = (item: NotificationItem) => {
    if (item.readAt === null) markRead.mutate(item.publicId);
    const link = notificationLink(role, item);
    if (link) {
      setOpen(false);
      navigate(link);
    }
  };

  const isDark = tone === "dark";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className={cn(
            "relative inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F00]/50",
            isDark
              ? "text-gray-200 hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 data-[state=open]:bg-neutral-100",
            className,
          )}
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF5F00] px-1 text-[10px] font-bold leading-none text-white tabular-nums ring-2",
                isDark ? "ring-black" : "ring-white",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(380px,calc(100vw-1rem))] overflow-hidden rounded-xl border-neutral-200 bg-white p-0 text-neutral-900 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">Notifications</p>
            <p className="text-xs text-neutral-500">
              {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs text-neutral-600 hover:text-neutral-900"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {markAllRead.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCheck className="size-3.5" />
            )}
            Mark all read
          </Button>
        </div>

        {/* Body */}
        <div className="max-h-[min(26rem,65vh)] overflow-y-auto overscroll-contain">
          {listQuery.isPending ? (
            <div className="space-y-1 p-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 px-2 py-2.5">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/5" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : listQuery.isError && items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-neutral-600">
                {notificationErrorMessage(
                  listQuery.error,
                  "Could not load notifications. Please try again.",
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => listQuery.refetch()}
                disabled={listQuery.isFetching}
              >
                {listQuery.isFetching && <Loader2 className="size-3.5 animate-spin" />}
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                <BellRing className="size-5" />
              </span>
              <p className="text-sm font-medium text-neutral-800">No notifications yet</p>
              <p className="text-xs text-neutral-500">{EMPTY_HINT[role]}</p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((item) => {
                const unread = item.readAt === null;
                const { icon: Icon, tone: itemTone } = visualFor(item);
                return (
                  <li key={item.publicId}>
                    <button
                      type="button"
                      onClick={() => handleSelect(item)}
                      className={cn(
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50",
                        unread && "bg-orange-50/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                          TONE_CLASS[itemTone],
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={cn(
                              "text-sm leading-snug text-neutral-900",
                              unread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {item.title}
                          </span>
                          {unread && (
                            <span
                              className="mt-1.5 size-2 shrink-0 rounded-full bg-[#FF5F00]"
                              aria-label="Unread"
                            />
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-3 block text-xs leading-relaxed text-neutral-600">
                          {item.body}
                        </span>
                        <time
                          dateTime={item.createdAt}
                          title={formatIst(item.createdAt)}
                          className="mt-1 block text-[11px] text-neutral-400"
                        >
                          {relativeTime(item.createdAt, now)}
                        </time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {items.length > 0 && listQuery.hasNextPage && (
            <div className="border-t border-neutral-100 p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-neutral-600"
                disabled={listQuery.isFetchingNextPage}
                onClick={() => listQuery.fetchNextPage()}
              >
                {listQuery.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
                {listQuery.isFetchingNextPage ? "Loading…" : "Load older notifications"}
              </Button>
            </div>
          )}

          {items.length > 0 && listQuery.isFetchNextPageError && (
            <p className="px-4 pb-3 text-center text-xs text-red-600">
              {notificationErrorMessage(
                listQuery.error,
                "Could not load more notifications. Please try again.",
              )}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
