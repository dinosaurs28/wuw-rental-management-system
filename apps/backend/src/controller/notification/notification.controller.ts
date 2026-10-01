import type { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import {
  listNotificationsQuerySchema,
  registerPushTokenSchema,
  unregisterPushTokenSchema,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import {
  NotificationCursorError,
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  unregisterPushToken,
} from "../../services/notification/notification.service.js";

/**
 * Role-agnostic inbox endpoints. The router is mounted three times (customer,
 * Fleet, branch manager) behind that role's auth guard; every query is scoped
 * to the signed-in user, so one user can never see another's notifications.
 */

async function resolveUserId(req: Request, res: Response): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    res.status(StatusCode.UNAUTHORIZED).json({
      success: false,
      code: "USER_NOT_FOUND",
      message: "Your session is no longer valid. Please sign in again.",
    });
    return null;
  }
  return user.id;
}

function validationError(res: Response, message: string) {
  return res.status(StatusCode.BAD_REQUEST).json({
    success: false,
    code: "VALIDATION_ERROR",
    message,
  });
}

function serverError(res: Response, where: string, error: unknown) {
  console.error(`[notifications] ${where} error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Could not load notifications. Please try again.",
  });
}

/** GET / — newest first, keyset-paginated by `cursor`. */
export const ListNotifications = async (req: Request, res: Response) => {
  try {
    const parsed = listNotificationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationError(res, parsed.error.errors[0]?.message ?? "Invalid query");
    }
    const userId = await resolveUserId(req, res);
    if (userId === null) return;

    const page = await listNotifications(userId, parsed.data);
    return res.status(StatusCode.OK).json({ success: true, data: page });
  } catch (error) {
    if (error instanceof NotificationCursorError) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    return serverError(res, "ListNotifications", error);
  }
};

/** GET /unread-count */
export const GetUnreadNotificationCount = async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req, res);
    if (userId === null) return;
    const unreadCount = await countUnread(userId);
    return res.status(StatusCode.OK).json({ success: true, data: { unreadCount } });
  } catch (error) {
    return serverError(res, "GetUnreadNotificationCount", error);
  }
};

/** PATCH /:publicId/read */
export const MarkNotificationRead = async (req: Request, res: Response) => {
  try {
    const publicId = String(req.params.publicId ?? "").trim();
    if (!publicId) return validationError(res, "Notification id is required");
    const userId = await resolveUserId(req, res);
    if (userId === null) return;

    const item = await markNotificationRead(userId, publicId);
    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found.",
      });
    }
    const unreadCount = await countUnread(userId);
    return res.status(StatusCode.OK).json({ success: true, data: { notification: item, unreadCount } });
  } catch (error) {
    return serverError(res, "MarkNotificationRead", error);
  }
};

/** PATCH /read-all */
export const MarkAllNotificationsRead = async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req, res);
    if (userId === null) return;
    const updated = await markAllNotificationsRead(userId);
    return res.status(StatusCode.OK).json({ success: true, data: { updated, unreadCount: 0 } });
  } catch (error) {
    return serverError(res, "MarkAllNotificationsRead", error);
  }
};

/** POST /push-token — body { token, platform } */
export const RegisterPushToken = async (req: Request, res: Response) => {
  try {
    const parsed = registerPushTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_PUSH_TOKEN",
        message: parsed.error.errors[0]?.message ?? "Invalid push token",
      });
    }
    const userId = await resolveUserId(req, res);
    if (userId === null) return;

    await registerPushToken(userId, parsed.data.token, parsed.data.platform);
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Push notifications enabled on this device.",
    });
  } catch (error) {
    return serverError(res, "RegisterPushToken", error);
  }
};

/** DELETE /push-token — body { token } (or ?token=) */
export const UnregisterPushToken = async (req: Request, res: Response) => {
  try {
    const parsed = unregisterPushTokenSchema.safeParse({
      token: req.body?.token ?? req.query.token,
    });
    if (!parsed.success) {
      return validationError(res, parsed.error.errors[0]?.message ?? "token is required");
    }
    const userId = await resolveUserId(req, res);
    if (userId === null) return;

    const removed = await unregisterPushToken(userId, parsed.data.token);
    return res.status(StatusCode.OK).json({ success: true, data: { removed } });
  } catch (error) {
    return serverError(res, "UnregisterPushToken", error);
  }
};
