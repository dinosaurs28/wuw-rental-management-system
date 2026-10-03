import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import useEmblaCarousel from "embla-carousel-react";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Pause, Play, Ticket } from "lucide-react";
import { offersPublicService, type PublicOffer } from "@/services/offers.service";
import { useSearchStore } from "@/store/search.store";
import { useOfferCouponStore } from "@/store/offerCoupon.store";
import { copyText, formatIstDay, formatOfferDiscount, offerHref } from "@/lib/offers";
import { cn } from "@/lib/utils";

// Landing hero (#15): live offer posters as an auto-advancing slider (5 s,
// swipe, dots; pauses on hover, keyboard focus and touch), or the static hero
// when there are none / the request fails.
//
// Vertical budget: the fixed navbar covers the top 96 px and the search widget
// is pulled up over the bottom 128 / 144 / 160 px (LandingPage), so slide
// content lives between those, with a 32 px band above the widget for the dots.

const AUTOPLAY_MS = 5000;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function HeroOfferSlider({ fallback }: { fallback: ReactNode }) {
  const branchPublicId = useSearchStore((s) => s.branchPublicId);
  const { data, isError } = useQuery({
    queryKey: ["public-offers", branchPublicId ?? "all"],
    queryFn: () => offersPublicService.list(branchPublicId),
    staleTime: 60_000,
    retry: 1,
    // Switching branch in the search form keeps the current slides until the new list arrives
    placeholderData: keepPreviousData,
  });

  const offers = data?.data ?? [];
  if (isError || offers.length === 0) return <>{fallback}</>;
  // A new set of posters remounts the slider so its index and timer start clean
  return <OfferSlider key={offers.map((o) => o.publicId).join("|")} offers={offers} />;
}

function OfferSlider({ offers }: { offers: PublicOffer[] }) {
  const multiple = offers.length > 1;
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: multiple, active: multiple, duration: 28 });
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Bumped on every touch / click inside the hero so the 5 s wait starts over
  const [touchTick, setTouchTick] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    const onDown = () => setDragging(true);
    const onUp = () => setDragging(false);
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    emblaApi.on("pointerDown", onDown);
    emblaApi.on("pointerUp", onUp);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
      emblaApi.off("pointerDown", onDown);
      emblaApi.off("pointerUp", onUp);
    };
  }, [emblaApi]);

  const paused = !playing || hovered || keyboardFocus || dragging;

  useEffect(() => {
    if (!emblaApi || !multiple || paused) return;
    const timer = window.setTimeout(() => emblaApi.scrollNext(), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [emblaApi, multiple, paused, selected, touchTick]);

  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  return (
    <section
      className="relative w-full h-[65vh] min-h-[500px] overflow-hidden bg-[#1A1A1A]"
      aria-roledescription="carousel"
      aria-label="Offers"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      onPointerDownCapture={() => setTouchTick((t) => t + 1)}
      onFocus={(e) => {
        if (e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setKeyboardFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
      onKeyDown={(e) => {
        if (!multiple) return;
        if (e.key === "ArrowLeft") emblaApi?.scrollPrev();
        if (e.key === "ArrowRight") emblaApi?.scrollNext();
      }}
    >
      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex h-full touch-pan-y">
          {offers.map((offer, i) => (
            <OfferSlide
              key={offer.publicId}
              offer={offer}
              index={i}
              total={offers.length}
              active={i === selected}
            />
          ))}
        </div>
      </div>

      {/* Polite announcements only while the slider is still (no chatter during autoplay) */}
      <p className="sr-only" aria-live={paused ? "polite" : "off"} aria-atomic="true">
        {`Offer ${selected + 1} of ${offers.length}: ${offers[selected]?.title ?? ""}`}
      </p>

      {multiple && (
        <div className="pointer-events-none absolute inset-x-0 z-10 bottom-[136px] sm:bottom-[152px] md:bottom-[172px]">
          <div className="max-w-[1300px] mx-auto px-4 md:px-6 lg:px-12 flex items-center justify-center md:justify-start gap-2">
            <button
              type="button"
              onClick={() => emblaApi?.scrollPrev()}
              aria-label="Previous offer"
              className="pointer-events-auto hidden md:inline-flex size-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F00]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="pointer-events-auto flex items-center">
              {offers.map((offer, i) => (
                <button
                  key={offer.publicId}
                  type="button"
                  onClick={() => scrollTo(i)}
                  aria-label={`Show offer ${i + 1}: ${offer.title}`}
                  aria-current={i === selected ? "true" : undefined}
                  className="group/dot flex h-8 items-center px-1 focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-all duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-[#FF5F00] group-focus-visible/dot:ring-offset-1 group-focus-visible/dot:ring-offset-black",
                      i === selected ? "w-6 bg-[#FF5F00]" : "w-1.5 bg-white/55 group-hover/dot:bg-white/90",
                    )}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => emblaApi?.scrollNext()}
              aria-label="Next offer"
              className="pointer-events-auto hidden md:inline-flex size-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F00]"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause offers" : "Play offers"}
              className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F00]"
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function OfferSlide({
  offer,
  index,
  total,
  active,
}: {
  offer: PublicOffer;
  index: number;
  total: number;
  active: boolean;
}) {
  const navigate = useNavigate();
  const setSearchCriteria = useSearchStore((s) => s.setSearchCriteria);
  const hasCta = !!(offer.ctaLabel || offer.linkTarget);
  const ctaLabel = offer.ctaLabel ?? "View vehicle";
  const href = offerHref(offer.linkType, offer.linkTarget);

  const openLink = () => {
    // No vehicle link: the vehicles list, scoped to the poster's branch
    if (!offer.linkTarget && offer.branch) {
      setSearchCriteria({ branchPublicId: offer.branch.publicId });
    }
    navigate(href);
  };

  const coupon = offer.couponCode && offer.coupon ? offer.coupon : null;
  const eager = index === 0;

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
      inert={!active}
      className="relative h-full min-w-0 flex-[0_0_100%] overflow-hidden"
    >
      {/* Ambient backdrop: the poster itself, blurred and dimmed */}
      <img
        src={offer.imageUrl}
        alt=""
        aria-hidden="true"
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-[0.5] saturate-150"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-black/50 md:bg-gradient-to-r md:from-black/80 md:via-black/45 md:to-black/15" />

      <div className="relative mx-auto flex h-full max-w-[1300px] flex-col gap-2.5 px-4 pt-[108px] pb-[172px] md:pt-[112px] sm:pb-[188px] md:flex-row md:items-center md:gap-10 md:px-6 md:pb-[216px] lg:gap-14 lg:px-12">
        {/* Copy */}
        <div className="relative flex shrink-0 flex-col gap-2 text-white md:w-[46%] md:gap-3 lg:w-[44%]">
          <p className="hidden items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF7A2E] md:flex">
            <span className="h-[2px] w-6 bg-[#FF5F00]" />
            {offer.branch ? `Offer · ${offer.branch.name}` : "Offer"}
          </p>
          {/* Title size follows the viewport height so short laptop screens still fit */}
          <h2 className="line-clamp-2 text-[22px] font-black uppercase leading-[1.02] tracking-tighter text-balance sm:text-[28px] md:text-[clamp(1.75rem,4.2vh,2.75rem)] md:leading-[0.98]">
            {offer.title}
          </h2>
          {coupon && (
            <p className="truncate text-xs font-semibold text-white/75 md:hidden [@media(max-height:700px)]:hidden">
              {formatOfferDiscount(coupon)} · Valid till {formatIstDay(coupon.validUntil)}
            </p>
          )}
          {offer.subtitle && (
            <p className="hidden text-base font-semibold leading-snug text-white/80 lg:text-lg md:[@media(min-height:861px)]:line-clamp-2">
              {offer.subtitle}
            </p>
          )}

          {/* Desktop actions */}
          {(coupon || hasCta) && (
            <div className="hidden flex-wrap items-center gap-2.5 pt-1 md:flex">
              {coupon && <CouponTicket code={coupon.code} />}
              {coupon && (
                <UseCodeButton code={coupon.code} validUntil={coupon.validUntil} offerTitle={offer.title} />
              )}
              {hasCta && (
                <button
                  type="button"
                  onClick={openLink}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    coupon
                      ? "bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20"
                      : "bg-[#FF5F00] text-white hover:bg-[#E55500]",
                  )}
                >
                  <span className="max-w-[16rem] truncate">{ctaLabel}</span>
                  <ArrowRight className="size-4 shrink-0" />
                </button>
              )}
            </div>
          )}
          {coupon && (
            <p className="hidden text-xs font-medium text-white/70 md:block">
              {formatOfferDiscount(coupon)} · Valid till {formatIstDay(coupon.validUntil)}
            </p>
          )}
        </div>

        {/* Poster — always shown whole (letterboxed onto its own backdrop) */}
        <div className="relative min-h-0 flex-1 self-stretch">
          <div className="absolute inset-0 flex items-center justify-center md:justify-end">
            <img
              src={offer.imageUrl}
              alt={offer.title}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onClick={hasCta ? openLink : undefined}
              className={cn(
                "h-auto max-h-full w-auto max-w-full select-none rounded-2xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] ring-1 ring-white/10",
                hasCta && "cursor-pointer",
              )}
            />
          </div>
        </div>

        {/* Mobile actions (positioned so the poster's shadow can't paint over them) */}
        {(coupon || hasCta) && (
          <div className="relative flex min-w-0 items-center gap-2 md:hidden">
            {coupon && <CouponTicket code={coupon.code} compact />}
            {coupon && (
              <UseCodeButton code={coupon.code} validUntil={coupon.validUntil} offerTitle={offer.title} compact />
            )}
            {hasCta &&
              (coupon ? (
                <button
                  type="button"
                  onClick={openLink}
                  aria-label={ctaLabel}
                  className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30"
                >
                  <ArrowRight className="size-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openLink}
                  className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-[#FF5F00] px-4 text-xs font-bold uppercase tracking-wider text-white"
                >
                  <span className="truncate">{ctaLabel}</span>
                  <ArrowRight className="size-3.5 shrink-0" />
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Dashed "ticket" with the code and a Copy button. */
function CouponTicket({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      toast.success(`Code ${code} copied`);
    } else {
      toast.error("Couldn't copy the code — please note it down.");
    }
  };

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-stretch overflow-hidden rounded-xl border-2 border-dashed border-white/45 bg-white/10 text-white backdrop-blur-sm",
        compact ? "h-9" : "h-11",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 font-mono font-black tracking-wider",
          compact ? "px-2.5 text-sm" : "px-3.5 text-base",
        )}
      >
        <Ticket className={cn("shrink-0 text-[#FF7A2E]", compact ? "size-3.5" : "size-4")} />
        <span className={cn("truncate", compact ? "max-w-[7.5rem]" : "max-w-[12rem]")}>{code}</span>
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? `Code ${code} copied` : `Copy code ${code}`}
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-l-2 border-dashed border-white/35 font-semibold transition-colors hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-none",
          compact ? "px-2.5" : "px-3.5 text-sm",
        )}
      >
        {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
        {!compact && <span>{copied ? "Copied" : "Copy"}</span>}
      </button>
    </div>
  );
}

/** Saves the code for the checkout coupon field (it is validated there as usual). */
function UseCodeButton({
  code,
  validUntil,
  offerTitle,
  compact = false,
}: {
  code: string;
  validUntil: string;
  offerTitle: string;
  compact?: boolean;
}) {
  const savedCode = useOfferCouponStore((s) => s.code);
  const saveCode = useOfferCouponStore((s) => s.saveCode);
  const saved = savedCode === code;

  return (
    <button
      type="button"
      onClick={() => {
        saveCode(code, { validUntil, offerTitle });
        toast.success(`${code} saved for checkout`, {
          description: "Pick your car and dates — the code is filled in and checked at checkout.",
        });
      }}
      aria-pressed={saved}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        compact ? "h-9 px-3.5 text-xs" : "h-11 px-5 text-sm",
        saved ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-[#FF5F00] text-white hover:bg-[#E55500]",
      )}
    >
      {saved && <Check className={compact ? "size-3.5" : "size-4"} />}
      {saved ? "Saved" : "Use code"}
    </button>
  );
}
