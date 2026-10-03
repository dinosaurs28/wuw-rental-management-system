import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type * as ExpoApplication from 'expo-application';
import { deepLinkApi } from './api';
import {
  DEFERRED_LINK_TTL_SECONDS,
  isValidVehicleLinkId,
  parseInstallReferrerVehicleId,
} from './shareLink';

/**
 * Deferred deep link (#16): someone taps a shared vehicle link without the app,
 * installs it from the store, and the first launch opens that vehicle.
 *
 *   Android : the Play Store link carries referrer=vehicle%3D<id>, read back
 *             with the Play Install Referrer API (expo-application).
 *   Otherwise (iOS, or no vehicle in the referrer): the website recorded the
 *             link for this network + platform before the store redirect;
 *             POST /api/public/deferred-links/claim hands it out once.
 *
 * Runs once per install: the "checked" flag is written before the caller
 * navigates, so a crash on the vehicle page can't loop. Best-effort and never
 * throws — any failure just means the normal home screen.
 */

const CHECKED_KEY = 'wuw_deferred_link_checked';

// A referrer is honoured only on a recent install: an update of an older
// install (or cleared app data) must not re-open an old shared vehicle.
const REFERRER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A recorded link expires an hour after the tap, and the tap came before the
// install — an install older than that can't have one waiting.
const CLAIM_MAX_AGE_MS = DEFERRED_LINK_TTL_SECONDS * 1000;

const REFERRER_TIMEOUT_MS = 3_000;
const INSTALL_TIME_TIMEOUT_MS = 2_000;

type ApplicationModule = typeof ExpoApplication;

let cachedApplication: ApplicationModule | null | undefined;

/**
 * expo-application is a native module; load it lazily so a binary built
 * without it (an older dev client) skips the referrer instead of crashing.
 */
function loadApplication(): ApplicationModule | null {
  if (cachedApplication !== undefined) return cachedApplication;
  try {
    cachedApplication = require('expo-application') as ApplicationModule;
  } catch {
    cachedApplication = null;
  }
  return cachedApplication;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Milliseconds since this app was installed (updates don't count), or null if unknown. */
async function installAgeMs(app: ApplicationModule | null): Promise<number | null> {
  if (!app) return null;
  try {
    const installedAt = await withTimeout(app.getInstallationTimeAsync(), INSTALL_TIME_TIMEOUT_MS);
    if (!(installedAt instanceof Date) || Number.isNaN(installedAt.getTime())) return null;
    return Math.max(0, Date.now() - installedAt.getTime());
  } catch {
    return null;
  }
}

async function referrerVehicleId(app: ApplicationModule | null): Promise<string | null> {
  if (Platform.OS !== 'android' || !app) return null;
  try {
    const referrer = await withTimeout(app.getInstallReferrerAsync(), REFERRER_TIMEOUT_MS);
    return parseInstallReferrerVehicleId(referrer);
  } catch {
    return null;
  }
}

type ClaimOutcome =
  | { kind: 'answered'; vehicleId: string | null }
  /** No response (offline / timeout): try again on the next launch. */
  | { kind: 'unreachable' };

async function claimVehicleId(platform: 'android' | 'ios'): Promise<ClaimOutcome> {
  try {
    const res = await deepLinkApi.claim(platform);
    const id = res.data?.data?.vehicleId;
    return { kind: 'answered', vehicleId: isValidVehicleLinkId(id) ? id : null };
  } catch (err: any) {
    // Any HTTP answer (429, 503, 400) means "nothing to open" for this launch.
    return err?.response ? { kind: 'answered', vehicleId: null } : { kind: 'unreachable' };
  }
}

async function markChecked(): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(CHECKED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * The vehicle id (group key or publicId) a fresh install should open, or null.
 * Call once per app start; it returns null on every launch after the first.
 */
export async function resolveDeferredVehicleLink(): Promise<string | null> {
  const platform = Platform.OS;
  if (platform !== 'android' && platform !== 'ios') return null;
  // Expo Go's referrer and install time are Expo Go's own, not this app's.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;

  try {
    if (await SecureStore.getItemAsync(CHECKED_KEY)) return null;
  } catch {
    return null;
  }

  const app = loadApplication();
  const age = await installAgeMs(app);

  let vehicleId: string | null = null;
  if (age === null || age <= REFERRER_MAX_AGE_MS) {
    vehicleId = await referrerVehicleId(app);
  }

  if (!vehicleId && (age === null || age <= CLAIM_MAX_AGE_MS)) {
    const claim = await claimVehicleId(platform);
    if (claim.kind === 'unreachable') return null;
    vehicleId = claim.vehicleId;
  }

  // Flag first, then open: if the vehicle page ever crashed, the next launch
  // must not try again.
  if (!(await markChecked())) return null;
  return vehicleId;
}
