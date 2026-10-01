import { useState } from "react";
import { ZoomBadge } from "@/components/ui/PhotoLightbox";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bookingService } from "@/services/booking.service";
import {
  dropService,
  type DropDamage,
  type DropDamageSeverity,
} from "@/services/drop.service";
import { apiErrorMessage } from "@/lib/counterErrors";
import { cn, compressImage, formatCurrency } from "@/lib/utils";

const SEVERITIES: DropDamageSeverity[] = ["Minor", "Moderate", "Severe"];

export interface DropDamageVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  category: string;
}

function damageZonesFor(category: string | undefined): string[] {
  return category?.toLowerCase().includes("two")
    ? ["Front", "Rear", "Left Side", "Right Side"]
    : [
        "Front Bumper", "Rear Bumper", "Left Front Door", "Left Rear Door",
        "Right Front Door", "Right Rear Door", "Hood", "Roof", "Trunk", "Wheels", "Interior",
      ];
}

interface DropDamageSectionProps {
  bookingPublicId: string;
  damages: DropDamage[];
  /** The booking's vehicles — a chooser appears when there is more than one. */
  vehicles: DropDamageVehicle[];
  /** Payment already started / settled — list only, no add or delete. */
  readOnly: boolean;
  /** Session branches bill "Charge customer" damage on this drop; others leave it to the manager. */
  billsAtDrop: boolean;
  /** Called after a damage is added or removed so the page can refresh the list (and the bill). */
  onChanged: () => void | Promise<void>;
  onPreview: (url: string, group?: string[]) => void;
}

interface DraftDamage {
  vehiclePublicId: string;
  area: string;
  severity: DropDamageSeverity;
  description: string;
  amount: string;
  chargeCustomer: boolean | null;
  photos: { publicId: string; url: string }[];
}

const emptyDraft = (vehicles: DropDamageVehicle[]): DraftDamage => ({
  vehiclePublicId: vehicles.length === 1 ? vehicles[0].publicId : "",
  area: "",
  severity: "Minor",
  description: "",
  amount: "",
  chargeCustomer: null,
  photos: [],
});

export function DropDamageSection({
  bookingPublicId,
  damages,
  vehicles,
  readOnly,
  billsAtDrop,
  onChanged,
  onPreview,
}: DropDamageSectionProps) {
  const [showForm, setShowForm] = useState(damages.length === 0);
  const [draft, setDraft] = useState<DraftDamage>(() => emptyDraft(vehicles));
  const multiVehicle = vehicles.length > 1;
  const damageZones = damageZonesFor(
    (vehicles.find((v) => v.publicId === draft.vehiclePublicId) ?? vehicles[0])?.category,
  );
  const [uploadingCount, setUploadingCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const amountNum = draft.amount.trim() === "" ? NaN : Number(draft.amount);
  // Session branches bill the cost now, so charging the customer ₹0 is refused.
  const zeroCharge = billsAtDrop && draft.chargeCustomer === true && amountNum === 0;
  const draftErrors = {
    vehicle: !draft.vehiclePublicId,
    photos: draft.photos.length === 0,
    area: !draft.area,
    description: draft.description.trim().length < 3,
    amount: Number.isNaN(amountNum) || amountNum < 0 || zeroCharge,
    chargeCustomer: draft.chargeCustomer === null,
  };
  const draftValid = !Object.values(draftErrors).some(Boolean);

  const uploadPhoto = async (file: File) => {
    setUploadingCount((n) => n + 1);
    try {
      const processed = await compressImage(file).catch(() => file);
      const formData = new FormData();
      formData.append("file", processed);
      const data = await bookingService.uploadDamageImage(formData);
      setDraft((prev) => ({ ...prev, photos: [...prev.photos, { publicId: data.fileId, url: data.url }] }));
    } catch {
      toast.error("Failed to upload damage photo");
    } finally {
      setUploadingCount((n) => n - 1);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: (files: File[]) => files.forEach((f) => void uploadPhoto(f)),
    accept: { "image/*": [] },
    disabled: readOnly,
  });

  const removeDraftPhoto = (publicId: string) => {
    setDraft((prev) => ({ ...prev, photos: prev.photos.filter((p) => p.publicId !== publicId) }));
    // Best-effort: the file isn't linked to anything yet.
    bookingService.deleteReturnImage(publicId).catch(() => undefined);
  };

  const discardDraft = () => {
    draft.photos.forEach((p) => bookingService.deleteReturnImage(p.publicId).catch(() => undefined));
    setDraft(emptyDraft(vehicles));
    setShowForm(false);
  };

  const addMutation = useMutation({
    mutationFn: () =>
      dropService.addDamage(bookingPublicId, {
        vehiclePublicId: draft.vehiclePublicId,
        area: draft.area,
        severity: draft.severity,
        description: draft.description.trim(),
        amount: amountNum,
        chargeCustomer: draft.chargeCustomer === true,
        damageImageIds: draft.photos.map((p) => p.publicId),
      }),
    onSuccess: async () => {
      toast.success("Damage recorded");
      setDraft(emptyDraft(vehicles));
      setShowForm(false);
      await onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to record damage")),
  });

  const deleteMutation = useMutation({
    mutationFn: (damagePublicId: string) => dropService.deleteDamage(bookingPublicId, damagePublicId),
    onMutate: (damagePublicId) => setDeletingId(damagePublicId),
    onSuccess: async () => {
      toast.success("Damage removed");
      await onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to remove damage")),
    onSettled: () => setDeletingId(null),
  });

  const sumOf = (list: DropDamage[]) => list.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const billedTotal = sumOf(damages.filter((d) => d.billedAtDrop));
  const managerTotal = sumOf(damages.filter((d) => !d.billedAtDrop && d.chargeCustomer));
  const expenseTotal = sumOf(damages.filter((d) => !d.chargeCustomer));

  return (
    <div className="space-y-4">
      {/* ── Recorded damages ── */}
      {damages.length > 0 && (
        <div className="space-y-3">
          {damages.map((item) => (
            <div key={item.publicId} className="flex items-start justify-between gap-3 p-3 border rounded-md bg-white shadow-sm">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{item.area}</span>
                  <Badge variant={item.severity === "Severe" ? "destructive" : "outline"}>{item.severity}</Badge>
                </div>
                {multiVehicle && item.vehicle && (
                  <p className="text-xs text-muted-foreground">
                    {item.vehicle.make} {item.vehicle.model} ·{" "}
                    <span className="font-mono">{item.vehicle.regNo}</span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{item.description}</p>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    item.billedAtDrop ? "text-orange-700" : item.chargeCustomer ? "text-amber-700" : "text-blue-700",
                  )}
                >
                  {formatCurrency(parseFloat(item.amount) || 0)} ·{" "}
                  {item.billedAtDrop ? "on this bill" : item.chargeCustomer ? "manager will charge" : "Company expense"}
                </p>
                {item.photos.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {item.photos.map((img, idx) => (
                      <div
                        key={img.publicId}
                        className="relative aspect-square rounded overflow-hidden border bg-muted cursor-pointer"
                        onClick={() => onPreview(img.url, item.photos.map((p) => p.url))}
                      >
                        <img src={img.url} alt={`Damage ${idx + 1}`} className="w-full h-full object-cover" />
                        <ZoomBadge />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-500 shrink-0"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(item.publicId)}
                >
                  {deletingId === item.publicId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {billsAtDrop && (
              <span>
                On this bill: <span className="font-semibold text-foreground">{formatCurrency(billedTotal)}</span>
              </span>
            )}
            {managerTotal > 0 && (
              <span>
                Manager will charge: <span className="font-semibold text-foreground">{formatCurrency(managerTotal)}</span>
              </span>
            )}
            {expenseTotal > 0 && (
              <span>
                Company expense: <span className="font-semibold text-foreground">{formatCurrency(expenseTotal)}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Add damage form ── */}
      {!readOnly && showForm && (
        <div className="p-4 border rounded-lg space-y-4 bg-background animate-in fade-in slide-in-from-top-2">
          <div className="space-y-2">
            <Label>
              Photos <span className="text-red-500">*</span>
            </Label>
            <div
              {...getRootProps()}
              className="border border-dashed p-4 rounded text-center text-sm cursor-pointer hover:bg-muted flex flex-col items-center gap-1"
            >
              <input {...getInputProps()} capture="environment" />
              <Camera className="h-5 w-5 text-muted-foreground" />
              <p>Take a photo of the damage</p>
            </div>
            {(draft.photos.length > 0 || uploadingCount > 0) && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {draft.photos.map((img, idx) => (
                  <div
                    key={img.publicId}
                    className="relative aspect-square rounded overflow-hidden border bg-muted group cursor-pointer"
                    onClick={() => onPreview(img.url, draft.photos.map((p) => p.url))}
                  >
                    <img src={img.url} alt={`Damage ${idx + 1}`} className="w-full h-full object-cover" />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute top-1 right-1 h-5 w-5 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDraftPhoto(img.publicId);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {Array.from({ length: uploadingCount }, (_, i) => (
                  <div key={`uploading-${i}`} className="aspect-square rounded border bg-muted flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {multiVehicle && (
            <div className="space-y-2">
              <Label>
                Vehicle <span className="text-red-500">*</span>
              </Label>
              <Select
                value={draft.vehiclePublicId}
                onValueChange={(v) =>
                  setDraft((prev) => {
                    const next = vehicles.find((x) => x.publicId === v);
                    // Two- and four-wheelers have different areas.
                    const keepArea = damageZonesFor(next?.category).includes(prev.area);
                    return { ...prev, vehiclePublicId: v, area: keepArea ? prev.area : "" };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Which vehicle is damaged?" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.publicId} value={v.publicId}>
                      {v.make} {v.model} — {v.regNo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>
                Area <span className="text-red-500">*</span>
              </Label>
              <Select value={draft.area} onValueChange={(v) => setDraft((prev) => ({ ...prev, area: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select area" />
                </SelectTrigger>
                <SelectContent>
                  {damageZones.map((z) => (
                    <SelectItem key={z} value={z}>{z}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select
                value={draft.severity}
                onValueChange={(v) => setDraft((prev) => ({ ...prev, severity: v as DropDamageSeverity }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              rows={2}
              className="resize-none"
              placeholder="Describe the damage (e.g. 5cm scratch on the rear bumper)"
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Damage cost (₹) <span className="text-red-500">*</span>
            </Label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
              <Input
                type="number"
                min="0"
                className="pl-7 h-10"
                placeholder="e.g. 1500"
                value={draft.amount}
                onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, chargeCustomer: true }))}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                draft.chargeCustomer === true
                  ? "border-orange-500 bg-orange-50 text-orange-800"
                  : "border-gray-200 bg-white text-gray-600 hover:border-orange-300",
              )}
            >
              <span className="text-sm font-semibold">Charge customer</span>
              <span className="text-xs opacity-80">
                {billsAtDrop ? "Added to this drop's bill" : "The branch manager charges it after review"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, chargeCustomer: false }))}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                draft.chargeCustomer === false
                  ? "border-blue-500 bg-blue-50 text-blue-800"
                  : "border-gray-200 bg-white text-gray-600 hover:border-blue-300",
              )}
            >
              <span className="text-sm font-semibold">Company expense</span>
              <span className="text-xs opacity-80">Recorded, not billed to the customer</span>
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={discardDraft} disabled={addMutation.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#FF5F00] hover:bg-[#e65600] text-white"
              disabled={!draftValid || uploadingCount > 0 || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Damage
            </Button>
          </div>
          {zeroCharge ? (
            <p className="text-xs text-red-600 text-right">
              Enter the damage cost to charge the customer, or choose Company expense.
            </p>
          ) : (
            !draftValid && (
              <p className="text-xs text-muted-foreground text-right">
                Add {multiVehicle ? "the vehicle, " : ""}at least one photo, the area, a description (3+ characters), the cost and who pays.
              </p>
            )
          )}
        </div>
      )}

      {!readOnly && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          + Add Damage
        </Button>
      )}
    </div>
  );
}
