import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReturnSummaryDamage } from "@/services/completedOperation.service";
import { PhotoEditor } from "@/components/employee/completed/PhotoEditor";
import {
  SEVERITIES,
  damageBilling,
  isPricedDamage,
  type DamageDraft,
} from "@/components/employee/completed/completedEdit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * A damage recorded at the drop, edited with the completed drop (Edit Return,
 * client item 1): what it says, its photos and — for damage the customer pays —
 * its cost. Once the branch manager reviewed it, only they can change it.
 */

interface DropDamageEditorProps {
  damage: ReturnSummaryDamage;
  /** undefined: not editable (reviewed by the branch manager) */
  draft: DamageDraft | undefined;
  onChange: (patch: Partial<DamageDraft>) => void;
  upload: (form: FormData) => Promise<{ fileId: string; url: string }>;
  onBusyChange: (busy: boolean) => void;
}

export function DropDamageEditor({ damage, draft, onChange, upload, onBusyChange }: DropDamageEditorProps) {
  const id = damage.publicId;
  if (!damage.editable || !draft) {
    return (
      <div className="rounded-lg border bg-white p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          {damage.area || "Damage"} · {damage.severity}
        </p>
        {damage.description && <p className="text-sm text-gray-700">{damage.description}</p>}
        <p className="text-xs text-muted-foreground">Reviewed by the branch manager — only they can change it.</p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {damage.photos.map((p) => (
            <img key={p.fileId} src={p.url} alt="Damage" className="aspect-square w-full rounded-md border object-cover" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`damage-area-${id}`} className="text-xs text-neutral-600">
            Damaged area
          </Label>
          <Input
            id={`damage-area-${id}`}
            className="h-10"
            value={draft.area}
            maxLength={120}
            placeholder="e.g. Front bumper"
            onChange={(e) => onChange({ area: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-neutral-600">Severity</Label>
          <div className="flex gap-1.5">
            {SEVERITIES.map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => onChange({ severity: sev })}
                className={cn(
                  "px-3 h-10 rounded-md border text-sm font-medium transition-colors",
                  draft.severity === sev
                    ? "bg-[#FF5F00] border-[#FF5F00] text-white"
                    : "bg-white text-gray-700 hover:border-gray-400",
                )}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`damage-desc-${id}`} className="text-xs text-neutral-600">
          What's damaged
        </Label>
        <Textarea
          id={`damage-desc-${id}`}
          value={draft.description}
          maxLength={1000}
          placeholder="Describe the damage"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      {isPricedDamage(damage) ? (
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor={`damage-amount-${id}`} className="text-xs text-neutral-600">
            Damage cost (₹)
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
            <Input
              id={`damage-amount-${id}`}
              inputMode="decimal"
              className="pl-7 h-10"
              value={draft.amount}
              onChange={(e) => onChange({ amount: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{damageBilling(damage)}.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{damageBilling(damage)}.</p>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs text-neutral-600">Damage photos</Label>
        <PhotoEditor
          value={draft.photos}
          onChange={(next) => onChange({ photos: next })}
          onBusyChange={onBusyChange}
          upload={upload}
        />
      </div>
    </div>
  );
}
