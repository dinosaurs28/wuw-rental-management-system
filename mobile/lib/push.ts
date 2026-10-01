import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { NotificationPermissionsStatus } from 'expo-notifications';
import { Colors } from '../constants/colors';
import { useAuthStore } from '../store/auth';
import { notificationsApi } from './api';
import { loadNotifications, type NotificationsModule } from './expoNotifications';
import type { NotificationAudience } from '../types/notifications';

/**
 * Expo push (#19). Everything here is best-effort and never throws: a
 * simulator, Expo Go, a denied permission, missing FCM credentials or a
 * network error only means this device gets no pushes. In-app notifications
 * keep working regardless, and nothing here may block sign-in or sign-out.
 *
 * Push needs a native (EAS) build. Android additionally needs the app's
 * google-services.json (see app.config.js) and FCM V1 credentials uploaded to
 * EAS (ops); without the former, pushSupported() is false on Android.
 */

// The token this device last registered, and against which inbox, so
// sign-out can detach it from the user.
const REGISTRATION_KEY = 'wuw_push_registration';

/** The server sends every push on this channel id. */
export const ANDROID_CHANNEL_ID = 'default';

interface StoredRegistration {
  token: string;
  audience: NotificationAudience;
}

let presentationConfigured = false;

/** Show banners for pushes that arrive while the app is open. Call once at startup. */
export function configureNotificationPresentation(): void {
  if (presentationConfigured) return;
  presentationConfigured = true;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Native module missing (e.g. an old dev client) — pushes just won't show.
  }
}

/**
 * False where remote pushes cannot work: web, Expo Go (SDK 53+ dropped them),
 * a binary built without the native module, and an Android build without
 * Firebase config (app.config.js adds googleServicesFile once it exists) —
 * there the token call always throws, so don't ask for the permission.
 */
export function pushSupported(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  if (Platform.OS === 'android' && !Constants.expoConfig?.android?.googleServicesFile) return false;
  return loadNotifications() !== null;
}

function easProjectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

async function readStoredRegistration(): Promise<StoredRegistration | null> {
  try {
    const raw = await SecureStore.getItemAsync(REGISTRATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRegistration>;
    if (!parsed?.token) return null;
    return { token: parsed.token, audience: parsed.audience === 'STAFF' ? 'STAFF' : 'CUSTOMER' };
  } catch {
    return null;
  }
}

// Android 13+ only shows the permission prompt once a channel exists.
async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Bookings and alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: Colors.orange,
  });
}

function allowed(Notifications: NotificationsModule, p: NotificationPermissionsStatus): boolean {
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

// Asks only while the OS still lets us; a denial is respected silently.
async function ensurePermission(Notifications: NotificationsModule): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (allowed(Notifications, current)) return true;
  if (!current.canAskAgain) return false;
  return allowed(Notifications, await Notifications.requestPermissionsAsync());
}

let registering: Promise<string | null> | null = null;
// `${userPublicId}|${audience}|${token}` already sent in this process.
let registeredKey: string | null = null;

/**
 * Asks for permission (first time only), gets this device's Expo push token
 * and registers it with the signed-in user's inbox. Resolves the token, or
 * null when push is unavailable. `force` re-sends after a token rotation.
 */
export function registerForPushAsync(
  audience: NotificationAudience,
  opts?: { force?: boolean },
): Promise<string | null> {
  if (registering) return registering;
  registering = doRegister(audience, opts?.force === true).finally(() => {
    registering = null;
  });
  return registering;
}

async function doRegister(audience: NotificationAudience, force: boolean): Promise<string | null> {
  try {
    const Notifications = loadNotifications();
    if (!Notifications || !pushSupported()) return null;
    const projectId = easProjectId();
    if (!projectId) return null;

    const session = useAuthStore.getState();
    const authToken = session.token;
    const userPublicId = session.user?.publicId;
    if (!authToken || !userPublicId) return null;

    await ensureAndroidChannel(Notifications);
    if (!(await ensurePermission(Notifications))) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const key = `${userPublicId}|${audience}|${token}`;
    if (!force && registeredKey === key) return token;

    await notificationsApi.registerPushToken(audience, {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });

    // Signed out (or into another account) while this was in flight: keep no
    // record for a session that is gone — that sign-out already ran.
    if (useAuthStore.getState().token !== authToken) return null;

    const previous = await readStoredRegistration();
    if (previous && previous.token !== token) {
      // The OS rotated the token: detach the stale one from this user.
      notificationsApi.unregisterPushToken(audience, previous.token).catch(() => {});
    }
    await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify({ token, audience }));
    registeredKey = key;
    return token;
  } catch (err: any) {
    if (__DEV__) console.warn('[push] registration skipped:', err?.message ?? err);
    return null;
  }
}

let unregistering: Promise<void> | null = null;

/**
 * Detaches this device from the signed-in user. Must run BEFORE the auth token
 * is dropped. Best-effort: 0 rows removed, offline or an expired session are
 * all fine — the server also re-assigns the token on the next sign-in.
 */
export function unregisterPushAsync(): Promise<void> {
  if (unregistering) return unregistering;
  unregistering = doUnregister().finally(() => {
    unregistering = null;
  });
  return unregistering;
}

async function doUnregister(): Promise<void> {
  registeredKey = null;
  const stored = await readStoredRegistration();
  try {
    // Forget it first: the DELETE below can 401 on an expired session, and the
    // 401 handler signs out again, which lands back here.
    await SecureStore.deleteItemAsync(REGISTRATION_KEY);
  } catch {
    /* nothing stored */
  }
  if (stored && useAuthStore.getState().token) {
    try {
      await notificationsApi.unregisterPushToken(stored.audience, stored.token);
    } catch {
      /* best-effort */
    }
  }
  const Notifications = loadNotifications();
  if (Notifications && pushSupported()) {
    // The previous user's alerts must not stay tappable in the tray.
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch {
      /* best-effort */
    }
  }
}
