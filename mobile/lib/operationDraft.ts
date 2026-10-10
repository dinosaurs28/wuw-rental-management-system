// Paused pickup / drop (client item 2): what a Fleet Executive entered on a
// pickup or drop that isn't finished, saved on the server so it can be left
// and continued later, on any phone. Completing the pickup / drop deletes it.
// The form fields (`data`) are the app's own — versioned by schemaVersion —
// and photos travel as file ids; the server returns their current URLs.
import type { CapturedPhoto } from '../components/employee/PhotoCaptureSection';
import type { ProofShot } from './counterPayment';

export type OperationDraftType = 'PICKUP' | 'RETURN';
// URL segment of the draft endpoints: /api/employee/{pickup|return}/:bookingId/draft
export type OperationDraftKind = 'pickup' | 'return';

export const draftKindOf = (type: OperationDraftType): OperationDraftKind =>
  type === 'PICKUP' ? 'pickup' : 'return';

export interface OperationDraftPhoto {
  fileId: string;
  label: string | null;
  url: string;
  mime: string;
}

export interface OperationDraftMeta {
  publicId: string;
  type: OperationDraftType;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: { name: string } | null;
}

export interface OperationDraft extends OperationDraftMeta {
  schemaVersion: number;
  data: Record<string, unknown>;
  photos: OperationDraftPhoto[];
}

export interface SaveOperationDraftBody {
  schemaVersion: number;
  data: Record<string, unknown>;
  photos?: Array<{ fileId: string; label?: string | null }>;
  // The version this save builds on (0 = none known); a newer one on the server → 409 DRAFT_CONFLICT.
  baseVersion?: number;
  // This screen session's id: a newer version saved by the same writer (a lost response) isn't a conflict.
  writerId?: string;
}

// `draft` on queue / recovery rows — absent on older servers, null when none.
export interface OperationDraftSummary {
  type: OperationDraftType;
  updatedAt: string;
  updatedByName: string | null;
}

// Rows of GET /api/employee/operation-drafts.
export interface PausedOperation {
  publicId: string;
  type: OperationDraftType;
  updatedAt: string;
  updatedByName: string | null;
  booking: {
    publicId: string;
    startAt: string;
    endAt: string;
    status: string;
    customer: { user: { name: string; phone: string | null } };
    items: Array<{ vehicle: { make: string; model: string; regNo: string } }>;
  };
}

export const toDraftPhotos = (photos: CapturedPhoto[]): SaveOperationDraftBody['photos'] =>
  photos.map((p) => ({ fileId: p.fileId, label: p.label ?? null }));

export const fromDraftPhotos = (photos: OperationDraftPhoto[] | undefined): CapturedPhoto[] =>
  (photos ?? []).map((p) => (p.label ? { fileId: p.fileId, url: p.url, label: p.label } : { fileId: p.fileId, url: p.url }));

// The payment / refund proof photo to keep with the draft: the uploaded one, or
// the one still being brought back after a resume. Payments only link a proof
// when they're recorded, so it would be lost otherwise.
export function proofDraftId(proof: { shot: ProofShot | null; restoringId: string | null }): string | null {
  if (proof.shot) return proof.shot.status === 'ready' ? proof.shot.proof.proofFileId : null;
  return proof.restoringId;
}

// ── Reading the stored fields back (never trust their shape) ────────────────

export const draftString = (data: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof data[key] === 'string' ? (data[key] as string) : fallback;

export const draftBool = (data: Record<string, unknown>, key: string, fallback = false): boolean =>
  typeof data[key] === 'boolean' ? (data[key] as boolean) : fallback;

export const draftNumber = (data: Record<string, unknown>, key: string): number | null =>
  typeof data[key] === 'number' && Number.isFinite(data[key]) ? (data[key] as number) : null;

export function draftOneOf<T extends string>(
  data: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const v = data[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

// "10:42 am" today, "9 Oct, 10:42 am" otherwise.
export function savedAtLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}

// "Paused · 10:42 am by Ravi" (queue cards / paused list).
export function pausedLabel(summary: { updatedAt: string; updatedByName: string | null }): string {
  const when = savedAtLabel(summary.updatedAt);
  return `Paused${when ? ` · ${when}` : ''}${summary.updatedByName ? ` by ${summary.updatedByName}` : ''}`;
}
