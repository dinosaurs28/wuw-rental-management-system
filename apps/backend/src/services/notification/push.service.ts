import { prisma } from "@repo/database/client";
import { EXPO_PUSH_TOKEN_PATTERN } from "@repo/schemas";

/**
 * Expo push sender. Talks to the Expo push API directly with fetch — no SDK
 * dependency. Push is best-effort: in-app rows are the source of truth, so a
 * failure here is logged and swallowed.
 *
 * Env:
 *   PUSH_ENABLED=false   turns sending off (rows are still written)
 *   EXPO_ACCESS_TOKEN    sent as a Bearer token when the Expo project has
 *                        "enhanced push security" switched on
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts at most 100 messages per request.
const CHUNK_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;

export interface PushableNotification {
  id: number;
  publicId: string;
  userId: number;
  type: string;
  title: string;
  body: string;
  data: unknown;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: "default";
  priority: "high";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

function isPushEnabled(): boolean {
  return (process.env.PUSH_ENABLED ?? "true").toLowerCase() !== "false";
}

async function postChunk(messages: ExpoMessage[]): Promise<ExpoTicket[] | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: ExpoTicket[]; errors?: Array<{ code?: string; message?: string }> }
    | null;

  if (!response.ok || !payload || !Array.isArray(payload.data)) {
    console.error(
      `[push] Expo push request failed status=${response.status}`,
      payload?.errors ?? payload,
    );
    return null;
  }
  return payload.data;
}

/**
 * Sends one push per (notification, device token). Marks Notification.pushedAt
 * when at least one device accepted it, and deletes tokens Expo reports as
 * DeviceNotRegistered (app uninstalled / token rotated).
 */
export async function sendPushForNotifications(rows: PushableNotification[]): Promise<void> {
  if (rows.length === 0 || !isPushEnabled()) return;

  try {
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, token: true },
    });
    if (tokens.length === 0) return;

    const tokensByUser = new Map<number, string[]>();
    for (const t of tokens) {
      if (!EXPO_PUSH_TOKEN_PATTERN.test(t.token)) continue;
      const list = tokensByUser.get(t.userId) ?? [];
      list.push(t.token);
      tokensByUser.set(t.userId, list);
    }

    const messages: ExpoMessage[] = [];
    const targets: Array<{ notificationId: number; token: string }> = [];
    for (const row of rows) {
      const userTokens = tokensByUser.get(row.userId);
      if (!userTokens) continue;
      const data =
        row.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      for (const token of userTokens) {
        messages.push({
          to: token,
          title: row.title,
          body: row.body,
          data: { ...data, type: row.type, notificationPublicId: row.publicId },
          sound: "default",
          channelId: "default",
          priority: "high",
        });
        targets.push({ notificationId: row.id, token });
      }
    }
    if (messages.length === 0) return;

    const delivered = new Set<number>();
    const deadTokens = new Set<string>();

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      const chunk = messages.slice(i, i + CHUNK_SIZE);
      let tickets: ExpoTicket[] | null = null;
      try {
        tickets = await postChunk(chunk);
      } catch (error) {
        console.error("[push] Expo push request threw:", error);
      }
      if (!tickets) continue;

      tickets.forEach((ticket, j) => {
        const target = targets[i + j];
        if (!target) return;
        if (ticket.status === "ok") {
          delivered.add(target.notificationId);
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          deadTokens.add(target.token);
        } else {
          console.warn(
            `[push] ticket error for notification=${target.notificationId}: ${ticket.details?.error ?? ""} ${ticket.message ?? ""}`,
          );
        }
      });
    }

    if (delivered.size > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: [...delivered] } },
        data: { pushedAt: new Date() },
      });
    }
    if (deadTokens.size > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: [...deadTokens] } } });
      console.log(`[push] removed ${deadTokens.size} unregistered device token(s)`);
    }
  } catch (error) {
    console.error("[push] sendPushForNotifications failed:", error);
  }
}
