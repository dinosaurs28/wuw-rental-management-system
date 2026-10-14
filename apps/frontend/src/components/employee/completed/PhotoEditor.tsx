import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn, compressImage } from "@/lib/utils";
import { PhotoLightbox, ZoomBadge } from "@/components/ui/PhotoLightbox";

export interface EditablePhoto {
  /** FileObject publicId */
  fileId: string;
  url: string;
  /** Capture slot; null / undefined = extra photo. */
  label?: string | null;
}

interface PhotoEditorProps {
  /** Configured capture slots ("Front", "Odometer" …); omit for free-form photos. */
  fields?: { name: string; required: boolean }[];
  value: EditablePhoto[];
  onChange: (next: EditablePhoto[]) => void;
  /** Uploads one photo; returns its { fileId, url }. */
  upload: (form: FormData) => Promise<{ fileId: string; url: string }>;
  /** Uploads still running — the form holds Save until they land. */
  onBusyChange?: (busy: boolean) => void;
  addLabel?: string;
}

/**
 * Add / replace / remove photos of a completed pickup or return (client item 1).
 * Nothing is saved until the form is saved: new photos are uploaded first and
 * sent with it, removed ones are taken off the booking by the server.
 */
export function PhotoEditor({ fields = [], value, onChange, upload, onBusyChange, addLabel = "Add photo" }: PhotoEditorProps) {
  const [uploading, setUploading] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Uploads finish in any order: build the next list from the latest value
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    onBusyChange?.(uploading.length > 0);
  }, [uploading.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFile = async (file: File, label: string | null) => {
    const key = `${label ?? "extra"}:${file.name}:${Date.now()}`;
    setUploading((list) => [...list, key]);
    try {
      const form = new FormData();
      form.append("file", await compressImage(file));
      const { fileId, url } = await upload(form);
      const current = valueRef.current;
      // A capture slot holds one photo: the new one replaces it
      const next = label
        ? [...current.filter((p) => p.label !== label), { fileId, url, label }]
        : [...current, { fileId, url, label: null }];
      valueRef.current = next;
      onChange(next);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Couldn't upload the photo. Try again.");
    } finally {
      setUploading((list) => list.filter((k) => k !== key));
    }
  };

  const remove = (fileId: string) => onChange(valueRef.current.filter((p) => p.fileId !== fileId));
  const slotBusy = (label: string) => uploading.some((k) => k.startsWith(`${label}:`));
  const extras = value.filter((p) => !p.label || !fields.some((f) => f.name === p.label));

  const thumb = (photo: EditablePhoto, caption?: string) => (
    <div key={photo.fileId} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
      <button
        type="button"
        className="relative w-full h-full cursor-zoom-in"
        onClick={() => setLightbox(Math.max(0, value.findIndex((p) => p.fileId === photo.fileId)))}
        aria-label={`View ${caption ?? "photo"}`}
      >
        <img src={photo.url} alt={caption ?? "Photo"} className="w-full h-full object-cover" loading="lazy" />
        <ZoomBadge />
      </button>
      {caption && (
        <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">
          {caption}
        </span>
      )}
      <button
        type="button"
        onClick={() => remove(photo.fileId)}
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
        aria-label="Remove photo"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const picker = (label: string | null, text: string, busy: boolean) => (
    <label
      className={cn(
        "aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground cursor-pointer hover:border-primary/40 hover:text-foreground transition-colors",
        busy && "pointer-events-none opacity-60",
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
      <span className="text-center px-1 leading-tight">{text}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        multiple={!label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          for (const file of label ? files.slice(0, 1) : files) void addFile(file, label);
        }}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {fields.map((f) => {
            const photo = value.find((p) => p.label === f.name);
            return (
              <div key={f.name} className="space-y-1">
                <p className="text-xs font-medium text-gray-700 truncate">
                  {f.name}
                  {f.required && !photo && <span className="text-red-500 ml-1">required</span>}
                </p>
                {photo ? thumb(photo) : picker(f.name, "Take photo", slotBusy(f.name))}
              </div>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {extras.map((p) => thumb(p, p.label ?? undefined))}
        {picker(null, addLabel, uploading.some((k) => k.startsWith("extra:")))}
      </div>
      <PhotoLightbox
        items={value.map((p) => ({ url: p.url, label: p.label ?? null }))}
        startIndex={lightbox ?? 0}
        open={lightbox !== null}
        onOpenChange={(open) => !open && setLightbox(null)}
      />
    </div>
  );
}
