// Client TODO 11 (Nov 12 2026): free back / forward navigation in the Pickup and
// Return flows. Pure helpers (no React) — the step list, which steps can be
// entered, what changed since the server last saw the handover / drop inputs,
// and how a recomputed drop bill compares with the one before.
//
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/flowSteps.test.ts

export interface FlowStep<K extends string = string> {
  key: K;
  label: string;
}

/** Per step: the first thing still missing on it (null = complete). */
export type StepBlockers<K extends string = string> = Partial<Record<K, string | null | undefined>>;

export type StepState = 'done' | 'current' | 'open' | 'locked';

// ── Pickup ──────────────────────────────────────────────────────────────────
export type PickupStepKey = 'booking' | 'readings' | 'photos' | 'licence' | 'payment';

/** The pickup's steps: the bill is a step of its own with payment sessions. */
export function pickupSteps(sessionMode: boolean): FlowStep<PickupStepKey>[] {
  const steps: FlowStep<PickupStepKey>[] = [
    { key: 'booking', label: 'Booking' },
    { key: 'readings', label: 'Readings' },
    { key: 'photos', label: 'Photos' },
    { key: 'licence', label: sessionMode ? 'Licence' : 'Confirm' },
  ];
  if (sessionMode) steps.push({ key: 'payment', label: 'Payment' });
  return steps;
}

// ── Return ──────────────────────────────────────────────────────────────────
export type ReturnStepKey = 'booking' | 'photos' | 'readings' | 'charges' | 'bill';

/** The drop's steps: the computed bill is a step of its own with payment sessions. */
export function returnSteps(sessionMode: boolean): FlowStep<ReturnStepKey>[] {
  const steps: FlowStep<ReturnStepKey>[] = [
    { key: 'booking', label: 'Booking' },
    { key: 'photos', label: 'Photos' },
    { key: 'readings', label: 'Readings' },
    { key: 'charges', label: sessionMode ? 'Condition' : 'Confirm' },
  ];
  if (sessionMode) steps.push({ key: 'bill', label: 'Bill' });
  return steps;
}

// ── Navigation ──────────────────────────────────────────────────────────────
export function stepIndex<K extends string>(steps: FlowStep<K>[], key: K | string | null | undefined): number {
  return key == null ? -1 : steps.findIndex((s) => s.key === key);
}

export function isStepKey<K extends string>(steps: FlowStep<K>[], key: unknown): key is K {
  return typeof key === 'string' && steps.some((s) => s.key === key);
}

export function prevStep<K extends string>(steps: FlowStep<K>[], current: K): K | null {
  const i = stepIndex(steps, current);
  return i > 0 ? steps[i - 1]!.key : null;
}

export function nextStep<K extends string>(steps: FlowStep<K>[], current: K): K | null {
  const i = stepIndex(steps, current);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1]!.key : null;
}

/** The first step BEFORE `target` that still has something missing, with its message. */
export function firstBlockedBefore<K extends string>(
  steps: FlowStep<K>[],
  blockers: StepBlockers<K>,
  target: K,
): { key: K; message: string } | null {
  const end = stepIndex(steps, target);
  for (let i = 0; i < end; i += 1) {
    const key = steps[i]!.key;
    const message = blockers[key];
    if (message) return { key, message };
  }
  return null;
}

/**
 * Where a tap on the stepper (or Next) to `target` lands: any step up to the
 * furthest one reached is open (going back never needs anything); a step
 * further on only once every step before it is complete — otherwise the first
 * incomplete one, so the FE sees what's missing.
 */
export function resolveJump<K extends string>(
  steps: FlowStep<K>[],
  blockers: StepBlockers<K>,
  current: K,
  target: K,
): { to: K; blockedBy: string | null } {
  const ti = stepIndex(steps, target);
  if (ti < 0) return { to: current, blockedBy: null };
  if (ti <= stepIndex(steps, current)) return { to: target, blockedBy: null };
  const blocked = firstBlockedBefore(steps, blockers, target);
  if (!blocked) return { to: target, blockedBy: null };
  return { to: blocked.key, blockedBy: blocked.message };
}

/** How each stepper chip looks: done (reached and complete), current, open (reachable) or locked. */
export function stepStates<K extends string>(
  steps: FlowStep<K>[],
  blockers: StepBlockers<K>,
  current: K,
  maxReached: number,
): StepState[] {
  const ci = stepIndex(steps, current);
  return steps.map((s, i) => {
    if (i === ci) return 'current';
    if (i <= maxReached && !blockers[s.key]) return 'done';
    if (i <= maxReached) return 'open';
    return firstBlockedBefore(steps, blockers, s.key) ? 'locked' : 'open';
  });
}

/**
 * A saved step (from a paused draft) or one picked before the step list
 * changed, made valid for the current list: unknown → the first step.
 */
export function clampStep<K extends string>(steps: FlowStep<K>[], key: unknown, fallback?: K): K {
  if (isStepKey(steps, key)) return key;
  if (fallback && isStepKey(steps, fallback)) return fallback;
  return steps[0]!.key;
}

// ── What the server holds vs. the screen ────────────────────────────────────
export interface PhotoRef {
  fileId: string;
  label?: string | null;
}

export interface HandoverSnapshot {
  odo: string;
  fuelLevel: number | null;
  fastagBalance: string;
  photos: PhotoRef[];
  dlStatus: string | null;
  note: string;
}

export type HandoverField = 'odo' | 'fuelLevel' | 'fastagBalance' | 'photos' | 'dlStatus' | 'note';

const trimMoney = (s: string) => {
  const t = s.trim();
  if (!t) return '';
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : t;
};

/** Same photos, same order, same labels. */
export function samePhotoList(a: PhotoRef[], b: PhotoRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.fileId === b[i]!.fileId && (p.label ?? null) === (b[i]!.label ?? null));
}

/**
 * The handover fields changed since the server last saved them (the pickup
 * session's initiate, or the last handover update). Nothing saved yet = all.
 */
export function handoverChanges(saved: HandoverSnapshot | null, now: HandoverSnapshot): HandoverField[] {
  if (!saved) return ['odo', 'fuelLevel', 'fastagBalance', 'photos', 'dlStatus', 'note'];
  const out: HandoverField[] = [];
  if (saved.odo.trim() !== now.odo.trim()) out.push('odo');
  if (saved.fuelLevel !== now.fuelLevel) out.push('fuelLevel');
  if (trimMoney(saved.fastagBalance) !== trimMoney(now.fastagBalance)) out.push('fastagBalance');
  if (!samePhotoList(saved.photos, now.photos)) out.push('photos');
  // A licence choice can be changed, never cleared (the server keeps the last one)
  if (now.dlStatus != null && saved.dlStatus !== now.dlStatus) out.push('dlStatus');
  if (saved.note.trim() !== now.note.trim()) out.push('note');
  return out;
}

/**
 * Photos as the screen should show them on a revisit: the list on screen wins
 * (staff removed / retook there); photos known only to the server (another
 * phone, a restore that hasn't landed yet) are added after, never twice.
 */
export function mergePhotoLists<P extends PhotoRef>(screen: P[], server: P[], removedHere: Set<string> = new Set()): P[] {
  const seen = new Set(screen.map((p) => p.fileId));
  const extra = server.filter((p) => !seen.has(p.fileId) && !removedHere.has(p.fileId));
  return extra.length ? [...screen, ...extra] : screen;
}

/** A stable signature of a request body (key order doesn't matter). */
export function bodySignature(body: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = norm((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(norm(body));
}

/**
 * Entering the bill step: recompute when the inputs changed since the bill on
 * screen was computed (or there is none). A bill restored from the server with
 * no signature yet is kept until the FE changes something (`baseline` = the
 * inputs when they left the bill).
 */
export function needsRecompute(opts: {
  hasBill: boolean;
  billStale: boolean;
  computedSig: string | null;
  currentSig: string;
}): boolean {
  if (!opts.hasBill || opts.billStale) return true;
  if (opts.computedSig == null) return false;
  return opts.computedSig !== opts.currentSig;
}

const inrText = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const netText = (n: number) => (n > 0 ? `${inrText(n)} to collect` : n < 0 ? `${inrText(n)} to refund` : 'nothing due');

/**
 * After a recompute: what changed for the customer, said plainly. Payments
 * already recorded aren't part of the bill's balance and stay as they are.
 */
export function billChangeNotice(prevNet: number | null, nextNet: number): string | null {
  if (prevNet == null) return null;
  const a = Math.round(prevNet * 100) / 100;
  const b = Math.round(nextNet * 100) / 100;
  if (a === b) return null;
  return `Bill updated after your changes: was ${netText(a)}, now ${netText(b)}.`;
}
