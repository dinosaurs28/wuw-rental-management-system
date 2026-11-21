import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRight, Smartphone } from "lucide-react";
import {
  VEHICLE_SHARE_PATH_PREFIX,
  buildPlayStoreUrlWithReferrer,
  isValidVehicleLinkId,
} from "@repo/schemas";
import { Spinner } from "@/components/ui/spinner";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  detectLinkPlatform,
  recordDeferredLink,
} from "@/lib/deepLink";

/**
 * /app/vehicle/:id — where shared vehicle links land (#16). The app opens these
 * links itself when installed, so this page only runs when it is not (or the
 * link was opened straight in a browser). Booking is app-only since Nov 21 2026
 * (the website has no customer pages), so:
 *   Android  → record a deferred link → Google Play with referrer=vehicle%3D<id>
 *   iOS      → record a deferred link → the App Store
 *   desktop / invalid link → both store buttons
 */
export default function AppVehicleLinkPage() {
  // react-router hands :id over decoded (group keys contain spaces).
  const { id = "" } = useParams<{ id: string }>();
  const valid = isValidVehicleLinkId(id);
  const platform = detectLinkPlatform();
  const storeUrl = !valid
    ? null
    : platform === "android"
      ? buildPlayStoreUrlWithReferrer(PLAY_STORE_URL, id)
      : platform === "ios"
        ? APP_STORE_URL
        : null;
  const handledId = useRef<string | null>(null);
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (!valid || !platform || !storeUrl) return;
    if (handledId.current === id) return;
    handledId.current = id;
    void recordDeferredLink(id, platform).then(() => {
      if (window.location.pathname.startsWith(VEHICLE_SHARE_PATH_PREFIX)) {
        window.location.replace(storeUrl);
        setRedirected(true);
      }
    });
  }, [id, valid, platform, storeUrl]);

  const storeButton =
    "mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold transition-colors";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <img src="/logo.png" alt="WUW Rentals" className="h-9 w-auto mx-auto mb-10" />
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-[#FF5F00]/10 text-[#FF5F00]">
          <Smartphone className="size-7" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">
          {storeUrl
            ? platform === "android"
              ? "Opening Google Play"
              : "Opening the App Store"
            : "Book in the WUW Rentals app"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">
          {valid
            ? "Get the WUW Rentals app to view and book this vehicle. Open the app once it's installed and it takes you to this vehicle."
            : "This vehicle link isn't valid. Get the WUW Rentals app to see the vehicles available right now."}
        </p>
        <div className="mt-5">
          {storeUrl ? (
            <a href={storeUrl} className={`${storeButton} bg-[#FF5F00] text-white hover:bg-[#E55500]`}>
              {platform === "android" ? "Get it on Google Play" : "Download on the App Store"}
              <ArrowRight className="size-4" />
            </a>
          ) : (
            <>
              <a
                href={valid ? buildPlayStoreUrlWithReferrer(PLAY_STORE_URL, id) : PLAY_STORE_URL}
                className={`${storeButton} bg-[#FF5F00] text-white hover:bg-[#E55500]`}
              >
                Get it on Google Play <ArrowRight className="size-4" />
              </a>
              {APP_STORE_URL && (
                <a
                  href={APP_STORE_URL}
                  className={`${storeButton} border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-100`}
                >
                  Download on the App Store <ArrowRight className="size-4" />
                </a>
              )}
            </>
          )}
        </div>
        {storeUrl &&
          (redirected ? (
            <p className="mt-6 text-xs text-zinc-400">Store didn't open? Use the button above.</p>
          ) : (
            <p className="mt-6 inline-flex items-center gap-2 text-xs text-zinc-400">
              <Spinner className="size-3.5" />
              Redirecting…
            </p>
          ))}
      </div>
    </div>
  );
}
