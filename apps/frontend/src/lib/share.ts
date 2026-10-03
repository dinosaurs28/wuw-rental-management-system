import { toast } from "sonner";
import { SHARE_LINK_ORIGIN, buildVehicleShareMessage } from "@repo/schemas";

// Share links (#16) are https://whatuwantrentals.com/app/vehicle/<id>, where
// <id> is the group key the public listing returns (group page) or the vehicle
// publicId (single vehicle). Origin + path only: no dates, no auth params, so
// nothing private leaks. They always point at the live site so Android App
// Links / iOS Universal Links can open the app; only local development keeps
// its own origin so the /app/vehicle/:id hand-off can be tried end to end.
function shareOrigin(): string {
  const { hostname, origin } = window.location;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)
    ? origin
    : SHARE_LINK_ORIGIN;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shares "Check out this vehicle I found! You can view the details and book it
 * here: <link>" through the device share sheet, or copies that message when
 * the browser has no share sheet. Never a bare link.
 */
export async function shareVehicle(id: string, title: string): Promise<void> {
  const message = buildVehicleShareMessage(id, shareOrigin());
  if (typeof navigator.share === "function") {
    try {
      // The message already ends with the link: passing `url` as well makes
      // most apps (WhatsApp, Messages) paste the link twice.
      await navigator.share({ title, text: message });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // any other failure: fall back to copying the message
    }
  }
  if (await copyToClipboard(message)) {
    toast.success("Share message copied", {
      description: "Paste it into any chat to share this vehicle.",
    });
  } else {
    toast.error("Could not copy the link", { description: message });
  }
}
