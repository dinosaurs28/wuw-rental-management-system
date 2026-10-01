import type * as ExpoNotifications from 'expo-notifications';

export type NotificationsModule = typeof ExpoNotifications;

let cached: NotificationsModule | null | undefined;

/**
 * expo-notifications is a native module, and importing it in a binary built
 * before it was added (an older dev client) throws at import time, which a
 * static import would turn into a launch crash. Load it lazily and treat
 * "missing" as "no push" — in-app notifications work regardless.
 */
export function loadNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}
