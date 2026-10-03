import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  X,
} from "lucide-react";

import { ManagerLayout } from "@/components/manager/ManagerLayout";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  managerOffersService,
  type ManagerOffer,
  type OfferSaveFields,
  type OfferStatus,
  type PosterCouponOption,
} from "@/services/offers.service";
import {
  formatIstDateTime,
  formatIstDay,
  formatOfferDiscount,
  isoToIstInput,
  istInputEndOfDayIn,
  istInputNow,
  istInputToMs,
} from "@/lib/offers";

// "Offers & banners" (#15): hero-slider posters for this branch — shown on the
// website landing page and the app home screen while live.

// Mirrors the server rules (services/promo-banner) so most mistakes show before saving
const TITLE_MAX = 80;
const SUBTITLE_MAX = 160;
const CTA_MAX = 30;
const COUPON_MAX = 40;
const SORT_MAX = 9999;
const WINDOW_MAX_DAYS = 366;
const BRANCH_LIMIT = 12;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIN_W = 800;
const IMAGE_MIN_H = 400;
const ASPECT_MIN = 1.5;
const ASPECT_MAX = 2.1;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const NO_LINK = "__none__";

const OFFERS_KEY = ["manager-offers"] as const;

type Filter = "ALL" | OfferStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "LIVE", label: "Live" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "INACTIVE", label: "Inactive" },
];

const STATUS_STYLE: Record<OfferStatus, { label: string; className: string }> = {
  LIVE: { label: "Live", className: "bg-green-600 text-white" },
  SCHEDULED: { label: "Scheduled", className: "bg-blue-600 text-white" },
  EXPIRED: { label: "Expired", className: "bg-neutral-700 text-white" },
  INACTIVE: { label: "Inactive", className: "bg-white text-neutral-700 ring-1 ring-neutral-300" },
};

interface ApiErrorBody {
  code?: string;
  message?: string;
  errors?: { path: string; message: string }[];
}

const errorBody = (err: unknown): ApiErrorBody =>
  (err as { response?: { data?: ApiErrorBody } })?.response?.data ?? {};

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// ── Small pieces ──────────────────────────────────────────────────────────────

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-orange-500" : "bg-neutral-300",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className={cn("text-[11px] tabular-nums", value.length > max ? "text-red-600" : "text-neutral-400")}>
      {value.length}/{max}
    </span>
  );
}

/** True when the coupon's own start is still ahead (the website shows the code from then). */
const couponNotStarted = (startDate: string | undefined) =>
  !!startDate && new Date(startDate).getTime() > Date.now();

// ── Poster card ───────────────────────────────────────────────────────────────

function PosterCard({
  offer,
  onEdit,
  onDelete,
  onToggleActive,
  toggling,
}: {
  offer: ManagerOffer;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
  toggling: boolean;
}) {
  const status = STATUS_STYLE[offer.status];
  const couponInvalid = offer.couponStatus && !offer.couponStatus.valid ? offer.couponStatus : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="relative aspect-[16/9] bg-neutral-900">
        <img
          src={offer.imageUrl}
          alt={offer.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain"
        />
        <span
          className={cn(
            "absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm",
            status.className,
          )}
        >
          {status.label}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          Order {offer.sortOrder}
        </span>
      </div>

      <div className="flex-1 space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 font-semibold text-neutral-900">{offer.title}</h3>
          {offer.subtitle && <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{offer.subtitle}</p>}
        </div>

        <div className="space-y-2 text-xs text-neutral-600">
          <p className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <span>
              {formatIstDateTime(offer.startsAt)} → {formatIstDateTime(offer.endsAt)}
            </span>
          </p>

          {offer.couponCode ? (
            <div className="flex items-start gap-2">
              <Ticket className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <div className="min-w-0 space-y-1">
                <p>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono font-bold text-neutral-900">
                    {offer.couponCode}
                  </span>
                  {offer.coupon && (
                    <span className="ml-1.5">
                      {formatOfferDiscount(offer.coupon)} · till {formatIstDay(offer.coupon.endDate)}
                    </span>
                  )}
                </p>
                {couponInvalid && (
                  <p className="flex items-start gap-1 text-amber-700">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      {couponInvalid.message} The code is hidden on the website and app until this is fixed.
                    </span>
                  </p>
                )}
                {!couponInvalid && offer.coupon && couponNotStarted(offer.coupon.startDate) && (
                  <p className="flex items-start gap-1 text-blue-700">
                    <Info className="mt-px h-3 w-3 shrink-0" />
                    <span>The code shows from {formatIstDay(offer.coupon.startDate)}, when the coupon starts.</span>
                  </p>
                )}
                {offer.couponWarning && (
                  <p className="flex items-start gap-1 text-neutral-500">
                    <Info className="mt-px h-3 w-3 shrink-0" />
                    <span>{offer.couponWarning}</span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-neutral-400">
              <Ticket className="h-3.5 w-3.5 shrink-0" /> No coupon code
            </p>
          )}

          <div className="flex items-start gap-2">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <div className="min-w-0 space-y-1">
              <p className="break-words">
                {offer.linkTarget
                  ? (offer.linkLabel ?? "Linked vehicle")
                  : offer.ctaLabel
                    ? "Opens the vehicles list"
                    : "No button"}
                {offer.ctaLabel && <span className="text-neutral-400"> · button “{offer.ctaLabel}”</span>}
              </p>
              {!offer.linkValid && (
                <p className="flex items-start gap-1 text-amber-700">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                  <span>The linked vehicle no longer exists, so the poster isn't linked to it. Pick another link.</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-3">
        <Switch
          checked={offer.isActive}
          onChange={onToggleActive}
          disabled={toggling}
          label={offer.isActive ? `Turn off “${offer.title}”` : `Turn on “${offer.title}”`}
        />
        <span className="text-xs font-medium text-neutral-600">
          {toggling ? "Saving…" : offer.isActive ? "Active" : "Off"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs" onClick={onEdit}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteDialog({
  offer,
  onClose,
  onConfirm,
  loading,
}: {
  offer: ManagerOffer;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-sm">
        <div className="border-b border-neutral-100 bg-neutral-50/60 px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-[15px]">Delete poster</DialogTitle>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{offer.title}</p>
              </div>
            </div>
          </DialogHeader>
        </div>
        <div className="px-6 py-5">
          <DialogDescription className="text-sm leading-relaxed text-neutral-600">
            It disappears from the website and the app right away. This can't be undone — to hide it for a while,
            turn it off instead.
          </DialogDescription>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button className="h-11 flex-1 bg-red-600 text-white hover:bg-red-700" onClick={onConfirm} disabled={loading}>
              {loading ? "Deleting…" : "Yes, delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create / edit form ────────────────────────────────────────────────────────

interface FormValues {
  title: string;
  subtitle: string;
  couponCode: string;
  ctaLabel: string;
  linkTarget: string;
  startsAt: string;
  endsAt: string;
  sortOrder: string;
  isActive: boolean;
}

type FieldKey = keyof FormValues | "image" | "form";
type FieldErrors = Partial<Record<FieldKey, string>>;

const initialValues = (offer: ManagerOffer | null): FormValues =>
  offer
    ? {
        title: offer.title,
        subtitle: offer.subtitle ?? "",
        couponCode: offer.couponCode ?? "",
        ctaLabel: offer.ctaLabel ?? "",
        linkTarget: offer.linkTarget ?? "",
        startsAt: isoToIstInput(offer.startsAt),
        endsAt: isoToIstInput(offer.endsAt),
        sortOrder: String(offer.sortOrder),
        isActive: offer.isActive,
      }
    : {
        title: "",
        subtitle: "",
        couponCode: "",
        ctaLabel: "",
        linkTarget: "",
        startsAt: istInputNow(),
        endsAt: istInputEndOfDayIn(7),
        sortOrder: "0",
        isActive: true,
      };

/** Server error code → the form field it belongs to. */
function fieldForCode(code: string | undefined): FieldKey {
  if (!code) return "form";
  if (
    [
      "PROMO_IMAGE_REQUIRED",
      "INVALID_FILE_TYPE",
      "INVALID_IMAGE",
      "INVALID_UPLOAD",
      "IMAGE_TOO_SMALL",
      "PROMO_IMAGE_ASPECT",
      "FILE_TOO_LARGE",
    ].includes(code)
  )
    return "image";
  if (code === "PROMO_INVALID_WINDOW") return "endsAt";
  if (code.startsWith("PROMO_COUPON_")) return "couponCode";
  if (code === "PROMO_LINK_TARGET_INVALID") return "linkTarget";
  return "form";
}

/** Reads the picked file's size in the browser (EXIF rotation is applied by the browser, like the server). */
function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("unreadable"));
    img.src = url;
  });
}

function PosterFormDialog({
  offer,
  atLimit,
  onClose,
  onSaved,
}: {
  offer: ManagerOffer | null;
  /** The branch already has the maximum of live + scheduled active posters. */
  atLimit: boolean;
  onClose: () => void;
  onSaved: (saved: ManagerOffer) => void;
}) {
  const isEdit = !!offer;
  const initial = useMemo(() => initialValues(offer), [offer]);
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number; size: number } | null>(null);
  const [checkingImage, setCheckingImage] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const couponsQuery = useQuery({
    queryKey: ["manager-offer-coupons"],
    queryFn: () => managerOffersService.coupons(),
    staleTime: 30_000,
  });
  const linksQuery = useQuery({
    queryKey: ["manager-offer-link-targets"],
    queryFn: () => managerOffersService.linkTargets(),
    staleTime: 60_000,
  });

  const coupons: PosterCouponOption[] = couponsQuery.data?.data ?? [];
  const groups = linksQuery.data?.data.groups ?? [];
  const vehicles = linksQuery.data?.data.vehicles ?? [];

  // Free the object URL of a replaced / discarded preview
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const code = values.couponCode.trim().toUpperCase();
  const pickedCoupon = coupons.find((c) => c.code === code) ?? null;
  const storedCouponUnchanged = isEdit && code === (offer?.couponCode ?? "");
  const storedLinkMissing =
    !!values.linkTarget &&
    linksQuery.isSuccess &&
    !groups.some((g) => g.groupKey === values.linkTarget) &&
    !vehicles.some((v) => v.publicId === values.linkTarget);

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setErrors((e) => ({ ...e, image: undefined, form: undefined }));
    if (!IMAGE_TYPES.includes(file.type)) {
      setErrors((e) => ({ ...e, image: "Use a JPG, PNG or WebP image." }));
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setErrors((e) => ({ ...e, image: `The image is ${formatBytes(file.size)} — the limit is 10 MB.` }));
      return;
    }
    const url = URL.createObjectURL(file);
    setCheckingImage(true);
    try {
      const { width, height } = await readImageSize(url);
      const aspect = width / height;
      let problem: string | null = null;
      if (width < IMAGE_MIN_W || height < IMAGE_MIN_H) {
        problem = `The image is ${width} × ${height} px — it must be at least ${IMAGE_MIN_W} × ${IMAGE_MIN_H} px.`;
      } else if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) {
        problem = `The image is ${width} × ${height} px. Use a wide landscape image (about 16:9, e.g. 1600 × 900).`;
      }
      if (problem) {
        URL.revokeObjectURL(url);
        setErrors((e) => ({ ...e, image: problem }));
        return;
      }
      setImage(file);
      setImagePreview(url);
      setImageInfo({ width, height, size: file.size });
    } catch {
      URL.revokeObjectURL(url);
      setErrors((e) => ({ ...e, image: "This image can't be read. Export it as a JPG or PNG and try again." }));
    } finally {
      setCheckingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void pickImage(e.dataTransfer.files?.[0]);
  };

  /** Client checks mirroring the server; returns the errors (empty = OK). */
  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const title = values.title.trim();
    if (!title) next.title = "Title is required.";
    else if (title.length > TITLE_MAX) next.title = `Title can be at most ${TITLE_MAX} characters.`;
    if (values.subtitle.trim().length > SUBTITLE_MAX)
      next.subtitle = `Subtitle can be at most ${SUBTITLE_MAX} characters.`;
    if (code.length > COUPON_MAX) next.couponCode = `Coupon code can be at most ${COUPON_MAX} characters.`;
    if (values.ctaLabel.trim().length > CTA_MAX) next.ctaLabel = `Button label can be at most ${CTA_MAX} characters.`;

    const sort = values.sortOrder.trim() === "" ? 0 : Number(values.sortOrder);
    if (!Number.isInteger(sort) || sort < 0 || sort > SORT_MAX)
      next.sortOrder = `Order must be a whole number from 0 to ${SORT_MAX}.`;

    const start = istInputToMs(values.startsAt);
    const end = istInputToMs(values.endsAt);
    if (Number.isNaN(start)) next.startsAt = "Pick a start date and time.";
    if (Number.isNaN(end)) next.endsAt = "Pick an end date and time.";
    if (!next.startsAt && !next.endsAt) {
      const startChanged = !isEdit || values.startsAt !== initial.startsAt;
      const endChanged = !isEdit || values.endsAt !== initial.endsAt;
      if (startChanged || endChanged) {
        if (end <= start) next.endsAt = "The poster must end after it starts.";
        else if (endChanged && end <= Date.now()) next.endsAt = "The end time has already passed. Pick a future end time.";
        else if ((end - start) / 86_400_000 > WINDOW_MAX_DAYS)
          next.endsAt = `A poster can run for at most ${WINDOW_MAX_DAYS} days.`;
      }
    }

    if (!isEdit && !image) next.image = "Upload a poster image.";
    return next;
  };

  /** Create: every field. Edit: only what changed (dates are re-checked only when they change). */
  const buildFields = (): OfferSaveFields => {
    const current: OfferSaveFields = {
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      couponCode: code,
      ctaLabel: values.ctaLabel.trim(),
      linkTarget: values.linkTarget,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      sortOrder: values.sortOrder.trim() === "" ? 0 : Number(values.sortOrder),
      isActive: values.isActive,
    };
    if (!isEdit) {
      // Optional fields are simply left out when empty
      const fields: OfferSaveFields = { ...current };
      if (!fields.subtitle) delete fields.subtitle;
      if (!fields.couponCode) delete fields.couponCode;
      if (!fields.ctaLabel) delete fields.ctaLabel;
      if (!fields.linkTarget) delete fields.linkTarget;
      return fields;
    }
    const before: OfferSaveFields = {
      title: initial.title.trim(),
      subtitle: initial.subtitle.trim(),
      couponCode: initial.couponCode.trim().toUpperCase(),
      ctaLabel: initial.ctaLabel.trim(),
      linkTarget: initial.linkTarget,
      startsAt: initial.startsAt,
      endsAt: initial.endsAt,
      sortOrder: Number(initial.sortOrder),
      isActive: initial.isActive,
    };
    const changed: OfferSaveFields = {};
    (Object.keys(current) as (keyof OfferSaveFields)[]).forEach((key) => {
      if (current[key] !== before[key]) {
        // "" clears an optional field on the server
        (changed as Record<string, unknown>)[key] = current[key];
      }
    });
    return changed;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const fields = buildFields();
      if (isEdit && offer) return managerOffersService.update(offer.publicId, fields, image);
      return managerOffersService.create(fields, image as File);
    },
    onSuccess: (res) => {
      toast.success(isEdit ? "Poster updated." : "Poster created.");
      onSaved(res.data);
    },
    onError: (err) => {
      const body = errorBody(err);
      const message = body.message || "Couldn't save the poster. Please try again.";
      if (body.code === "VALIDATION_ERROR" && body.errors?.length) {
        const next: FieldErrors = {};
        for (const e of body.errors) {
          const key = (e.path in initial ? e.path : "form") as FieldKey;
          if (!next[key]) next[key] = e.message;
        }
        setErrors(next);
      } else if (body.code === "PROMO_NOT_FOUND") {
        toast.error(message);
        onClose();
        return;
      } else {
        setErrors({ [fieldForCode(body.code)]: message });
      }
      toast.error(message);
    },
  });

  const submit = () => {
    const found = validate();
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }
    if (isEdit && !image && Object.keys(buildFields()).length === 0) {
      toast.info("No changes to save.");
      onClose();
      return;
    }
    mutation.mutate();
  };

  const saving = mutation.isPending;
  const shownImage = imagePreview ?? offer?.imageUrl ?? null;
  const posterEndMs = istInputToMs(values.endsAt);
  const couponEndsFirst =
    pickedCoupon && !Number.isNaN(posterEndMs) && new Date(pickedCoupon.endDate).getTime() < posterEndMs;

  return (
    <Dialog open onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-2xl">
        <div className="sticky top-0 z-10 border-b border-neutral-100 bg-neutral-50/95 px-6 py-5 backdrop-blur">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{isEdit ? "Edit poster" : "New poster"}</DialogTitle>
            <DialogDescription className="text-xs text-neutral-500">
              Shown in the hero slider on the website and the app home screen while it's live.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-6 px-6 py-5">
          {errors.form && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          {/* Image */}
          <section className="space-y-2">
            <Label className="text-xs text-neutral-600">
              Poster image {!isEdit && <span className="text-red-500">*</span>}
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => void pickImage(e.target.files?.[0])}
            />
            {shownImage ? (
              <div className="space-y-2">
                <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-neutral-900">
                  <img src={shownImage} alt="Poster preview" className="absolute inset-0 h-full w-full object-contain" />
                  {checkingImage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving || checkingImage}
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> Replace image
                  </Button>
                  {image && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs text-neutral-500"
                      onClick={() => {
                        setImage(null);
                        setImagePreview(null);
                        setImageInfo(null);
                      }}
                      disabled={saving}
                    >
                      <X className="h-3.5 w-3.5" /> {isEdit ? "Keep the current image" : "Remove"}
                    </Button>
                  )}
                  {imageInfo && (
                    <span className="text-xs text-neutral-500">
                      {imageInfo.width} × {imageInfo.height} px · {formatBytes(imageInfo.size)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  "flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400",
                  dragOver ? "border-orange-400 bg-orange-50" : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100",
                  errors.image && "border-red-300",
                )}
              >
                {checkingImage ? (
                  <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                ) : (
                  <ImagePlus className="h-7 w-7 text-neutral-400" />
                )}
                <p className="text-sm font-medium text-neutral-700">Choose a poster image or drop it here</p>
                <p className="text-xs text-neutral-500">
                  Landscape, about 16:9 (1600 × 900 works best) · at least 800 × 400 px · JPG, PNG or WebP · up to
                  10 MB
                </p>
              </div>
            )}
            <FieldError message={errors.image} />
          </section>

          {/* Text */}
          <section className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="offer-title" className="text-xs text-neutral-600">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Counter value={values.title} max={TITLE_MAX} />
              </div>
              <Input
                id="offer-title"
                className="h-10"
                value={values.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Weekend getaway — 20% off"
                aria-invalid={!!errors.title}
              />
              <FieldError message={errors.title} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="offer-subtitle" className="text-xs text-neutral-600">
                  Subtitle <span className="font-normal text-neutral-400">(optional)</span>
                </Label>
                <Counter value={values.subtitle} max={SUBTITLE_MAX} />
              </div>
              <Textarea
                id="offer-subtitle"
                rows={2}
                value={values.subtitle}
                onChange={(e) => set("subtitle", e.target.value)}
                placeholder="One line about the offer"
                aria-invalid={!!errors.subtitle}
              />
              <FieldError message={errors.subtitle} />
            </div>
          </section>

          {/* Coupon */}
          <section className="space-y-2">
            <Label htmlFor="offer-coupon" className="text-xs text-neutral-600">
              Coupon code <span className="font-normal text-neutral-400">(optional — customers can copy it or use it at checkout)</span>
            </Label>
            <div className="relative">
              <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input
                id="offer-coupon"
                className="h-10 pl-9 pr-9 font-mono uppercase"
                value={values.couponCode}
                onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                placeholder="Type a code or pick one below"
                maxLength={COUPON_MAX + 10}
                aria-invalid={!!errors.couponCode}
              />
              {values.couponCode && (
                <button
                  type="button"
                  onClick={() => set("couponCode", "")}
                  aria-label="Clear coupon code"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <FieldError message={errors.couponCode} />
            {!errors.couponCode && storedCouponUnchanged && offer?.couponStatus && !offer.couponStatus.valid && (
              <p className="flex items-start gap-1 text-xs text-amber-700">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                <span>{offer.couponStatus.message} Pick another code or clear it.</span>
              </p>
            )}
            {code && !pickedCoupon && couponsQuery.isSuccess && !storedCouponUnchanged && (
              <p className="text-xs text-neutral-500">
                This code isn't in the list below — it is checked when you save.
              </p>
            )}
            {couponEndsFirst && pickedCoupon && (
              <p className="flex items-start gap-1 text-xs text-neutral-600">
                <Info className="mt-px h-3 w-3 shrink-0" />
                <span>
                  The coupon ends {formatIstDay(pickedCoupon.endDate)}, before the poster — after that the poster shows
                  without a code.{" "}
                  <button
                    type="button"
                    className="font-medium text-orange-600 underline underline-offset-2 hover:text-orange-700"
                    onClick={() => set("endsAt", isoToIstInput(pickedCoupon.endDate))}
                  >
                    End the poster then
                  </button>
                </span>
              </p>
            )}

            <div className="rounded-xl border border-neutral-200">
              <p className="border-b border-neutral-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Coupons you can use here
              </p>
              {couponsQuery.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading coupons…
                </div>
              ) : couponsQuery.isError ? (
                <div className="flex items-center justify-between gap-2 px-3 py-3 text-xs text-neutral-500">
                  <span>Couldn't load the coupons — you can still type a code.</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => couponsQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : coupons.length === 0 ? (
                <p className="px-3 py-3 text-xs text-neutral-500">
                  No coupon can be advertised at this branch right now. Create one under Financials → Discounts.
                </p>
              ) : (
                <div className="max-h-48 divide-y divide-neutral-100 overflow-y-auto">
                  {coupons.map((c) => {
                    const picked = c.code === code;
                    return (
                      <button
                        key={c.publicId}
                        type="button"
                        onClick={() => set("couponCode", picked ? "" : c.code)}
                        aria-pressed={picked}
                        className={cn(
                          "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                          picked ? "bg-orange-50" : "hover:bg-neutral-50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            picked ? "border-orange-500 bg-orange-500 text-white" : "border-neutral-300",
                          )}
                        >
                          {picked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono text-sm font-bold text-neutral-900">{c.code}</span>
                            <span className="text-xs text-neutral-600">{formatOfferDiscount(c)}</span>
                            <span className="rounded-full bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-600">
                              {c.scope === "GLOBAL" ? "All branches" : "This branch"}
                            </span>
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            {c.name} · {formatIstDay(c.startDate)} – {formatIstDay(c.endDate)}
                          </span>
                          {c.warning && <span className="block text-[11px] text-amber-700">{c.warning}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Button & link */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="offer-cta" className="text-xs text-neutral-600">
                  Button label <span className="font-normal text-neutral-400">(optional)</span>
                </Label>
                <Counter value={values.ctaLabel} max={CTA_MAX} />
              </div>
              <Input
                id="offer-cta"
                className="h-10"
                value={values.ctaLabel}
                onChange={(e) => set("ctaLabel", e.target.value)}
                placeholder="e.g. Book now"
                aria-invalid={!!errors.ctaLabel}
              />
              <FieldError message={errors.ctaLabel} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-600">
                Link to <span className="font-normal text-neutral-400">(optional)</span>
              </Label>
              <Select
                value={values.linkTarget || NO_LINK}
                onValueChange={(v) => set("linkTarget", v === NO_LINK ? "" : v)}
                disabled={linksQuery.isLoading}
              >
                <SelectTrigger className="h-10 w-full" aria-invalid={!!errors.linkTarget}>
                  <SelectValue placeholder={linksQuery.isLoading ? "Loading vehicles…" : "No link"} />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} className="max-h-72">
                  <SelectItem value={NO_LINK}>No link — the vehicles list</SelectItem>
                  {storedLinkMissing && (
                    <SelectItem value={values.linkTarget}>Current link (no longer available)</SelectItem>
                  )}
                  {groups.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Make & model (any free car)</SelectLabel>
                        {groups.map((g) => (
                          <SelectItem key={g.groupKey} value={g.groupKey}>
                            {g.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  {vehicles.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>One specific car</SelectLabel>
                        {vehicles.map((v) => (
                          <SelectItem key={v.publicId} value={v.publicId}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
              <FieldError message={errors.linkTarget} />
              {linksQuery.isError && (
                <p className="text-xs text-neutral-500">Couldn't load the vehicles. Close and reopen to retry.</p>
              )}
              {!errors.linkTarget && (
                <p className="text-[11px] text-neutral-500">
                  {values.linkTarget
                    ? "The poster and its button open this vehicle."
                    : values.ctaLabel.trim()
                      ? "The button opens the vehicles list for this branch."
                      : "Without a label or link the poster has no button."}
                </p>
              )}
            </div>
          </section>

          {/* Schedule */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-neutral-600">
              Schedule <span className="font-normal text-neutral-400">(IST — a start in the past goes live right away)</span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="offer-start" className="text-xs text-neutral-500">
                  Starts
                </Label>
                <Input
                  id="offer-start"
                  type="datetime-local"
                  className="h-10"
                  value={values.startsAt}
                  onChange={(e) => {
                    set("startsAt", e.target.value);
                    setErrors((er) => ({ ...er, endsAt: undefined }));
                  }}
                  aria-invalid={!!errors.startsAt}
                />
                <FieldError message={errors.startsAt} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="offer-end" className="text-xs text-neutral-500">
                  Ends
                </Label>
                <Input
                  id="offer-end"
                  type="datetime-local"
                  className="h-10"
                  min={values.startsAt || undefined}
                  value={values.endsAt}
                  onChange={(e) => set("endsAt", e.target.value)}
                  aria-invalid={!!errors.endsAt}
                />
                <FieldError message={errors.endsAt} />
              </div>
            </div>
          </section>

          {/* Display */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-order" className="text-xs text-neutral-600">
                Order in the slider
              </Label>
              <Input
                id="offer-order"
                type="number"
                min={0}
                max={SORT_MAX}
                step={1}
                className="h-10 w-32"
                value={values.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                aria-invalid={!!errors.sortOrder}
              />
              <FieldError message={errors.sortOrder} />
              {!errors.sortOrder && <p className="text-[11px] text-neutral-500">Lower numbers show first.</p>}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-600">Visibility</p>
              <div className="flex h-10 items-center gap-2.5">
                <Switch checked={values.isActive} onChange={(v) => set("isActive", v)} label="Active" />
                <span className="text-sm text-neutral-700">
                  {values.isActive ? "Active — shows while scheduled" : "Off — hidden everywhere"}
                </span>
              </div>
              <FieldError message={errors.isActive} />
              {atLimit && values.isActive && !(isEdit && initial.isActive && offer?.status !== "EXPIRED") && (
                <p className="text-[11px] text-amber-700">
                  The branch already has {BRANCH_LIMIT} live or scheduled posters — save this one turned off, or turn
                  another off first.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
          <Button variant="outline" onClick={onClose} className="h-11 flex-1" disabled={saving}>
            Cancel
          </Button>
          <Button
            className="h-11 flex-1 bg-orange-500 text-white hover:bg-orange-600"
            onClick={submit}
            disabled={saving || checkingImage}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create poster"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerOffersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [formOffer, setFormOffer] = useState<ManagerOffer | null | undefined>(undefined); // undefined = closed, null = new
  const [deleteTarget, setDeleteTarget] = useState<ManagerOffer | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: OFFERS_KEY,
    queryFn: () => managerOffersService.list(),
  });

  const offers = data?.data ?? [];
  const counts = data?.counts;
  const shown = filter === "ALL" ? offers : offers.filter((o) => o.status === filter);
  const activeSlots = counts ? counts.LIVE + counts.SCHEDULED : 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
    queryClient.invalidateQueries({ queryKey: ["public-offers"] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ publicId, isActive }: { publicId: string; isActive: boolean }) =>
      managerOffersService.update(publicId, { isActive }),
    onMutate: ({ publicId }) => setTogglingId(publicId),
    onSuccess: (res) => {
      toast.success(res.data.isActive ? "Poster turned on." : "Poster turned off.");
      refresh();
    },
    onError: (err) => {
      toast.error(errorBody(err).message || "Couldn't update the poster. Please try again.");
    },
    onSettled: () => setTogglingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (publicId: string) => managerOffersService.remove(publicId),
    onSuccess: () => {
      toast.success("Poster deleted.");
      setDeleteTarget(null);
      refresh();
    },
    onError: (err) => {
      toast.error(errorBody(err).message || "Couldn't delete the poster. Please try again.");
    },
  });

  return (
    <ManagerLayout>
      <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-8 md:px-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Offers & banners</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 md:text-3xl">Offers & banners</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">
              Posters for the hero slider on the website and the app home screen. Add a coupon code customers can
              copy or carry to checkout, and link the poster to a car.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-9 gap-1.5 text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
            </Button>
            <Button
              className="h-9 gap-1.5 bg-orange-500 px-3 text-xs text-white hover:bg-orange-600"
              onClick={() => setFormOffer(null)}
            >
              <Plus className="h-3.5 w-3.5" /> New poster
            </Button>
          </div>
        </div>

        {/* Filters + capacity */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {FILTERS.map((f) => {
              const count = counts ? (f.value === "ALL" ? counts.total : counts[f.value]) : null;
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                  )}
                >
                  {f.label}
                  {count !== null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] tabular-nums",
                        active ? "bg-white/20 text-white" : "bg-white text-neutral-500",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {counts && (
            <p className={cn("text-xs", activeSlots >= BRANCH_LIMIT ? "font-medium text-amber-700" : "text-neutral-500")}>
              {activeSlots} of {BRANCH_LIMIT} live or scheduled posters
            </p>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <div className="aspect-[16/9] animate-pulse bg-neutral-100" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 text-center">
            <AlertTriangle className="mb-3 h-6 w-6 text-amber-500" />
            <p className="font-medium text-neutral-700">Couldn't load the posters</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
              <Megaphone className="h-6 w-6 text-neutral-400" />
            </div>
            {offers.length === 0 ? (
              <>
                <p className="font-medium text-neutral-700">No posters yet</p>
                <p className="mt-1 max-w-sm text-sm text-neutral-400">
                  Without posters the website and app show their standard hero image.
                </p>
                <Button
                  className="mt-4 gap-1.5 bg-orange-500 text-sm text-white hover:bg-orange-600"
                  onClick={() => setFormOffer(null)}
                >
                  <Plus className="h-4 w-4" /> New poster
                </Button>
              </>
            ) : (
              <p className="font-medium text-neutral-700">
                No {FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} posters
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((offer) => (
              <PosterCard
                key={offer.publicId}
                offer={offer}
                onEdit={() => setFormOffer(offer)}
                onDelete={() => setDeleteTarget(offer)}
                onToggleActive={(next) => toggleMutation.mutate({ publicId: offer.publicId, isActive: next })}
                toggling={togglingId === offer.publicId}
              />
            ))}
          </div>
        )}
      </div>

      {formOffer !== undefined && (
        <PosterFormDialog
          key={formOffer?.publicId ?? "new"}
          offer={formOffer}
          atLimit={activeSlots >= BRANCH_LIMIT}
          onClose={() => setFormOffer(undefined)}
          onSaved={() => {
            setFormOffer(undefined);
            refresh();
          }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          offer={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.publicId)}
          loading={deleteMutation.isPending}
        />
      )}
    </ManagerLayout>
  );
}
