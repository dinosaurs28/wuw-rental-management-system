import { Router, type RequestHandler } from "express";
import {
  GetUnreadNotificationCount,
  ListNotifications,
  MarkAllNotificationsRead,
  MarkNotificationRead,
  RegisterPushToken,
  UnregisterPushToken,
} from "../../controller/notification/notification.controller.js";

/**
 * Builds the inbox router for one role. Mounted at:
 *   /api/user/notifications           (customer — authCheckJwt)
 *   /api/employee/notifications       (Fleet / STAFF — EmployeeCheck)
 *   /api/branchManager/notifications  (branch manager — ManagerCheck)
 */
export function makeNotificationRouter(guard: RequestHandler): Router {
  const router: Router = Router();

  router.get("/", guard, ListNotifications);
  router.get("/unread-count", guard, GetUnreadNotificationCount);
  router.patch("/read-all", guard, MarkAllNotificationsRead);
  router.patch("/:publicId/read", guard, MarkNotificationRead);
  router.post("/push-token", guard, RegisterPushToken);
  router.delete("/push-token", guard, UnregisterPushToken);

  return router;
}
