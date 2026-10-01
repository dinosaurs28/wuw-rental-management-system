import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { NotificationResponse } from 'expo-notifications';
import { notificationsApi } from '../lib/api';
import { loadNotifications } from '../lib/expoNotifications';
import {
  NOTIFICATIONS_QUERY_KEY,
  notificationAudienceFor,
  openNotificationTarget,
} from '../lib/notifications';
import { registerForPushAsync } from '../lib/push';
import { useAuthStore } from '../store/auth';
import type {
  NotificationAudience,
  NotificationPage,
  NotificationPushData,
} from '../types/notifications';

/**
 * In-app notifications (#19). The unread count refreshes every minute while
 * the app is open, whenever it returns to the foreground and when a push
 * arrives; the list is only fetched while a notifications screen is open.
 * Keys carry the user's publicId, so a second account on the same phone never
 * sees the previous one's cached inbox.
 */

type Session = {
  audience: NotificationAudience;
  userPublicId: string | null;
  enabled: boolean;
};

export function useNotificationSession(): Session {
  const token = useAuthStore((s) => s.token);
  const userPublicId = useAuthStore((s) => s.user?.publicId ?? null);
  const role = useAuthStore((s) => s.user?.role);
  return {
    audience: notificationAudienceFor(role),
    userPublicId,
    enabled: !!token && !!userPublicId,
  };
}

const unreadKey = (s: Session) => [...NOTIFICATIONS_QUERY_KEY, s.userPublicId, s.audience, 'unread-count'];
const listKey = (s: Session) => [...NOTIFICATIONS_QUERY_KEY, s.userPublicId, s.audience, 'list'];

type FeedData = InfiniteData<NotificationPage, string | null>;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** Unread count for the signed-in user's inbox; 0 for guests. */
export function useUnreadNotificationCount(): number {
  const session = useNotificationSession();
  const appActive = useAppActive();
  const { data } = useQuery({
    queryKey: unreadKey(session),
    queryFn: async () => {
      const res = await notificationsApi.unreadCount(session.audience);
      return Number(res.data?.data?.unreadCount ?? 0) || 0;
    },
    enabled: session.enabled,
    staleTime: 30_000,
    refetchInterval: session.enabled && appActive ? 60_000 : false,
  });
  return session.enabled ? data ?? 0 : 0;
}

/** Newest-first inbox, keyset-paginated (pass nextCursor back until null). */
export function useNotificationFeed() {
  const session = useNotificationSession();
  const qc = useQueryClient();
  const key = listKey(session);

  return useInfiniteQuery({
    queryKey: key,
    queryFn: async ({ pageParam }): Promise<NotificationPage> => {
      try {
        const res = await notificationsApi.list(session.audience, {
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        const page = res.data.data;
        qc.setQueryData(unreadKey(session), page.unreadCount);
        return {
          items: page.items ?? [],
          nextCursor: page.nextCursor ?? null,
          unreadCount: page.unreadCount ?? 0,
        };
      } catch (err: any) {
        if (pageParam && err?.response?.data?.code === 'INVALID_CURSOR') {
          // The row the cursor pointed at was pruned: start again from page one.
          setTimeout(() => {
            qc.resetQueries({ queryKey: key });
          }, 0);
          return {
            items: [],
            nextCursor: null,
            unreadCount: qc.getQueryData<number>(unreadKey(session)) ?? 0,
          };
        }
        throw err;
      }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: session.enabled,
    staleTime: 0,
  });
}

/** Marks one notification read; the list and badge update before the server answers. */
export function useMarkNotificationRead() {
  const session = useNotificationSession();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) => notificationsApi.markRead(session.audience, publicId),
    onMutate: (publicId) => {
      const now = new Date().toISOString();
      let wasUnread = false;
      qc.setQueryData<FeedData>(listKey(session), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((item) => {
                  if (item.publicId !== publicId || item.readAt) return item;
                  wasUnread = true;
                  return { ...item, readAt: now };
                }),
              })),
            }
          : old,
      );
      if (wasUnread) {
        qc.setQueryData<number>(unreadKey(session), (c) => Math.max(0, (c ?? 1) - 1));
      }
    },
    onSuccess: (res) => {
      const n = res.data?.data?.unreadCount;
      if (typeof n === 'number') qc.setQueryData(unreadKey(session), n);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}

/** Marks every notification read. */
export function useMarkAllNotificationsRead() {
  const session = useNotificationSession();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(session.audience),
    onSuccess: () => {
      const now = new Date().toISOString();
      qc.setQueryData<FeedData>(listKey(session), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                unreadCount: 0,
                items: p.items.map((item) => (item.readAt ? item : { ...item, readAt: now })),
              })),
            }
          : old,
      );
      qc.setQueryData(unreadKey(session), 0);
    },
  });
}

/**
 * Mount once, in the root layout. Registers this device for pushes after
 * sign-in, keeps the inbox fresh on foreground / push receipt, and opens what
 * a tapped push is about (including the tap that launched the app).
 */
export function useNotificationBridge(): void {
  const qc = useQueryClient();
  const { audience, userPublicId, enabled } = useNotificationSession();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
  }, [qc]);

  // Register after sign-in (and on launch with a saved session). The short
  // delay lets the splash / post-sign-in navigation settle before the OS
  // permission prompt appears.
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      registerForPushAsync(audience);
    }, 1500);
    let tokenSub: { remove: () => void } | null = null;
    try {
      tokenSub =
        loadNotifications()?.addPushTokenListener(() => {
          registerForPushAsync(audience, { force: true });
        }) ?? null;
    } catch {
      tokenSub = null;
    }
    return () => {
      clearTimeout(timer);
      tokenSub?.remove();
    };
  }, [enabled, userPublicId, audience]);

  // Back in the foreground: the badge may be stale.
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (/inactive|background/.test(last) && next === 'active') refresh();
      last = next;
    });
    return () => sub.remove();
  }, [refresh]);

  // A push arrived while the app is open.
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = loadNotifications()?.addNotificationReceivedListener(() => refresh()) ?? null;
    } catch {
      sub = null;
    }
    return () => sub?.remove();
  }, [refresh]);

  // A push was tapped. The launch tap is read once on mount; later taps come
  // through the listener. Both can report the same tap, so dedupe by id.
  const handled = useRef(new Set<string>());

  const handleResponse = useCallback(
    async (response: NotificationResponse) => {
      const Notifications = loadNotifications();
      if (!Notifications) return;
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        /* not available */
      }

      const { token, user } = useAuthStore.getState();
      // Signed out since it arrived: there is nothing of theirs to open.
      if (!token || !user) return;
      const tapAudience = notificationAudienceFor(user.role);
      const data = (response.notification.request.content.data ?? {}) as NotificationPushData;

      if (data.notificationPublicId) {
        notificationsApi
          .markRead(tapAudience, data.notificationPublicId)
          .catch(() => {})
          .finally(refresh);
      } else {
        refresh();
      }
      try {
        await openNotificationTarget(tapAudience, data.type, data);
      } catch {
        /* navigation is best-effort */
      }
    },
    [refresh],
  );

  useEffect(() => {
    const Notifications = loadNotifications();
    if (!Notifications) return;
    let mounted = true;
    // Deferred a tick so the first route (and its role redirect) has mounted.
    const timer = setTimeout(() => {
      if (!mounted) return;
      try {
        const last = Notifications.getLastNotificationResponse();
        if (last) handleResponse(last);
      } catch {
        /* not available */
      }
    }, 0);
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((r) => {
        handleResponse(r);
      });
    } catch {
      sub = null;
    }
    return () => {
      mounted = false;
      clearTimeout(timer);
      sub?.remove();
    };
  }, [handleResponse]);
}
