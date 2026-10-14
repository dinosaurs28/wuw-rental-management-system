import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/deepLink";

/**
 * "Download on the App Store" / "Get it on Google Play" links to the live
 * listings (the same URLs the shared-vehicle links send visitors to).
 * `tone` follows the surface: "dark" for black/dark sections, "light" for
 * white ones.
 */
export function StoreButtons({
  tone = "dark",
  className = "",
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const buttonClass =
    tone === "dark"
      ? "bg-white/5 border-white/15 text-white hover:border-white/40 hover:bg-white/10"
      : "bg-[#1A1A1A] border-[#1A1A1A] text-white hover:bg-black";

  const stores = [
    {
      href: PLAY_STORE_URL,
      label: "Get it on",
      name: "Google Play",
      icon: <GooglePlayIcon />,
    },
    ...(APP_STORE_URL
      ? [{ href: APP_STORE_URL, label: "Download on the", name: "App Store", icon: <AppleIcon /> }]
      : []),
  ];

  return (
    <div className={`flex flex-wrap items-center gap-2.5 sm:gap-3 ${className}`}>
      {stores.map((store) => (
        <a
          key={store.name}
          href={store.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${store.label} ${store.name}`}
          className={`inline-flex items-center gap-2.5 sm:gap-3 rounded-xl border px-3.5 sm:px-4 py-2.5 transition-colors ${buttonClass}`}
        >
          {store.icon}
          <span className="flex flex-col text-left leading-none">
            <span className="text-[10px] font-medium tracking-wide opacity-80">{store.label}</span>
            <span className="mt-1 text-[15px] sm:text-base font-bold tracking-tight">{store.name}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0" fill="currentColor">
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.5ZM14.2 6.15c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23Z" />
    </svg>
  );
}

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0">
      <path fill="#00D7FE" d="M3.6 2.3a1.5 1.5 0 0 0-.4 1.07v17.26c0 .42.15.79.4 1.06l.06.06 9.67-9.67v-.22L3.66 2.24l-.06.06Z" />
      <path fill="#FFCE00" d="m16.55 15.3-3.22-3.22v-.22l3.22-3.22.07.04 3.82 2.17c1.09.62 1.09 1.63 0 2.25l-3.82 2.17-.07.04Z" />
      <path fill="#FF3A44" d="M16.62 15.26 13.33 11.97 3.6 21.69c.36.38.95.43 1.62.05l11.4-6.48" />
      <path fill="#00F076" d="M16.62 8.68 5.22 2.2c-.67-.38-1.26-.33-1.62.05l9.73 9.72 3.29-3.29Z" />
    </svg>
  );
}
