import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RentalTimeline, RentalTimelineExtension } from "@/types/drop";
import { formatDuration, formatIstDateTime, formatIstTime, inr } from "./dropFormat";

interface RentalTimelineCardProps {
  timeline: RentalTimeline;
  /**
   * What the late figures are measured to: "live" = now (no drop bill yet — an
   * estimate), "billed" = the return time frozen on the drop bill, "returned" =
   * the actual return time of a completed drop.
   */
  lateBasis: "live" | "billed" | "returned";
  /**
   * Point out an unsettled extension — it blocks computing the drop bill
   * ("drop-bill") or completing a return on a branch without one ("complete").
   */
  extensionHint?: "drop-bill" | "complete" | null;
  className?: string;
}

function ExtensionTags({ ext }: { ext: RentalTimelineExtension }) {
  return (
    <>
      {ext.unpaid && (
        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-semibold uppercase text-red-700">
          Unpaid
        </span>
      )}
      {ext.awaitingConfirmation && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase text-amber-800">
          Awaiting manager
        </span>
      )}
      {ext.isPartial && (
        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px text-[10px] font-semibold uppercase text-gray-600">
          Partial
        </span>
      )}
    </>
  );
}

/** Grace / charge note for the late-return row (server figures only). */
function lateNote(timeline: RentalTimeline): string | null {
  const status = timeline.lateChargePreview?.status;
  const grace = timeline.graceMinutes;
  if (status === "WITHIN_GRACE") return `Within the ${grace}-min grace — not charged`;
  if (timeline.graceApplied && grace > 0) return `Includes ${grace} min grace, not charged`;
  if (timeline.gracePolicyEnabled && timeline.graceType === "MANUAL" && grace > 0) {
    return `${grace}-min grace not applied`;
  }
  if (!timeline.gracePolicyEnabled) return "No grace period at this branch";
  return null;
}

/**
 * "Rental time" block on the drop screen: the booked window as originally agreed,
 * time added by formal extensions, any late return beyond the current end, and the
 * total — all from the server's rentalTimeline (whole minutes, never rounded).
 */
export function RentalTimelineCard({ timeline, lateBasis, extensionHint, className }: RentalTimelineCardProps) {
  const extended = timeline.extendedMinutes > 0;
  const late = timeline.lateMinutes > 0;
  const blocking = !!extensionHint && timeline.extensions.some((e) => e.unpaid || e.awaitingConfirmation);

  const lateAsOf = timeline.returnedAt
    ? lateBasis === "live"
      ? `as of ${formatIstTime(timeline.returnedAt)}`
      : `returned ${formatIstDateTime(timeline.returnedAt)}`
    : null;
  const note = late ? lateNote(timeline) : null;

  return (
    <div className={cn("rounded-lg border border-gray-200 bg-white px-4 py-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Rental time
        </span>
        <span className="text-[11px] text-muted-foreground">
          {formatIstDateTime(timeline.startAt)} → {formatIstDateTime(timeline.currentEndAt)}
        </span>
      </div>

      {!extended && !late ? (
        <p className="mt-1.5 text-sm text-gray-800">
          Rental length: <span className="font-semibold">{formatDuration(timeline.totalMinutes)}</span>
          <span className="text-muted-foreground"> · Not extended</span>
        </p>
      ) : (
        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-600">
              {extended ? "Original rental" : "Rental length"}
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {extended ? `until ${formatIstDateTime(timeline.originalEndAt)}` : "Not extended"}
              </span>
            </dt>
            <dd className="font-medium text-gray-900 shrink-0">{formatDuration(timeline.originalMinutes)}</dd>
          </div>

          {extended && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-gray-600">
                  Extended
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {timeline.extensionCount} {timeline.extensionCount === 1 ? "extension" : "extensions"}
                  </span>
                </dt>
                <dd className="font-medium text-orange-700 shrink-0">+{formatDuration(timeline.extendedMinutes)}</dd>
              </div>
              {timeline.extensions.length > 0 && (
                <ul className="mt-1 space-y-1 border-l-2 border-orange-100 pl-3">
                  {timeline.extensions.map((ext) => (
                    <li key={ext.publicId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600">
                      <span>
                        {formatIstDateTime(ext.oldEndAt)} → {formatIstDateTime(ext.newEndAt)}
                      </span>
                      <span className="font-medium text-gray-800">+{formatDuration(ext.minutes)}</span>
                      <span className="text-muted-foreground">{inr(ext.additionalAmount)} incl. GST</span>
                      {ext.freeKm && (
                        <span className="text-muted-foreground" title={ext.freeKm.label}>
                          {ext.freeKm.km > 0 ? `+${ext.freeKm.km.toLocaleString("en-IN")} free km` : "no extra free km"}
                        </span>
                      )}
                      <ExtensionTags ext={ext} />
                    </li>
                  ))}
                </ul>
              )}
              {timeline.extensionFreeKmTotal != null && timeline.extensions.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Free km added by extensions:{" "}
                  <span className="font-medium text-gray-800">
                    +{timeline.extensionFreeKmTotal.toLocaleString("en-IN")} km
                  </span>{" "}
                  · whole days and 12-hour blocks only — extra hours add none
                </p>
              )}
            </div>
          )}

          {late && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-600">
                Late return
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {[`due ${formatIstDateTime(timeline.currentEndAt)}`, lateAsOf, note].filter(Boolean).join(" · ")}
                </span>
              </dt>
              <dd className="font-medium text-red-700 shrink-0">+{formatDuration(timeline.lateMinutes)}</dd>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
            <dt className="font-semibold text-gray-900">
              Total
              {late && lateBasis === "live" && (
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">so far</span>
              )}
            </dt>
            <dd className="font-semibold text-gray-900 shrink-0">
              {formatDuration(late ? timeline.totalWithLateMinutes : timeline.totalMinutes)}
            </dd>
          </div>
        </dl>
      )}

      {blocking && (
        <p className="mt-2 text-xs text-amber-700">
          An extension isn't settled yet — collect it (or have the branch manager confirm the cash) before
          {extensionHint === "complete" ? " completing the return." : " computing the drop bill."}
        </p>
      )}
    </div>
  );
}
