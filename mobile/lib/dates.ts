// Small date helpers for customer screens.

// "Starts in N days" badge — derived client-side (no API field).
// Returns null when the booking is not upcoming (already started / past).
export function startsInLabel(startAt?: string | null): string | null {
  if (!startAt) return null;
  const start = new Date(startAt).getTime();
  if (isNaN(start)) return null;
  const diffMs = start - Date.now();
  if (diffMs <= 0) return null;
  const days = Math.ceil(diffMs / 86_400_000);
  if (days <= 1) return 'Starts in 1 day';
  return `Starts in ${days} days`;
}

// Compact date+time, e.g. "24 Aug 2025 · 10:00 AM".
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Date only, e.g. "24 Aug 2025".
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
