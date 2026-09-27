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

// ── Booking pickup / return times ───────────────────────────────────────────
// Times are "HH:mm" (24h) values in device-local time (IST) with 12-hour
// labels. Every booking screen builds its time lists and defaults from here.

export interface TimeSlot {
  value: string; // "HH:mm"
  label: string; // "6:05 PM"
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "HH:mm" of a Date.
export function timeOf(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// The calendar day of `date` at an "HH:mm" time.
export function withTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0, 0, 0);
}

// "18:05" → "6:05 PM".
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

const slot = (value: string): TimeSlot => ({ value, label: timeLabel(value) });

// The regular 30-minute grid, 12:00 AM … 11:30 PM.
export const GRID_SLOTS: TimeSlot[] = Array.from({ length: 48 }, (_, i) =>
  slot(`${pad2(Math.floor(i / 2))}:${i % 2 === 0 ? '00' : '30'}`),
);

// First 5-minute mark strictly after `now`: 18:00 → 18:05, 18:02 → 18:05,
// 18:05 → 18:10. Past 23:55 it rolls to 00:00 the next day.
export function nextFiveMinuteMark(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  d.setMinutes(d.getMinutes() + 5 - (d.getMinutes() % 5));
  return d;
}

// Time choices for `date`. Today: the next 5-minute mark, then the 30-minute
// grid after it (past times hidden). Later days: the full grid. `after` keeps
// only times strictly later than it (a same-day return after the pickup).
export function timeSlotsFor(date: Date, opts: { after?: Date; now?: Date } = {}): TimeSlot[] {
  const now = opts.now ?? new Date();
  let slots: TimeSlot[];
  if (isSameDay(date, now)) {
    const first = nextFiveMinuteMark(now);
    const firstValue = timeOf(first);
    slots = isSameDay(first, now) ? [slot(firstValue), ...GRID_SLOTS.filter((s) => s.value > firstValue)] : [];
  } else {
    slots = date.getTime() < now.getTime() ? [] : GRID_SLOTS;
  }
  const after = opts.after;
  return after ? slots.filter((s) => withTime(date, s.value).getTime() > after.getTime()) : slots;
}

// Adds the current value to a slot list when it is still a valid choice but
// off the grid (e.g. a 6:05 PM pickup carried over to another day).
export function withSelectedSlot(slots: TimeSlot[], value: string): TimeSlot[] {
  if (!slots.length || value < slots[0].value || slots.some((s) => s.value === value)) return slots;
  return [...slots, slot(value)].sort((a, b) => a.value.localeCompare(b.value));
}

// Auto-bumped return for a pickup: the first slot at or after pickup + 1 hour
// (the minimum billed duration), on whichever day that lands. The return list
// itself still offers every slot after the pickup.
export function firstReturnAfter(pickup: Date, now: Date = new Date()): Date {
  const min = new Date(pickup.getTime() + 3_600_000);
  const nextDay = new Date(min.getFullYear(), min.getMonth(), min.getDate() + 1);
  for (const day of [min, nextDay]) {
    const first = timeSlotsFor(day, { now }).find((s) => withTime(day, s.value).getTime() >= min.getTime());
    if (first) return withTime(day, first.value);
  }
  return min;
}

// Keeps a pickup/return pair bookable: a pickup that is no longer in the
// future (screen left open) moves to the next 5-minute mark, and a return at
// or before the pickup moves to the first slot at least an hour after it.
export function normalizeRange(pickup: Date, ret: Date, now: Date = new Date()): { start: Date; end: Date } {
  const start = pickup.getTime() > now.getTime() ? pickup : nextFiveMinuteMark(now);
  const end = ret.getTime() > start.getTime() ? ret : firstReturnAfter(start, now);
  return { start, end };
}

// normalizeRange as a state updater: hands back the same object when nothing
// had to move, so a periodic freshness check doesn't re-render the screen.
export function refreshRange(r: { start: Date; end: Date }, now: Date = new Date()): { start: Date; end: Date } {
  const next = normalizeRange(r.start, r.end, now);
  return next.start === r.start && next.end === r.end ? r : next;
}

// Opening range for a booking screen: incoming ISO values when valid, else
// pickup today at the next 5-minute mark and return 24 hours later.
export function initialRange(startIso?: string | null, endIso?: string | null, now: Date = new Date()) {
  const parse = (iso?: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  };
  const start = parse(startIso) ?? nextFiveMinuteMark(now);
  const end = parse(endIso) ?? new Date(start.getTime() + 86_400_000);
  return normalizeRange(start, end, now);
}

// Rental length wording shared by the booking screens: "3 hours" under a day,
// otherwise days rounded up ("1 day", "2 days").
export function rentalLengthLabel(hours: number): string | null {
  const h = Math.ceil(hours);
  if (!(h >= 1)) return null;
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''}`;
  const days = Math.ceil(h / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

export function rangeLengthLabel(start: Date, end: Date): string | null {
  return rentalLengthLabel((end.getTime() - start.getTime()) / 3_600_000);
}
