import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import { vehicleShareUrl } from '../../constants/links';
import { useRequireAuth } from '../../lib/auth-gate';
import { useSavedStore } from '../../store/saved';
import DateRangePicker from '../../components/ui/DateRangePicker';
import TimeFieldPicker from '../../components/ui/TimeFieldPicker';
import ImageCarousel from '../../components/cars/ImageCarousel';
import { unitLabel, periodLabel, durationLabel } from '../../lib/pricing';
import { availabilityColor, availabilityLabel } from '../../lib/availability';
import {
  DURATION_PRESETS,
  activePresetHours,
  bookingWindowLastDay,
  initialRange,
  maxReturnFor,
  normalizeRange,
  presetRange,
  rangeLengthLabel,
  refreshRange,
  timeLabel,
  timeOf,
  withTime,
} from '../../lib/dates';
import { MAX_BOOKING_DAYS } from '../../lib/bookingWindow';
import { formatGstRate, gstLabel, inrExact, round2 } from '../../lib/gst';
import {
  bookingTimesNotice,
  closedDayText,
  fitBookingRange,
  isClosedDay,
  noPickupTimesLeft,
  rangeHoursLine,
  rangeScheduleIssue,
  slotsWithinHours,
} from '../../lib/branchSchedule';
import { useBranchSchedule } from '../../hooks/useBranchSchedule';
import DurationChips from '../../components/ui/DurationChips';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import { paymentOptionsFor, serverPaymentOptions } from '../../lib/paymentPlan';
import { quoteDiscountLines } from '../../lib/discounts';
import type { VehicleDetail } from '../../types/api';

const { width, height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.38;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TRIP_TYPE_LABELS: Record<string, string> = {
  HIGHWAY: 'Highway',
  HILL_STATION: 'Hill Station',
  LONG_DRIVE: 'Long Drive',
};

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// "12 Jul | 6:05 PM"
function fmtStamp(d: Date) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} | ${timeLabel(timeOf(d))}`;
}

// Sixt-style vehicle page: hero image, green-check inclusions, big uppercase
// title, "category | branch" line, real-data spec grid, payment options and a
// sticky Book-now bar. All facts come from the API — nothing invented.
export default function VehicleDetail() {
  // `branch`: the searched branch, used for office hours until the vehicle
  // payload (whose branchPublicId wins) has loaded or when a cached one lacks it.
  const { id, start: startParam, end: endParam, branch: branchParam } = useLocalSearchParams<{
    id: string; start?: string; end?: string; branch?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [showPicker, setShowPicker] = useState(false);
  // Search params win; otherwise pickup today at the next 5-minute mark and
  // return 24 hours later. normalizeRange keeps the return after the pickup.
  const [range, setRange] = useState(() => initialRange(startParam, endParam));
  const { start: startDate, end: endDate } = range;

  // Coming back from checkout (or the background) can leave the pickup in the
  // past. While focused — on focus, on return to the foreground and every
  // 15s — move a past pickup to the next 5-minute mark (and the return after
  // it). A pickup still in the future is left untouched.
  useFocusEffect(
    useCallback(() => {
      const refresh = () => setRange((r) => refreshRange(r));
      refresh();
      const timer = setInterval(refresh, 15_000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, []),
  );
  const [timePicker, setTimePicker] = useState<null | 'start' | 'end'>(null);
  const toggle = useSavedStore(s => s.toggle);
  const savedList = useSavedStore(s => s.saved);
  // Browsing this page is public; only the booking action needs an account.
  const requireAuth = useRequireAuth();

  const isGroupKey = !!id && id.includes('__');
  const rangeLength = rangeLengthLabel(startDate, endDate) ?? '';

  const { data: vehicle, isLoading, isFetching } = useQuery({
    queryKey: ['vehicle', id, startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      isGroupKey
        ? vehiclesApi.groupDetail(id!, { start: startDate.toISOString(), end: endDate.toISOString() })
        : vehiclesApi.detail(id!, { start: startDate.toISOString(), end: endDate.toISOString() }),
    select: (res) => {
      const d = res.data.data as any;
      if (!isGroupKey) return { ...d, advancePayAmount: Number(d.advancePayAmount ?? 0) } as VehicleDetail;
      return {
        publicId: d.groupKey,
        make: d.make,
        model: d.model,
        category: d.category,
        branch: d.branch,
        availableCount: d.availableCount,
        useCases: Array.isArray(d.useCases) ? d.useCases : [],
        images: d.images ?? [],
        pricing: { daily: d.pricing?.daily ?? null },
        availability: d.availability,
        status: 'AVAILABLE',
        deposit: d.deposit ?? 0,
        advancePayAmount: Number(d.advancePayAmount ?? 0),
        // Branch payment plan (#6) — the group branch used to drop these.
        customerPaymentMode: d.customerPaymentMode,
        paymentOptions: d.paymentOptions ?? null,
        pricingDetails: d.pricingDetails ?? null,
        branchPublicId: d.branchPublicId ?? null,
      } as VehicleDetail;
    },
    enabled: !!id,
  });

  // Office hours (#2) + the 15-day limit (#15): the pickers offer only times
  // the branch accepts, and a range that lands outside them is moved back in.
  const branchPublicId = vehicle?.branchPublicId ?? branchParam ?? null;
  const { data: schedule } = useBranchSchedule(branchPublicId);
  const fit = useCallback(
    (r: { start: Date; end: Date }) => fitBookingRange(r, { config: schedule, maxEnd: (s) => maxReturnFor(s) }),
    [schedule],
  );
  useEffect(() => {
    setRange((r) => fit(r));
  }, [fit, range]);
  const timesNotice = bookingTimesNotice(schedule, startDate, endDate);
  const presetIssue = (hours: number) => {
    const next = presetRange(startDate, hours);
    if (next.end.getTime() > maxReturnFor(startDate).getTime()) return `past the ${MAX_BOOKING_DAYS}-day booking limit`;
    return rangeScheduleIssue(schedule, next.start, next.end);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

  if (!vehicle) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Car not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasImages = (vehicle.images?.length ?? 0) > 0;
  const isAvail = vehicle.availability !== false;
  const saved = savedList.some(v => v.publicId === vehicle.publicId);
  const pd = vehicle.pricingDetails;
  const pb = pd?.pricingBreakdown;
  const realPeriodLabel = pb ? periodLabel(pb.periodType) : null;
  const realDuration = pb ? durationLabel(pb.duration) : null;
  // What the price covers (#5): an 8 h trip may be billed as "12 hours", a 13 h
  // one as "1 day", a 26 h one as "1 day + 2 hours". Absent on cached payloads.
  const billedAs = pb?.billedAs ?? null;
  const underDay = endDate.getTime() - startDate.getTime() < 24 * 3_600_000;
  const periodText = billedAs
    ? underDay && realDuration && realDuration !== billedAs
      ? `${realDuration} · billed as ${billedAs}`
      : billedAs
    : realPeriodLabel
    ? `${realPeriodLabel}${realDuration ? ` · ${realDuration}` : ''}`
    : rangeLength;
  const unitPrice = pb ? Math.round(pb.applicablePrice) : (vehicle.pricing?.daily ?? null);
  // applicablePrice is the period TOTAL, so pair it with what it covers.
  const unit = pb ? (billedAs ? `for ${billedAs}` : unitLabel(pb.periodType)) : '/day';
  const total = pd ? pd.finalTotal + pd.deposit : null;

  // Green check lines — real rate terms only.
  const checks: string[] = [];
  if (pd?.freeKmLimit) checks.push(`${pd.freeKmLimit} km included`);
  if (pd?.deposit) checks.push(`₹${pd.deposit.toLocaleString('en-IN')} refundable deposit`);

  // Spec grid — only fields the API actually returns.
  const specs: { icon: IoniconName; label: string }[] = [];
  if (typeof vehicle.availableCount === 'number') specs.push({ icon: 'car-outline', label: `${vehicle.availableCount} available` });
  if (vehicle.category) specs.push({ icon: 'grid-outline', label: vehicle.category });
  if (vehicle.branch) specs.push({ icon: 'location-outline', label: vehicle.branch });
  if (pd?.freeKmLimit) specs.push({ icon: 'speedometer-outline', label: `${pd.freeKmLimit} km included` });
  if (pd?.extraKmRate) specs.push({ icon: 'navigate-outline', label: `₹${pd.extraKmRate}/km after limit` });
  // GST is charged on top of the rental (after discounts), not included in it.
  if (pd?.taxRate) specs.push({ icon: 'receipt-outline', label: `+${formatGstRate(pd.taxRate) ?? `${pd.taxRate}%`} GST` });

  // Payment plans this branch offers for these amounts (#6) — the server's
  // paymentOptions (same rules checkout and booking create use).
  const payOptions = paymentOptionsFor(serverPaymentOptions(vehicle.paymentOptions), {
    mode: vehicle.customerPaymentMode,
    advanceAmount: vehicle.advancePayAmount ?? 0,
    payableTotal: total,
  });
  const advance = payOptions.advanceAmount;
  const offersFull = payOptions.allowedFlows.includes('FULL');
  const offersAdvance = payOptions.allowedFlows.includes('ADVANCE');
  const dueAtPickup = payOptions.remainingAfterAdvance ?? (total != null ? round2(total - advance) : null);

  const avColor = vehicle.availability === null
    ? Colors.onDarkMuted
    : isAvail
    ? availabilityColor(vehicle.availableCount ?? 99)
    : Colors.availNone;
  const avLabel = vehicle.availability === null
    ? 'Checking…'
    : isAvail
    ? availabilityLabel(vehicle.availableCount) ?? 'Available'
    : 'Unavailable';

  return (
    <View style={styles.root}>
      {isFocused ? <StatusBar style="light" /> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={[styles.hero, { height: HERO_HEIGHT }]}>
          {hasImages ? (
            <ImageCarousel images={vehicle.images} style={StyleSheet.absoluteFillObject} />
          ) : (
            <LinearGradient colors={['#2b303a', '#181b21', '#0f1116']} style={StyleSheet.absoluteFillObject}>
              <View style={styles.heroPlaceholder}>
                <Ionicons name="car-sport-outline" size={64} color="rgba(255,255,255,0.16)" />
              </View>
            </LinearGradient>
          )}

          <View style={[styles.heroTop, { top: insets.top + 12 }]}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} hitSlop={8} activeOpacity={0.85}>
              <Ionicons name="arrow-back" size={20} color={Colors.white} />
            </TouchableOpacity>
            <View style={styles.heroTopRight}>
              <TouchableOpacity
                style={[styles.iconBtn, saved && styles.iconBtnSaved]}
                hitSlop={8}
                activeOpacity={0.85}
                onPress={() => toggle({
                  publicId: vehicle.publicId,
                  make: vehicle.make,
                  model: vehicle.model,
                  category: vehicle.category,
                  branch: vehicle.branch,
                  images: vehicle.images,
                  pricing: vehicle.pricing,
                  availability: vehicle.availability,
                  availableCount: vehicle.availableCount,
                })}
              >
                <Ionicons
                  name={saved ? 'heart' : 'heart-outline'}
                  size={20}
                  color={saved ? '#e53e3e' : Colors.white}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                hitSlop={8}
                activeOpacity={0.85}
                onPress={() => {
                  const shareUrl = vehicleShareUrl(id);
                  // `url` is iOS-only, so the link also goes in the message for Android.
                  Share.share({
                    title: `${vehicle.make} ${vehicle.model}`,
                    message: `Check out this ${vehicle.make} ${vehicle.model} at WUW Rentals — ${vehicle.branch}!${unitPrice != null ? ` From ₹${unitPrice.toLocaleString('en-IN')} ${unit}.` : ''}\n${shareUrl}`,
                    url: shareUrl,
                  });
                }}
              >
                <Ionicons name="share-outline" size={20} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Green check inclusions ── */}
        {checks.length > 0 ? (
          <View style={styles.checkStrip}>
            {checks.map((c) => (
              <View key={c} style={styles.checkRow}>
                <Ionicons name="checkmark" size={18} color={Colors.availGood} />
                <Text style={styles.checkText}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Title block ── */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{vehicle.make} {vehicle.model}</Text>
          <Text style={styles.titleSub}>
            {[vehicle.category, vehicle.branch].filter(Boolean).join(' | ')}
          </Text>
          {(vehicle.useCases ?? []).length > 0 ? (
            <View style={styles.tripRow}>
              {(vehicle.useCases ?? []).map((u) => (
                <View key={u} style={styles.tripChip}>
                  <Text style={styles.tripChipText}>{TRIP_TYPE_LABELS[u] ?? u}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Spec grid (real fields only) ── */}
        {specs.length > 0 ? (
          <View style={styles.specGrid}>
            {specs.map((s) => (
              <View key={s.label} style={styles.specItem}>
                <Ionicons name={s.icon} size={19} color={Colors.onDark} />
                <Text style={styles.specText} numberOfLines={2}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Itinerary — tap dates for calendar, times for time picker ── */}
        <TouchableOpacity style={styles.itinCard} onPress={() => setShowPicker(true)} activeOpacity={0.85}>
          <View style={styles.itinHalf}>
            <Text style={styles.itinLabel}>PICKUP</Text>
            <Text style={styles.itinValue}>{fmtStamp(startDate)}</Text>
            <TouchableOpacity onPress={() => setTimePicker('start')} hitSlop={8}>
              <Text style={styles.itinTimeLink}>Change time</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.itinDivider} />
          <View style={styles.itinHalf}>
            <Text style={styles.itinLabel}>RETURN</Text>
            <Text style={styles.itinValue}>{fmtStamp(endDate)}</Text>
            <TouchableOpacity onPress={() => setTimePicker('end')} hitSlop={8}>
              <Text style={styles.itinTimeLink}>Change time</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.itinEdit}>
            <Ionicons name="pencil" size={16} color={Colors.white} />
          </View>
        </TouchableOpacity>

        {/* Quick lengths (#5) + branch hours (#2) */}
        <View style={styles.itinExtras}>
          <DurationChips
            tone="dark"
            presets={DURATION_PRESETS}
            activeHours={activePresetHours(startDate, endDate)}
            issueFor={presetIssue}
            onSelect={(h) => setRange((r) => presetRange(r.start, h))}
          />
          <BranchHoursLine tone="dark" text={rangeHoursLine(schedule, startDate, endDate)} />
          <TimesNotice tone="dark" notice={timesNotice} />
        </View>

        {/* Period + availability */}
        <View style={styles.badgeRow}>
          <View style={styles.periodBadge}>
            <Ionicons name="time-outline" size={12} color={Colors.onDarkMuted} />
            <Text style={styles.periodText}>{periodText}</Text>
          </View>
          <View style={[styles.availBadge, { backgroundColor: avColor + '1f', borderColor: avColor + '40' }]}>
            <View style={[styles.availDot, { backgroundColor: avColor }]} />
            <Text style={[styles.availText, { color: avColor }]}>{avLabel}</Text>
          </View>
          {isFetching && !isLoading && <ActivityIndicator size="small" color={Colors.orange} />}
        </View>

        {/* ── Pricing breakdown ── */}
        {pd ? (
          <>
            <Text style={styles.sectionTitle}>Pricing breakdown</Text>
            <View style={styles.darkCard}>
              {/* Base → discount → taxable value → CGST/SGST → deposit (no GST) → total (#23) */}
              <PriceLine label={`Base rate (${billedAs ?? realDuration ?? rangeLength})`} value={inrExact(pd.basePrice)} />
              {/* Duration slab named (#24), e.g. "Weekly discount (10%)" */}
              {quoteDiscountLines(pd).map((l) => (
                <PriceLine key={l.label} label={l.label} value={`-${inrExact(l.amount)}`} valueColor={Colors.availGood} />
              ))}
              {pd.discountAmount > 0 && (
                <PriceLine label="Taxable value" value={inrExact(round2(pd.basePrice - pd.discountAmount))} />
              )}
              {pd.taxAmount > 0 && (pd.cgstAmount > 0 || pd.sgstAmount > 0) ? (
                <>
                  <PriceLine label={gstLabel('CGST', pd.cgstRate)} value={inrExact(pd.cgstAmount)} />
                  <PriceLine label={gstLabel('SGST', pd.sgstRate)} value={inrExact(pd.sgstAmount)} />
                </>
              ) : (
                <PriceLine label={gstLabel('GST', pd.taxRate)} value={inrExact(pd.taxAmount)} />
              )}
              <PriceLine label="Deposit (refundable, no GST)" value={inrExact(pd.deposit)} />
              <View style={styles.priceDivider} />
              <PriceLine label="Total" value={inrExact(round2(pd.finalTotal + pd.deposit))} bold />
            </View>
          </>
        ) : (
          <View style={styles.noPriceHint}>
            <Ionicons name="calendar-outline" size={20} color={Colors.onDarkMuted} />
            <Text style={styles.noPriceText}>Select dates above to see pricing</Text>
          </View>
        )}

        {/* ── Payment options — only the plans the branch allows for this total (#6) ── */}
        {total != null ? (
          <>
            <Text style={styles.sectionTitle}>Payment options</Text>
            <View style={styles.darkCard}>
              {offersFull ? (
                <View style={styles.payRow}>
                  <Ionicons name="card-outline" size={20} color={Colors.onDark} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle}>Pay in full</Text>
                    <Text style={styles.paySub}>{inrExact(total)} now · deposit included</Text>
                  </View>
                </View>
              ) : null}
              {offersFull && offersAdvance ? <View style={styles.priceDivider} /> : null}
              {offersAdvance ? (
                <View style={styles.payRow}>
                  <Ionicons name="time-outline" size={20} color={Colors.onDark} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle}>Reserve with advance</Text>
                    <Text style={styles.paySub}>
                      {inrExact(advance)} now{dueAtPickup != null ? ` · ${inrExact(dueAtPickup)} at pickup` : ''}
                    </Text>
                  </View>
                </View>
              ) : null}
              {payOptions.reasonMessage ? (
                <Text style={styles.payReason}>{payOptions.reasonMessage}</Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.ctaLeft}>
          {pd ? (
            <>
              <Text style={styles.ctaPrice}>₹{(pd.finalTotal + pd.deposit).toLocaleString('en-IN')}</Text>
              <Text style={styles.ctaNote}>total · {realDuration ?? rangeLength}</Text>
            </>
          ) : unitPrice != null ? (
            <>
              <Text style={styles.ctaPrice}>₹{unitPrice.toLocaleString('en-IN')}</Text>
              <Text style={styles.ctaNote}>{unit} · select dates</Text>
            </>
          ) : (
            <Text style={styles.ctaNote}>Select dates to see price</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, !isAvail && styles.ctaBtnDisabled]}
          onPress={() => {
            // Guests browse freely — the sign-in ask happens here, at the
            // moment they commit to booking, and returns them to this car.
            if (!requireAuth({ returnTo: `/vehicle/${id}` })) return;
            // The page may have sat open past its pickup time — bump it first.
            const next = fit(normalizeRange(startDate, endDate));
            setRange(next);
            // Times the server would refuse (15-day limit, pickup outside
            // branch hours) — say so here instead of after checkout.
            const blocking = bookingTimesNotice(schedule, next.start, next.end);
            if (blocking?.tone === 'error') {
              Alert.alert('Change your times', blocking.text);
              return;
            }
            router.push({
              pathname: '/booking/checkout',
              params: {
                vehicleId: vehicle.publicId,
                start: next.start.toISOString(),
                end: next.end.toISOString(),
                ...(branchPublicId ? { branch: branchPublicId } : {}),
              },
            });
          }}
          disabled={!isAvail}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaBtnText}>{isAvail ? 'Book now' : 'Unavailable'}</Text>
          {isAvail && <Ionicons name="arrow-forward" size={16} color={Colors.white} />}
        </TouchableOpacity>
      </View>

      {/* Date picker — preserve the chosen times when dates change */}
      <DateRangePicker
        visible={showPicker}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => setRange((r) => normalizeRange(withTime(s, timeOf(r.start)), withTime(e, timeOf(r.end))))}
        onClose={() => setShowPicker(false)}
        maxStartDay={bookingWindowLastDay()}
        isDayClosed={schedule ? (d) => isClosedDay(schedule, d) : undefined}
        noPickupTimes={schedule ? (d) => noPickupTimesLeft(schedule, d) : undefined}
        note={`Bookings open up to ${MAX_BOOKING_DAYS} days ahead`}
      />

      {/* Time picker — today lists only future times; a same-day return only
          times after the pickup; both only inside branch hours and the 15-day limit */}
      <TimeFieldPicker
        visible={timePicker !== null}
        value={timePicker === 'end' ? timeOf(endDate) : timeOf(startDate)}
        slots={
          timePicker === 'end'
            ? slotsWithinHours(endDate, schedule, 'return', { after: startDate, before: maxReturnFor(startDate) })
            : slotsWithinHours(startDate, schedule, 'pickup')
        }
        emptyText={closedDayText(schedule, timePicker === 'end' ? endDate : startDate)}
        title={timePicker === 'end' ? 'Return time' : 'Pickup time'}
        onSelect={(t) => {
          if (timePicker === 'end') setRange((r) => normalizeRange(r.start, withTime(r.end, t)));
          else setRange((r) => normalizeRange(withTime(r.start, t), r.end));
        }}
        onClose={() => setTimePicker(null)}
      />
    </View>
  );
}

function PriceLine({ label, value, bold, valueColor }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  return (
    <View style={styles.priceLine}>
      <Text style={[styles.priceLineLabel, bold && styles.priceLineLabelBold]}>{label}</Text>
      <Text style={[styles.priceLineValue, bold && styles.priceLineValueBold, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgDark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgDark },
  errorText: { fontFamily: Fonts.display, fontSize: 18, color: Colors.white },
  backLink: { marginTop: 12 },
  backLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.orange },

  scroll: { flex: 1 },

  hero: { width, overflow: 'hidden', backgroundColor: '#111' },
  heroPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroTop: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  heroTopRight: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnSaved: {
    backgroundColor: 'rgba(229,62,62,0.2)',
    borderColor: 'rgba(229,62,62,0.4)',
  },

  checkStrip: { paddingHorizontal: 20, paddingTop: 16, gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.onDark },

  titleBlock: { paddingHorizontal: 20, paddingTop: 18 },
  title: {
    fontFamily: Fonts.displayBold, fontSize: 32, lineHeight: 37,
    color: Colors.white, letterSpacing: -0.6, textTransform: 'uppercase',
  },
  titleSub: { fontFamily: Fonts.body, fontSize: 16, color: Colors.onDarkMuted, marginTop: 8 },

  specGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 20, paddingTop: 20, rowGap: 16,
  },
  specItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 12 },
  tripRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tripChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  tripChipText: { fontFamily: Fonts.bodyMedium, fontSize: 12.5, color: Colors.orange },
  specText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 14.5, color: Colors.onDark },

  itinCard: {
    marginHorizontal: 16, marginTop: 24,
    backgroundColor: Colors.surfaceDark, borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
  },
  itinHalf: { flex: 1, padding: 16 },
  itinDivider: { width: 1, height: 56, backgroundColor: Colors.hairlineOnDark },
  itinLabel: { fontFamily: Fonts.bodyMedium, fontSize: 9, color: Colors.onDarkMuted, letterSpacing: 0.9, marginBottom: 5 },
  itinValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14.5, color: Colors.white },
  itinTimeLink: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.orange, marginTop: 5 },
  itinEdit: { paddingHorizontal: 14 },
  itinExtras: { marginHorizontal: 16, marginTop: 12, gap: 10 },

  badgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, marginTop: 12,
  },
  periodBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surfaceDark, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  periodText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.onDarkMuted },
  availBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  availDot: { width: 6, height: 6, borderRadius: 3 },
  availText: { fontFamily: Fonts.bodyMedium, fontSize: 12 },

  sectionTitle: {
    fontFamily: Fonts.displayBold, fontSize: 19, color: Colors.white,
    letterSpacing: -0.4, paddingHorizontal: 20, marginTop: 28, marginBottom: 14,
  },
  darkCard: {
    marginHorizontal: 16, backgroundColor: Colors.surfaceDark,
    borderRadius: 18, padding: 18, gap: 2,
  },

  priceLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 7,
  },
  priceLineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.onDarkMuted },
  priceLineLabelBold: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
  priceLineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.onDark },
  priceLineValueBold: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.white, letterSpacing: -0.5 },
  priceDivider: { height: 1, backgroundColor: Colors.hairlineOnDark, marginVertical: 6 },

  noPriceHint: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 24,
    backgroundColor: Colors.surfaceDark, borderRadius: 14, padding: 16,
  },
  noPriceText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.onDarkMuted },

  payRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  payTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
  paySub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.onDarkMuted, marginTop: 2 },
  payReason: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.onDarkMuted, lineHeight: 17, marginTop: 6 },

  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surfaceDark,
    borderTopWidth: 1, borderTopColor: Colors.hairlineOnDark,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14,
  },
  ctaLeft: { flex: 1, marginRight: 16 },
  ctaPrice: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.white, letterSpacing: -0.6 },
  ctaNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.onDarkMuted, marginTop: 2 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 16,
    paddingVertical: 15, paddingHorizontal: 24,
  },
  ctaBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.18)' },
  ctaBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white, letterSpacing: 0.2 },
});
