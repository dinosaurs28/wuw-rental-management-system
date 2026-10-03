import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Smartphone } from "lucide-react";
import {
  VEHICLE_SHARE_PATH_PREFIX,
  buildPlayStoreUrlWithReferrer,
  isValidVehicleLinkId,
  vehicleWebPath,
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
 * link was opened straight in a browser):
 *   desktop  → the website's vehicle page
 *   Android  → record a deferred link → Google Play with referrer=vehicle%3D<id>
 *   iOS      → record a deferred link → the App Store; the website's vehicle
 *              page while there is no App Store listing (VITE_APP_STORE_URL)
 * The store redirect happens whatever the record outcome.
 */
export default function AppVehicleLinkPage() {
  // react-router hands :id over decoded (group keys contain spaces).
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const valid = isValidVehicleLinkId(id);
  const platform = detectLinkPlatform();
  const storeUrl = !valid
    ? null
    : platform === "android"
      ? buildPlayStoreUrlWithReferrer(PLAY_STORE_URL, id)
      : platform === "ios"
        ? APP_STORE_URL
        : null;
  const webPath = valid ? vehicleWebPath(id) : "/vehicles";
  const handledId = useRef<string | null>(null);
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (handledId.current === id) return;
    handledId.current = id;

    if (!valid) {
      toast.error("This vehicle link isn't valid", {
        description: "Here are the vehicles available right now.",
      });
      navigate("/vehicles", { replace: true });
      return;
    }
    if (!platform || !storeUrl) {
      navigate(webPath, { replace: true });
      return;
    }
    void recordDeferredLink(id, platform).then(() => {
      // The visitor may already have chosen the website page meanwhile.
      if (window.location.pathname.startsWith(VEHICLE_SHARE_PATH_PREFIX)) {
        window.location.replace(storeUrl);
        setRedirected(true);
      }
    });
  }, [id, valid, platform, storeUrl, webPath, navigate]);

  if (!platform || !storeUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="size-6 text-zinc-400" />
      </div>
    );
  }

  const isAndroid = platform === "android";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <img src="/logo.png" alt="WUW Rentals" className="h-9 w-auto mx-auto mb-10" />
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-[#FF5F00]/10 text-[#FF5F00]">
          <Smartphone className="size-7" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">
          {isAndroid ? "Opening Google Play" : "Opening the App Store"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">
          Get the WUW Rentals app to view and book this vehicle. Open the app
          once it's installed and it takes you to this vehicle.
        </p>
        <a
          href={storeUrl}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF5F00] px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#E55500]"
        >
          {isAndroid ? "Get it on Google Play" : "Download on the App Store"}
          <ArrowRight className="size-4" />
        </a>
        <Link
          to={webPath}
          replace
          className="mt-3 block w-full rounded-xl border border-zinc-200 bg-white px-5 py-3.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
        >
          View on the website instead
        </Link>
        {redirected ? (
          <p className="mt-6 text-xs text-zinc-400">
            Store didn't open? Use the button above.
          </p>
        ) : (
          <p className="mt-6 inline-flex items-center gap-2 text-xs text-zinc-400">
            <Spinner className="size-3.5" />
            Redirecting…
          </p>
        )}
      </div>
    </div>
  );
}
