import { loadEnv, type Plugin } from "vite";

/**
 * App Links / Universal Links verification files for shared vehicle links
 * (#16), generated at build time. Both values are public (they are served in
 * these very files), so the live app's values are the defaults; env overrides:
 *
 *   ANDROID_CERT_SHA256   SHA-256 fingerprint(s) of the Android signing cert —
 *                         the Play App Signing key and, if wanted, the upload
 *                         key — separated by commas, spaces or newlines
 *                         → /.well-known/assetlinks.json
 *   APPLE_TEAM_ID         the 10-character Apple Developer team id
 *                         → /.well-known/apple-app-site-association
 *   ANDROID_PACKAGE_NAME  optional, default com.whatuwantrentals.rentals
 *   IOS_BUNDLE_ID         optional, default com.whatuwantrentals.rentals
 *
 * Set an env value to "none" to skip that file; a malformed value fails the build
 * (a wrong fingerprint would silently stop the app opening links). The files
 * are emitted into dist/.well-known (and served by the dev server);
 * public/_headers serves them as application/json on Cloudflare Pages.
 */

const DEFAULT_APP_ID = "com.whatuwantrentals.rentals";
/** Play App Signing key of the live com.whatuwantrentals.rentals listing. */
const DEFAULT_ANDROID_CERT_SHA256 =
  "FF:B5:8A:92:83:10:69:02:EF:54:DB:2D:19:0A:AF:74:39:92:2F:AF:2A:E4:78:55:D1:48:8F:BC:0D:06:A2:5F";
/** Apple Developer team of the live iOS app. */
const DEFAULT_APPLE_TEAM_ID = "Y6TXM4HFSK";

/** Website paths the iOS app opens itself (Android lists them in its intent filters). */
const APP_LINK_PATHS = [
  { path: "/app/vehicle/*", comment: "Shared vehicle links" },
  { path: "/vehicle/*", comment: "Website vehicle pages" },
];

const ASSET_LINKS_FILE = ".well-known/assetlinks.json";
const AASA_FILE = ".well-known/apple-app-site-association";

interface WellKnownFile {
  fileName: string;
  source: string;
}

function envValue(env: Record<string, string>, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function parseFingerprints(raw: string): string[] {
  const out: string[] = [];
  for (const item of raw.split(/[\s,;]+/).filter(Boolean)) {
    const hex = item.replace(/:/g, "").toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hex)) {
      throw new Error(
        `ANDROID_CERT_SHA256: "${item}" is not a SHA-256 certificate fingerprint (64 hex digits, colons optional).`,
      );
    }
    const formatted = hex.match(/../g)!.join(":");
    if (!out.includes(formatted)) out.push(formatted);
  }
  return out;
}

function appId(env: Record<string, string>, key: string): string {
  const value = envValue(env, key) ?? DEFAULT_APP_ID;
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$/.test(value)) {
    throw new Error(`${key}: "${value}" is not a valid app id (e.g. ${DEFAULT_APP_ID}).`);
  }
  return value;
}

export function buildWellKnownFiles(
  env: Record<string, string>,
  log: (message: string) => void = () => {},
): WellKnownFile[] {
  const files: WellKnownFile[] = [];

  const fingerprintsEnv = envValue(env, "ANDROID_CERT_SHA256") ?? DEFAULT_ANDROID_CERT_SHA256;
  const fingerprintsRaw = fingerprintsEnv.toLowerCase() === "none" ? null : fingerprintsEnv;
  if (fingerprintsRaw) {
    const fingerprints = parseFingerprints(fingerprintsRaw);
    if (fingerprints.length === 0) {
      throw new Error("ANDROID_CERT_SHA256 is set but holds no fingerprint.");
    }
    const assetLinks = [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: appId(env, "ANDROID_PACKAGE_NAME"),
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ];
    files.push({ fileName: ASSET_LINKS_FILE, source: `${JSON.stringify(assetLinks, null, 2)}\n` });
  } else {
    log(`ANDROID_CERT_SHA256=none: ${ASSET_LINKS_FILE} skipped`);
  }

  const teamIdEnv = envValue(env, "APPLE_TEAM_ID") ?? DEFAULT_APPLE_TEAM_ID;
  const teamIdRaw = teamIdEnv.toLowerCase() === "none" ? null : teamIdEnv;
  if (teamIdRaw) {
    const teamId = teamIdRaw.toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(teamId)) {
      throw new Error(`APPLE_TEAM_ID: "${teamIdRaw}" is not a 10-character Apple team id.`);
    }
    const appID = `${teamId}.${appId(env, "IOS_BUNDLE_ID")}`;
    // appID + paths for iOS 12 and older; appIDs + components for iOS 13+.
    const aasa = {
      applinks: {
        apps: [],
        details: [
          {
            appID,
            paths: APP_LINK_PATHS.map((p) => p.path),
            appIDs: [appID],
            components: APP_LINK_PATHS.map((p) => ({ "/": p.path, comment: p.comment })),
          },
        ],
      },
    };
    files.push({ fileName: AASA_FILE, source: `${JSON.stringify(aasa, null, 2)}\n` });
  } else {
    log(`APPLE_TEAM_ID=none: ${AASA_FILE} skipped`);
  }

  return files;
}

export function wellKnownPlugin(): Plugin {
  let files: WellKnownFile[] = [];
  return {
    name: "wuw-well-known",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "");
      files = buildWellKnownFiles(env, (message) =>
        config.logger.info(`[well-known] ${message}`),
      );
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const file = files.find((f) => `/${f.fileName}` === path);
        if (!file) return next();
        res.setHeader("Content-Type", "application/json");
        res.end(file.source);
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: file.fileName, source: file.source });
      }
    },
  };
}
