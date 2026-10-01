import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { IdCard, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  DL_COLLECTION_STATUSES,
  DL_DEPOSIT_NOTE_MAX,
  DL_STATUS_LABELS,
  type DlCollectionStatusValue,
} from "@repo/schemas";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/counterErrors";
import { dlChoiceError, dlChoicePayload, dlStatusLabel } from "@/lib/dlStatus";
import { cn } from "@/lib/utils";
import {
  canStaffEditDlStatus,
  dlStatusService,
  type DlStatus,
  type DlStatusRole,
  type DlStatusUpdateResult,
  type UpdateDlStatusBody,
} from "@/services/dlStatus.service";

const OPTION_HELP: Record<DlCollectionStatusValue, string> = {
  COLLECTED: "The branch keeps the original licence until the car is back.",
  NOT_COLLECTED: "The customer keeps their licence.",
  DEPOSIT: "The customer leaves something else instead.",
};

const BADGE_STYLE: Record<DlCollectionStatusValue | "NONE", string> = {
  COLLECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NOT_COLLECTED: "bg-amber-50 text-amber-800 border-amber-200",
  DEPOSIT: "bg-blue-50 text-blue-700 border-blue-200",
  NONE: "bg-gray-50 text-gray-500 border-gray-200",
};

const UPDATE_FAILED_MESSAGE = "Couldn't update the DL status. Please try again.";

const formatUpdatedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

// ── Badge ─────────────────────────────────────────────────────────────────────

export function DlStatusBadge({
  status,
  note,
  className,
}: {
  status: DlStatus | undefined;
  /** DEPOSIT note, shown as the tooltip. */
  note?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        BADGE_STYLE[status ?? "NONE"],
        className,
      )}
      title={status === "DEPOSIT" && note ? `DL deposit: ${note}` : undefined}
    >
      <IdCard className="h-3 w-3 shrink-0" />
      {dlStatusLabel(status)}
    </span>
  );
}

// ── Selector (pickup + edit dialog) ───────────────────────────────────────────

interface DlStatusSelectorProps {
  id: string;
  value: DlStatus;
  note: string;
  onValueChange: (value: DlCollectionStatusValue) => void;
  onNoteChange: (note: string) => void;
  error?: string | null;
  disabled?: boolean;
}

/** Required three-way choice; nothing is pre-selected. DEPOSIT asks what was left. */
export function DlStatusSelector({
  id,
  value,
  note,
  onValueChange,
  onNoteChange,
  error,
  disabled = false,
}: DlStatusSelectorProps) {
  const noteId = `${id}-note`;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id={`${id}-label`}>
        Original driving licence <span className="text-red-500">*</span>
      </p>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={value ?? ""}
        onValueChange={(v) => onValueChange(v as DlCollectionStatusValue)}
        disabled={disabled}
        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
      >
        {DL_COLLECTION_STATUSES.map((option) => {
          const optionId = `${id}-${option}`;
          const selected = value === option;
          return (
            <Label
              key={option}
              htmlFor={optionId}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border-2 p-3 leading-normal cursor-pointer transition-colors",
                selected
                  ? "border-[#FF5F00] bg-orange-50/70"
                  : "border-gray-200 bg-white hover:border-orange-200",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem id={optionId} value={option} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold text-gray-900">
                  {DL_STATUS_LABELS[option]}
                </span>
                <span className="block text-xs font-normal text-muted-foreground leading-snug">
                  {OPTION_HELP[option]}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>

      {value === "DEPOSIT" && (
        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-xs font-medium text-gray-700">
            What did the customer leave? <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={DL_DEPOSIT_NOTE_MAX}
            rows={2}
            placeholder="e.g. Aadhaar card kept, ₹2,000 cash"
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={disabled}
            className="min-h-0 bg-white"
          />
          <p className="text-[11px] text-right text-muted-foreground tabular-nums">
            {note.length}/{DL_DEPOSIT_NOTE_MAX}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

interface DlStatusEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: DlStatusRole;
  publicId: string;
  dlStatus: DlStatus | undefined;
  dlDepositNote?: string | null;
  /** Shown in the title so the BM knows which booking they are changing. */
  bookingLabel?: string;
  onUpdated?: (result: DlStatusUpdateResult) => void;
  /** Lists to refetch after a successful change (the booking's details are always refetched). */
  refreshQueryKeys?: QueryKey[];
}

type DlStatusMutation = UseMutationResult<
  Awaited<ReturnType<typeof dlStatusService.update>>,
  unknown,
  UpdateDlStatusBody
>;

export function DlStatusEditDialog({
  open,
  onOpenChange,
  role,
  publicId,
  dlStatus,
  dlDepositNote,
  bookingLabel,
  onUpdated,
  refreshQueryKeys,
}: DlStatusEditDialogProps) {
  const queryClient = useQueryClient();

  const mutation: DlStatusMutation = useMutation({
    mutationFn: (body: UpdateDlStatusBody) => dlStatusService.update(role, publicId, body),
    onSuccess: (response) => {
      toast.success(response.message || "DL status updated");
      queryClient.invalidateQueries({ queryKey: ["booking", publicId] });
      refreshQueryKeys?.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      onUpdated?.(response.data);
      onOpenChange(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, UPDATE_FAILED_MESSAGE)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg bg-white">
        {/* Content unmounts when closed, so every open starts from the stored status. */}
        <DlStatusEditForm
          publicId={publicId}
          dlStatus={dlStatus}
          dlDepositNote={dlDepositNote}
          bookingLabel={bookingLabel}
          mutation={mutation}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DlStatusEditForm({
  publicId,
  dlStatus,
  dlDepositNote,
  bookingLabel,
  mutation,
  onCancel,
}: {
  publicId: string;
  dlStatus: DlStatus | undefined;
  dlDepositNote?: string | null;
  bookingLabel?: string;
  mutation: DlStatusMutation;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<DlStatus>(dlStatus ?? null);
  const [note, setNote] = useState(dlStatus === "DEPOSIT" ? dlDepositNote ?? "" : "");
  const [error, setError] = useState<string | null>(null);

  const choiceError = dlChoiceError(value, note);

  const handleSave = () => {
    if (!value || choiceError) {
      setError(choiceError);
      return;
    }
    mutation.mutate(dlChoicePayload(value, note), {
      onError: (err) => setError(apiErrorMessage(err, UPDATE_FAILED_MESSAGE)),
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update DL status{bookingLabel ? ` · ${bookingLabel}` : ""}</DialogTitle>
        <DialogDescription>
          Currently: {dlStatusLabel(dlStatus)}
          {dlStatus === "DEPOSIT" && dlDepositNote ? ` (${dlDepositNote})` : ""}
        </DialogDescription>
      </DialogHeader>

      <DlStatusSelector
        id={`dl-edit-${publicId}`}
        value={value}
        note={note}
        onValueChange={(v) => {
          setValue(v);
          setError(null);
        }}
        onNoteChange={(n) => {
          setNote(n);
          setError(null);
        }}
        error={error}
        disabled={mutation.isPending}
      />

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          className="bg-[#FF5F00] hover:bg-[#e65600]"
          onClick={handleSave}
          disabled={!!choiceError || mutation.isPending}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Display + edit entry point ────────────────────────────────────────────────

interface DlStatusPanelProps {
  role: DlStatusRole;
  publicId: string;
  /** Booking status — Fleet can only edit while CONFIRMED / PICKED_UP. */
  bookingStatus: string;
  dlStatus: DlStatus | undefined;
  dlDepositNote?: string | null;
  dlStatusUpdatedAt?: string | null;
  /**
   * "card": labelled block (pickup / drop pages, BM details).
   * "compact": badge + edit icon for list rows.
   */
  variant?: "card" | "compact";
  /** Drop page: say what to hand back (licence or deposit). */
  dropReminder?: boolean;
  bookingLabel?: string;
  onUpdated?: (result: DlStatusUpdateResult) => void;
  refreshQueryKeys?: QueryKey[];
  className?: string;
}

export function DlStatusPanel({
  role,
  publicId,
  bookingStatus,
  dlStatus,
  dlDepositNote,
  dlStatusUpdatedAt,
  variant = "card",
  dropReminder = false,
  bookingLabel,
  onUpdated,
  refreshQueryKeys,
  className,
}: DlStatusPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = role === "manager" || canStaffEditDlStatus(bookingStatus);
  const note = dlStatus === "DEPOSIT" ? dlDepositNote : null;

  const dialog = canEdit ? (
    <DlStatusEditDialog
      open={editOpen}
      onOpenChange={setEditOpen}
      role={role}
      publicId={publicId}
      dlStatus={dlStatus}
      dlDepositNote={dlDepositNote}
      bookingLabel={bookingLabel}
      onUpdated={onUpdated}
      refreshQueryKeys={refreshQueryKeys}
    />
  ) : null;

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-1 min-w-0", className)}>
        <div className="flex flex-col min-w-0">
          <DlStatusBadge status={dlStatus} note={note} />
          {note && (
            <span className="mt-0.5 max-w-[11rem] truncate text-[10px] text-blue-700" title={note}>
              {note}
            </span>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Update DL status"
            title="Update DL status"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {dialog}
      </div>
    );
  }

  const reminder = !dropReminder
    ? null
    : dlStatus === "COLLECTED"
      ? "Hand the original licence back to the customer."
      : dlStatus === "DEPOSIT"
        ? `Return the deposit: ${dlDepositNote || "see the pickup record"}`
        : dlStatus === "NOT_COLLECTED"
          ? "The customer kept their licence — nothing to hand back."
          : null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-white px-4 py-3",
        dropReminder && dlStatus === "DEPOSIT" ? "border-blue-200 bg-blue-50/50" : "border-gray-200",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <IdCard className="h-3.5 w-3.5" />
          Driving licence
        </span>
        <DlStatusBadge status={dlStatus} note={note} />
        {dlStatusUpdatedAt && (
          <span className="text-[11px] text-muted-foreground">
            Updated {formatUpdatedAt(dlStatusUpdatedAt)}
          </span>
        )}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3 w-3" />
            {dlStatus ? "Change" : "Record"}
          </Button>
        )}
      </div>
      {reminder ? (
        <p
          className={cn(
            "mt-1.5 text-sm",
            dlStatus === "DEPOSIT" ? "font-semibold text-blue-900" : "text-gray-700",
          )}
        >
          {reminder}
        </p>
      ) : (
        note && <p className="mt-1.5 text-sm text-blue-900">Deposit: {note}</p>
      )}
      {dialog}
    </div>
  );
}
