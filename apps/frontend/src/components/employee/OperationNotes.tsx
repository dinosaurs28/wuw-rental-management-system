/**
 * Fleet pickup / drop notes (Oct 20 2026): the optional note the Fleet
 * Executive writes at the pickup and at the drop. `OperationNoteField` is the
 * input; `OperationNotesCard` shows the saved notes (pickup, drop and any
 * mid-rental swap notes) to staff and the branch manager. Never shown to customers.
 */
import { StickyNote } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/formatters";

/** Most characters a note may have (same limit as the server). */
export const OPERATION_NOTE_MAX = 1000;

export interface OperationNoteView {
  note: string;
  writtenBy: string | null;
  writtenAt: string;
  editedBy: string | null;
  editedAt: string | null;
}

export interface SwapNoteView {
  swapPublicId: string;
  swappedAt: string;
  swappedBy: string | null;
  fromRegNo: string;
  toRegNo: string;
  reason: string;
  reasonNotes: string | null;
  originalVehicleNotes: string | null;
}

export interface OperationNotesView {
  pickup: OperationNoteView | null;
  drop: OperationNoteView | null;
  swaps: SwapNoteView[];
}

/** The note as sent: trimmed, blank = null (clears / no note). */
export const noteForRequest = (text: string): string | null => {
  const t = text.trim();
  return t ? t : null;
};

export const hasOperationNotes = (notes: OperationNotesView | null | undefined) =>
  !!notes && (!!notes.pickup || !!notes.drop || notes.swaps.length > 0);

export function OperationNoteField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const length = value.trim().length;
  const tooLong = length > OPERATION_NOTE_MAX;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        maxLength={OPERATION_NOTE_MAX + 200}
        placeholder={placeholder ?? "Anything the branch manager or the next person should know"}
        aria-invalid={tooLong || undefined}
      />
      <p className={cn("text-xs text-right", tooLong ? "text-red-600" : "text-muted-foreground")}>
        {length}/{OPERATION_NOTE_MAX}
      </p>
    </div>
  );
}

function NoteLine({ title, note }: { title: string; note: OperationNoteView }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-amber-900">
        {title} from {note.writtenBy ?? "staff"}, {formatDateTime(note.writtenAt)}
        {note.editedAt ? (
          <span className="font-normal text-amber-800/80">
            {" "}
            · edited{note.editedBy ? ` by ${note.editedBy}` : ""} {formatDateTime(note.editedAt)}
          </span>
        ) : null}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{note.note}</p>
    </div>
  );
}

/**
 * The saved notes. `show` picks which (default all); renders nothing when there
 * are none to show, unless `emptyText` is given.
 */
export function OperationNotesCard({
  notes,
  show = ["pickup", "drop", "swaps"],
  title = "Fleet notes",
  emptyText,
  className,
}: {
  notes: OperationNotesView | null | undefined;
  show?: Array<"pickup" | "drop" | "swaps">;
  title?: string;
  emptyText?: string;
  className?: string;
}) {
  const pickup = show.includes("pickup") ? notes?.pickup ?? null : null;
  const drop = show.includes("drop") ? notes?.drop ?? null : null;
  const swaps = show.includes("swaps") ? notes?.swaps ?? [] : [];
  if (!pickup && !drop && swaps.length === 0) {
    return emptyText ? <p className={cn("text-xs text-muted-foreground", className)}>{emptyText}</p> : null;
  }
  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3", className)}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <StickyNote className="h-4 w-4" />
        {title}
      </p>
      {pickup ? <NoteLine title="Pickup note" note={pickup} /> : null}
      {swaps.map((s) => (
        <div key={s.swapPublicId} className="space-y-1">
          <p className="text-xs font-medium text-amber-900">
            Swap {s.fromRegNo} → {s.toRegNo}
            {s.swappedBy ? ` by ${s.swappedBy}` : ""}, {formatDateTime(s.swappedAt)}
          </p>
          {s.reasonNotes ? <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{s.reasonNotes}</p> : null}
          {s.originalVehicleNotes ? (
            <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
              <span className="text-muted-foreground">{s.fromRegNo} condition: </span>
              {s.originalVehicleNotes}
            </p>
          ) : null}
        </div>
      ))}
      {drop ? <NoteLine title="Drop note" note={drop} /> : null}
    </div>
  );
}
