import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationItem } from "@repo/schemas";
import {
  notificationService,
  type NotificationPage,
  type NotificationRole,
} from "@/services/notification.service";

const UNREAD_POLL_MS = 30_000;
const PAGE_SIZE = 20;

type NotificationListData = InfiniteData<NotificationPage, string | null>;

/**
 * Keys are scoped by role and by the signed-in user's id, so a different
 * login in the same tab never sees the previous user's cached inbox.
 */
export const notificationKeys = {
  all: ["notifications"] as const,
  scope: (role: NotificationRole, userKey: string) =>
    ["notifications", role, userKey] as const,
  unreadCount: (role: NotificationRole, userKey: string) =>
    ["notifications", role, userKey, "unread-count"] as const,
  list: (role: NotificationRole, userKey: string) =>
    ["notifications", role, userKey, "list"] as const,
};

function errorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/**
 * 401/403 means the shared cookie belongs to another role (or the session
 * ended). The bell then stays quiet instead of polling or showing errors.
 */
export function isNotificationAuthError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

export function notificationErrorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { code?: string } } } | null)?.response
    ?.data?.code;
}

export function notificationErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } } | null)?.response
      ?.data?.message || fallback
  );
}

/** Only network/5xx failures are worth retrying; 4xx answers won't change. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

function patchItems(
  data: NotificationListData | undefined,
  patch: (item: NotificationItem) => NotificationItem,
): NotificationListData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: page.items.map(patch) })),
  };
}

/** Unread badge: polled every 30 s and on window focus while signed in. */
export function useNotificationUnreadCount(
  role: NotificationRole,
  userKey: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: notificationKeys.unreadCount(role, userKey),
    queryFn: () => notificationService.unreadCount(role),
    enabled,
    refetchInterval: (query) =>
      isNotificationAuthError(query.state.error) ? false : UNREAD_POLL_MS,
    refetchOnWindowFocus: (query) => !isNotificationAuthError(query.state.error),
    retry: shouldRetry,
  });
}

/** The dropdown list. Fetched only while the bell is open. */
export function useNotificationList(
  role: NotificationRole,
  userKey: string,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const queryKey = notificationKeys.list(role, userKey);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await notificationService.list(role, {
        cursor: pageParam,
        limit: PAGE_SIZE,
      });
      // Every page carries the live unread count — keep the badge in step.
      queryClient.setQueryData(
        notificationKeys.unreadCount(role, userKey),
        page.unreadCount,
      );
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    retry: shouldRetry,
  });

  // A cursor that was pruned or is otherwise unknown: drop it and reload page 1.
  const invalidCursor = notificationErrorCode(query.error) === "INVALID_CURSOR";
  useEffect(() => {
    if (invalidCursor) {
      queryClient.resetQueries({ queryKey: notificationKeys.list(role, userKey) });
    }
  }, [invalidCursor, queryClient, role, userKey]);

  return query;
}

export function useMarkNotificationRead(role: NotificationRole, userKey: string) {
  const queryClient = useQueryClient();
  const listKey = notificationKeys.list(role, userKey);
  const countKey = notificationKeys.unreadCount(role, userKey);

  return useMutation({
    mutationFn: (publicId: string) => notificationService.markRead(role, publicId),
    onMutate: async (publicId) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const list = queryClient.getQueryData<NotificationListData>(listKey);
      const wasUnread = !!list?.pages.some((page) =>
        page.items.some((item) => item.publicId === publicId && item.readAt === null),
      );
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationListData>(listKey, (data) =>
        patchItems(data, (item) =>
          item.publicId === publicId && item.readAt === null ? { ...item, readAt } : item,
        ),
      );
      if (wasUnread) {
        queryClient.setQueryData<number>(countKey, (count) =>
          Math.max(0, (count ?? 1) - 1),
        );
      }
    },
    onSuccess: ({ notification, unreadCount }) => {
      queryClient.setQueryData<NotificationListData>(listKey, (data) =>
        patchItems(data, (item) =>
          item.publicId === notification.publicId ? notification : item,
        ),
      );
      queryClient.setQueryData(countKey, unreadCount);
    },
    onError: () => {
      // Resync with the server rather than guessing what failed.
      queryClient.invalidateQueries({ queryKey: notificationKeys.scope(role, userKey) });
    },
  });
}

export function useMarkAllNotificationsRead(role: NotificationRole, userKey: string) {
  const queryClient = useQueryClient();
  const listKey = notificationKeys.list(role, userKey);
  const countKey = notificationKeys.unreadCount(role, userKey);

  return useMutation({
    mutationFn: () => notificationService.markAllRead(role),
    onSuccess: ({ unreadCount }) => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationListData>(listKey, (data) =>
        patchItems(data, (item) => (item.readAt === null ? { ...item, readAt } : item)),
      );
      queryClient.setQueryData(countKey, unreadCount);
    },
    onError: (error) => {
      toast.error(
        notificationErrorMessage(error, "Could not mark notifications as read. Please try again."),
      );
      queryClient.invalidateQueries({ queryKey: notificationKeys.scope(role, userKey) });
    },
  });
}
