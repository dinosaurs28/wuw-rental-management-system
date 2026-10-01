// Cash shift helpers shared by the Fleet shift screens (#22): money, IST dates
// and status labels.
import type { BadgeTone } from '../components/ui/StatusBadge';
import type {
  ActiveShift,
  ShiftStatus,
  ShiftTransactionPurpose,
  ShiftTransactionStatus,
} from '../types/shift';

// The server caps the opening float at ₹10,00,000.
export const MAX_OPENING_CASH = 1_000_000;

// Decimal strings → number; null/blank/garbage → null.
export function money(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const paise = (v: number) => Math.round(v * 100);

// Cash is reconciled to the paisa, so amounts show two decimals: ₹1,850.00.
export const inr2 = (v: number) =>
  `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Money string → "₹1,850.00", or "—" when there is no figure (e.g. closing
// cash and variance of an OPEN shift — never shown as ₹0.00).
export const inrOrDash = (v: string | number | null | undefined) => {
  const n = money(v);
  return n == null ? '—' : inr2(n);
};

// Variance with its sign: "+₹50.00" over, "−₹50.00" short, "₹0.00" exact.
export function signedInr(v: number): string {
  if (paise(v) === 0) return inr2(0);
  return `${v > 0 ? '+' : '−'}${inr2(Math.abs(v))}`;
}

// Digits with at most one decimal point and two decimals (paise).
export function sanitizeAmount(t: string): string {
  const [whole, ...rest] = t.replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

// Expected in drawer for the active shift. Servers older than #22 only sent
// expectedTotal (manager-confirmed cash); newer ones keep it equal to expectedClosing.
export function activeExpected(s: ActiveShift | null | undefined): number | null {
  if (!s) return null;
  return money(s.expectedClosing ?? s.expectedTotal);
}

export function activePending(s: ActiveShift | null | undefined): number {
  if (!s) return 0;
  return money(s.pendingCash ?? s.pendingTotal) ?? 0;
}

// ── IST dates ───────────────────────────────────────────────────────────────
// Business days are IST (UTC+5:30, no DST). Shifts belong to the IST date they
// opened on, so filters are IST YYYY-MM-DD whatever zone the device is set to.

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A Date shifted so its UTC fields read as IST wall-clock time.
const asIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

export function istYmd(d: Date = new Date()): string {
  const ist = asIst(d);
  return `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())}`;
}

export function istDaysAgo(days: number, now: Date = new Date()): string {
  return istYmd(new Date(now.getTime() - days * DAY_MS));
}

// "Wed, 1 Oct" for an IST YYYY-MM-DD (year added when it isn't this year).
export function istDayLabel(ymd: string, now: Date = new Date()): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sameYear = y === asIst(now).getUTCFullYear();
  return `${WEEKDAYS[dt.getUTCDay()]}, ${d} ${MONTHS[m - 1]}${sameYear ? '' : ` ${y}`}`;
}

// "9:05 AM" in IST.
export function istTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const ist = asIst(d);
  const h = ist.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(ist.getUTCMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

// "1 Oct, 9:05 AM" in IST (year added when it isn't this year).
export function istDateTime(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const ist = asIst(d);
  const y = ist.getUTCFullYear();
  const day = `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}${y === asIst(now).getUTCFullYear() ? '' : ` ${y}`}`;
  return `${day}, ${istTime(iso)}`;
}

export type ShiftRangePreset = 'today' | 'yesterday' | 'last7' | 'last30';

export const SHIFT_RANGE_PRESETS: Array<{ key: ShiftRangePreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
];

// Query params for a preset, as IST calendar dates (inclusive).
export function presetRange(
  preset: ShiftRangePreset,
  now: Date = new Date(),
): { date?: string; from?: string; to?: string } {
  switch (preset) {
    case 'today':
      return { date: istYmd(now) };
    case 'yesterday':
      return { date: istDaysAgo(1, now) };
    case 'last7':
      return { from: istDaysAgo(6, now), to: istYmd(now) };
    case 'last30':
      return { from: istDaysAgo(29, now), to: istYmd(now) };
  }
}

// ── Labels ──────────────────────────────────────────────────────────────────

export function shiftStatusBadge(s: { status: ShiftStatus | string; reconciledAt?: string | null }): {
  label: string;
  tone: BadgeTone;
} {
  if (s.status === 'OPEN') return { label: 'Open', tone: 'info' };
  if (s.status === 'DISCREPANCY_FLAGGED') return { label: 'Flagged', tone: 'warn' };
  if (s.reconciledAt) return { label: 'Reconciled', tone: 'good' };
  return { label: 'Closed', tone: 'neutral' };
}

export const PURPOSE_LABEL: Record<ShiftTransactionPurpose, string> = {
  ADVANCE: 'Advance',
  REMAINING_BALANCE: 'Balance payment',
  FULL_PAYMENT: 'Full payment',
  EXTENSION: 'Extension',
  DAMAGE_FEE: 'Damage fee',
  SAFETY_DEPOSIT: 'Safety deposit',
  OVERPAYMENT_REFUND: 'Refund',
  CANCELLATION_REFUND: 'Cancellation refund',
};

export const TXN_STATUS_BADGE: Record<ShiftTransactionStatus, { label: string; tone: BadgeTone }> = {
  INITIATED: { label: 'Initiated', tone: 'neutral' },
  COLLECTED: { label: 'Pending', tone: 'warn' },
  CONFIRMED: { label: 'Confirmed', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  FAILED: { label: 'Failed', tone: 'bad' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
};
