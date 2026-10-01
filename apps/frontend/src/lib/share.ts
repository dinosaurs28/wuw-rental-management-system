import { toast } from "sonner";

// Canonical public vehicle URL: origin + path only. No dates, no auth params,
// so the recipient picks their own dates and nothing private leaks.
export function buildVehicleShareUrl(target: {
  groupKey?: string;
  vehicleId?: string;
}): string {
  const origin = window.location.origin;
  if (target.groupKey) {
    return `${origin}/vehicle/group/${encodeURIComponent(target.groupKey)}`;
  }
  return `${origin}/vehicle/${encodeURIComponent(target.vehicleId ?? "")}`;
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

export async function shareVehicle(title: string, url: string): Promise<void> {
  const text = `Check out ${title} at What U Want Rentals`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // any other failure: fall back to copying the link
    }
  }
  if (await copyToClipboard(url)) {
    toast.success("Link copied");
  } else {
    toast.error("Could not copy the link", { description: url });
  }
}
