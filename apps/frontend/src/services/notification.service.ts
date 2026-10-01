import apiClient from "@/lib/axios";
import type { NotificationItem } from "@repo/schemas";

/**
 * Which inbox a bell reads. The web shares one `accessToken` cookie across
 * roles, so every bell must call only its own role's base path.
 */
export type NotificationRole = "CUSTOMER" | "STAFF" | "MANAGER";

const BASE_PATH: Record<NotificationRole, string> = {
  CUSTOMER: "/user/notifications",
  STAFF: "/employee/notifications",
  MANAGER: "/branchManager/notifications",
};

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface ListNotificationsParams {
  /** publicId of the last item of the previous page. */
  cursor?: string | null;
  limit?: number;
  unreadOnly?: boolean;
}

export const notificationService = {
  /** Newest first, keyset-paginated by `cursor`. */
  async list(
    role: NotificationRole,
    { cursor, limit = 20, unreadOnly = false }: ListNotificationsParams = {},
  ): Promise<NotificationPage> {
    const response = await apiClient.get(BASE_PATH[role], {
      params: {
        limit,
        ...(cursor ? { cursor } : {}),
        ...(unreadOnly ? { unreadOnly: "true" } : {}),
      },
    });
    return response.data.data;
  },

  async unreadCount(role: NotificationRole): Promise<number> {
    const response = await apiClient.get(`${BASE_PATH[role]}/unread-count`);
    return response.data.data?.unreadCount ?? 0;
  },

  /** Idempotent: an already-read notification comes back with its existing readAt. */
  async markRead(
    role: NotificationRole,
    publicId: string,
  ): Promise<{ notification: NotificationItem; unreadCount: number }> {
    const response = await apiClient.patch(
      `${BASE_PATH[role]}/${encodeURIComponent(publicId)}/read`,
    );
    return response.data.data;
  },

  async markAllRead(
    role: NotificationRole,
  ): Promise<{ updated: number; unreadCount: number }> {
    const response = await apiClient.patch(`${BASE_PATH[role]}/read-all`);
    return response.data.data;
  },
};
