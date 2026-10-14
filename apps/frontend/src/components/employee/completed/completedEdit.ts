import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import {
  completedOperationService,
  type AdjustmentPlan,
  type EditOperationResponse,
  type EditPreview,
  type EditReturnBody,
  type PickupSummary,
  type ReturnSummary,
  type ReturnSummaryDamage,
} from "@/services/completedOperation.service";
import type { EditablePhoto } from "@/components/employee/completed/PhotoEditor";

/**
 * Completed pickups / returns (client item 1): what the summary and the workflow
 * pages' edit mode share — the summary query, the review → save of an edit,
 * photo / money helpers and the drop-damage drafts.
 */

type Phase = "PICKUP" | "RETURN";
type Summary = PickupSummary | ReturnSummary;

const inr = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (x: unknown) => Number(x ?? 0) || 0;

export const SEVERITIES = ["Minor", "Moderate", "Severe"] as const;

export const summaryKey = (phase: Phase, bookingId: string) => ["employee-completed-summary", phase, bookingId];

export function useSummary(phase: Phase, bookingId: string, enabled = true) {
  return useQuery<Summary>({
    queryKey: summaryKey(phase, bookingId),
    queryFn: () =>
      phase === "PICKUP"
        ? completedOperationService.getPickupSummary(bookingId)
        : completedOperationService.getReturnSummary(bookingId),
    enabled: enabled && !!bookingId,
    retry: false,
  });
}

export function errorMessage(error: unknown, fallback: string): string {
  return isAxiosError<{ message?: string }>(error) ? error.response?.data?.message ?? fallback : fallback;
}

// ── Money difference of an edit ──────────────────────────────────────────────

/** What happens to the money, in one line. */
export function adjustmentOutcome(plan: AdjustmentPlan): string {
  const amount = num(plan.amount);
  if (plan.action === "NONE") return "No change in money";
  if (plan.settledBy === "BRANCH_MANAGER") {
    return plan.action === "COLLECT"
      ? `${inr(amount)} more — the branch manager collects it in Settlements`
      : `${inr(amount)} less — the branch manager takes it off what's due, or refunds it in Settlements if it was already paid`;
  }
  return plan.action === "COLLECT" ? `Collect ${inr(amount)} more` : `Refund ${inr(amount)}`;
}

/** A saved edit: its new summary and the difference to settle (if any). */
export type Saved<T> = { next: T; adjustment: EditOperationResponse<T>["adjustment"] };

/**
 * Review → save of an edit form: `open` previews the body's money difference;
 * `confirm` saves that same body with the previewed difference as expectedDelta
 * (required when money moves; 409 EDIT_DELTA_CHANGED / EDIT_CONFIRMATION_REQUIRED
 * → preview again). Errors that belong to the form (a bad reading) go back to it.
 */
export function useReviewedSave<B extends object, T>(opts: {
  preview: (body: B) => Promise<EditPreview>;
  save: (body: B & { expectedDelta: number }) => Promise<EditOperationResponse<T>>;
  onFormError: (error: unknown) => void;
  onSaved: (saved: Saved<T>) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<B | null>(null);

  const load = async (body: B) => {
    setPreview(null);
    try {
      setPreview(await opts.preview(body));
    } catch (err) {
      setReviewing(false);
      opts.onFormError(err);
    }
  };

  const open = (body: B) => {
    bodyRef.current = body;
    setError(null);
    setReviewing(true);
    void load(body);
  };

  const confirm = async () => {
    const body = bodyRef.current;
    if (!body || !preview || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await opts.save({ ...body, expectedDelta: num(preview.adjustment.delta) });
      opts.onSaved({ next: res.data, adjustment: res.adjustment ?? null });
    } catch (err) {
      const data = isAxiosError<{ code?: string; field?: string }>(err) ? err.response?.data : undefined;
      if (data?.code === "EDIT_DELTA_CHANGED" || data?.code === "EDIT_CONFIRMATION_REQUIRED") {
        setError(errorMessage(err, "The money difference changed. Check it and save again."));
        void load(body);
      } else if (data?.field) {
        setReviewing(false);
        opts.onFormError(err);
      } else {
        setError(errorMessage(err, "Couldn't save the changes. Try again."));
      }
    } finally {
      setSaving(false);
    }
  };

  return { reviewing, preview, error, saving, open, confirm, back: () => setReviewing(false) };
}

// ── Photos and money typed into an edit ──────────────────────────────────────

export const photosOf = (photos: { fileId: string; url: string; label?: string | null }[]): EditablePhoto[] =>
  photos.map((p) => ({ fileId: p.fileId, url: p.url, label: p.label ?? null }));

/** Files added / taken off compared with what was saved. */
export function photoDiff(before: EditablePhoto[], after: EditablePhoto[]) {
  const had = new Set(before.map((p) => p.fileId));
  const has = new Set(after.map((p) => p.fileId));
  return {
    removed: before.filter((p) => !has.has(p.fileId)).map((p) => p.fileId),
    added: after.filter((p) => !had.has(p.fileId)),
  };
}

/**
 * Photos uploaded during an edit: the ones dropped before saving — or all of
 * them when the edit is closed unsaved — are deleted when the form closes.
 * Photos already saved with the booking are never deleted from here.
 */
export function useEditUploads(remove: (fileId: string) => Promise<unknown>) {
  const uploaded = useRef(new Set<string>());
  const kept = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const fileId of uploaded.current) {
        if (!kept.current.has(fileId)) remove(fileId).catch(() => {});
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return {
    track: (upload: (form: FormData) => Promise<{ fileId: string; url: string }>) => async (form: FormData) => {
      const result = await upload(form);
      uploaded.current.add(result.fileId);
      return result;
    },
    keep: (fileIds: string[]) => {
      kept.current = new Set(fileIds);
    },
  };
}

/** ₹ typed into a money field: up to 2 decimals. */
export const isMoneyInput = (v: string) => /^\d{1,7}(\.\d{1,2})?$/.test(v.trim());

export const moneyText = (v: string | null | undefined) => (num(v) > 0 ? String(num(v)) : "");
export const sameMoney = (a: string | number | null | undefined, b: string | number | null | undefined) =>
  Math.round(num(a) * 100) === Math.round(num(b) * 100);
/** What the customer pays for a drop damage now (the edited amount, else the recorded one). */
export const damageAmountIn = (editState: ReturnSummary["editState"], d: ReturnSummaryDamage) =>
  editState?.damages.find((x) => x.publicId === d.publicId)?.amount ?? d.amount;

export const damageBilling = (d: ReturnSummaryDamage) =>
  !d.chargeCustomer ? "Company expense" : d.billedAtDrop ? "Charged on the drop bill" : "Charged by the branch manager";

// ── Damage recorded at the drop, edited with it ──────────────────────────────

export interface DamageDraft {
  area: string;
  description: string;
  severity: string;
  /** ₹ the customer pays for it (priced damage only) */
  amount: string;
  photos: EditablePhoto[];
}

/** Damage the customer pays (on the drop bill, or charged by the manager) has a cost. */
export const isPricedDamage = (d: ReturnSummaryDamage) => d.billedAtDrop || d.chargeCustomer;

export const damageDraftOf = (editState: ReturnSummary["editState"], d: ReturnSummaryDamage): DamageDraft => ({
  area: d.area,
  description: d.description,
  severity: d.severity,
  amount: String(num(damageAmountIn(editState, d))),
  photos: photosOf(d.photos),
});

/** First problem with an edited damage, or null. */
export function damageDraftProblem(d: ReturnSummaryDamage, draft: DamageDraft): string | null {
  if (!draft.area.trim()) return "Enter the damaged area.";
  if (draft.description.trim().length < 3) return "Describe the damage (at least 3 characters).";
  if (draft.photos.length === 0) return "Keep at least one photo of each damage.";
  if (isPricedDamage(d) && !isMoneyInput(draft.amount)) return "Enter the damage cost in ₹.";
  return null;
}

/** What changed in an editable damage, as Edit Return sends it (null = nothing). */
export function damageEdit(
  editState: ReturnSummary["editState"],
  d: ReturnSummaryDamage,
  draft: DamageDraft,
): NonNullable<EditReturnBody["damages"]>[number] | null {
  const entry: NonNullable<EditReturnBody["damages"]>[number] = { publicId: d.publicId };
  if (draft.area.trim() !== d.area) entry.area = draft.area.trim();
  if (draft.description.trim() !== d.description) entry.description = draft.description.trim();
  if (draft.severity !== d.severity) entry.severity = draft.severity as (typeof SEVERITIES)[number];
  const diff = photoDiff(photosOf(d.photos), draft.photos);
  if (diff.removed.length) entry.removeFileIds = diff.removed;
  if (diff.added.length) entry.addPhotoIds = diff.added.map((p) => p.fileId);
  if (isPricedDamage(d) && isMoneyInput(draft.amount) && !sameMoney(draft.amount, damageAmountIn(editState, d))) {
    entry.amount = Number(draft.amount);
  }
  return Object.keys(entry).length > 1 ? entry : null;
}
