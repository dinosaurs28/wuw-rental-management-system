import { vehicleAppPathFromSystemUrl } from '../lib/shareLink';

/**
 * Rewrites the URLs the OS opens the app with (#16), before expo-router
 * matches a route. Shared vehicle links are https://whatuwantrentals.com/app/
 * vehicle/<id> (Android App Links / iOS Universal Links, see app.json); the
 * app has no /app/... routes and the website's group pages live under
 * /vehicle/group/<key>, so every vehicle link is mapped to the in-app
 * /vehicle/<id> screen, which takes both a group key and a vehicle publicId.
 * Everything else (the plain launch URL, auth redirects, other deep links) is
 * passed through untouched, and this never throws — a bad link must not stop
 * the app from starting.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return vehicleAppPathFromSystemUrl(path) ?? path;
  } catch {
    return path;
  }
}
