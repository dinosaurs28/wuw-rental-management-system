import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import { useSavedStore } from '../../store/saved';
import DateRangePicker from '../../components/ui/DateRangePicker';
import TimeFieldPicker from '../../components/ui/TimeFieldPicker';
import ImageCarousel from '../../components/cars/ImageCarousel';
import { unitLabel, periodLabel, durationLabel } from '../../lib/pricing';
import { availabilityColor, availabilityLabel } from '../../lib/availability';
import type { VehicleDetail } from '../../types/api';

const { width, height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.38;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// "12 Jul | 12:00"
function fmtStamp(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} | ${hh}:${mm}`;
}

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}
function defaultEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return d;
}
function parseParamDate(iso: string | undefined, fallback: () => Date): Date {
  if (!iso) return fallback();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? fallback() : d;
}

// Combine a date with a "HH:mm" time string into a new Date.
function withTime(date: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h ?? 10, m ?? 0, 0, 0);
  return d;
}
function timeOf(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Sixt-style vehicle page: hero image, green-check inclusions, big uppercase
// title, "category | branch" line, real-data spec grid, payment options and a
// sticky Book-now bar. All facts come from the API — nothing invented.
export default function VehicleDetail() {
  const { id, start: startParam, end: endParam } = useLocalSearchParams<{ id: string; start?: string; end?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [showPicker, setShowPicker] = useState(false);
  const [startDate, setStartDate] = useState<Date>(() => parseParamDate(startParam, defaultStart));
  const [endDate, setEndDate] = useState<Date>(() => parseParamDate(endParam, defaultEnd));
  const [timePicker, setTimePicker] = useState<null | 'start' | 'end'>(null);
  const toggle = useSavedStore(s => s.toggle);
  const savedList = useSavedStore(s => s.saved);

  const isGroupKey = !!id && id.includes('__');
  const nights = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);

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
        images: d.images ?? [],
        pricing: { daily: d.pricing?.daily ?? null },
        availability: d.availability,
        status: 'AVAILABLE',
        deposit: d.deposit ?? 0,
        advancePayAmount: Number(d.advancePayAmount ?? 0),
        pricingDetails: d.pricingDetails ?? null,
      } as VehicleDetail;
    },
    enabled: !!id,
  });

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
  const unitPrice = pb ? Math.round(pb.applicablePrice) : (vehicle.pricing?.daily ?? null);
  const unit = pb ? unitLabel(pb.periodType) : '/day';
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
  if (pd?.taxRate) specs.push({ icon: 'receipt-outline', label: `Incl. ${pd.taxRate}% GST` });

  // Real payment flows (mirrors checkout: FULL always, ADVANCE when valid).
  const advance = vehicle.advancePayAmount ?? 0;
  const canAdvance = total != null && advance > 0 && advance < total;

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
                onPress={() => Share.share({
                  title: `${vehicle.make} ${vehicle.model}`,
                  message: `Check out this ${vehicle.make} ${vehicle.model} at WUW Rentals — ${vehicle.branch}!${unitPrice != null ? ` From ₹${unitPrice.toLocaleString('en-IN')} ${unit}.` : ''}`,
                })}
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

        {/* Period + availability */}
        <View style={styles.badgeRow}>
          <View style={styles.periodBadge}>
            <Ionicons name="time-outline" size={12} color={Colors.onDarkMuted} />
            <Text style={styles.periodText}>
              {realPeriodLabel
                ? `${realPeriodLabel}${realDuration ? ` · ${realDuration}` : ''}`
                : `${nights} night${nights !== 1 ? 's' : ''}`}
            </Text>
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
              <PriceLine label={`Base rate (${realDuration ?? `${nights} night${nights !== 1 ? 's' : ''}`})`} value={`₹${pd.basePrice.toLocaleString('en-IN')}`} />
              <PriceLine label="Deposit (refundable)" value={`₹${pd.deposit.toLocaleString('en-IN')}`} />
              <PriceLine label={`Tax (GST ${pd.taxRate}%)`} value={`₹${pd.taxAmount.toLocaleString('en-IN')}`} />
              {pd.discountAmount > 0 && (
                <PriceLine label="Discount" value={`-₹${pd.discountAmount.toLocaleString('en-IN')}`} valueColor={Colors.availGood} />
              )}
              <View style={styles.priceDivider} />
              <PriceLine label="Total" value={`₹${(pd.finalTotal + pd.deposit).toLocaleString('en-IN')}`} bold />
            </View>
          </>
        ) : (
          <View style={styles.noPriceHint}>
            <Ionicons name="calendar-outline" size={20} color={Colors.onDarkMuted} />
            <Text style={styles.noPriceText}>Select dates above to see pricing</Text>
          </View>
        )}

        {/* ── Payment options (real flows from checkout) ── */}
        {total != null ? (
          <>
            <Text style={styles.sectionTitle}>Payment options</Text>
            <View style={styles.darkCard}>
              <View style={styles.payRow}>
                <Ionicons name="card-outline" size={20} color={Colors.onDark} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.payTitle}>Pay in full</Text>
                  <Text style={styles.paySub}>₹{total.toLocaleString('en-IN')} now · deposit included</Text>
                </View>
              </View>
              {canAdvance ? (
                <>
                  <View style={styles.priceDivider} />
                  <View style={styles.payRow}>
                    <Ionicons name="time-outline" size={20} color={Colors.onDark} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payTitle}>Reserve with advance</Text>
                      <Text style={styles.paySub}>
                        ₹{advance.toLocaleString('en-IN')} now · ₹{(total - advance).toLocaleString('en-IN')} at pickup
                      </Text>
                    </View>
                  </View>
                </>
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
              <Text style={styles.ctaNote}>total · {realDuration ?? `${nights} night${nights !== 1 ? 's' : ''}`}</Text>
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
          onPress={() =>
            router.push({
              pathname: '/booking/checkout',
              params: {
                vehicleId: vehicle.publicId,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
              },
            })
          }
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
        onConfirm={(s, e) => {
          setStartDate(withTime(s, timeOf(startDate)));
          setEndDate(withTime(e, timeOf(endDate)));
        }}
        onClose={() => setShowPicker(false)}
      />

      {/* Time picker */}
      <TimeFieldPicker
        visible={timePicker !== null}
        value={timePicker === 'end' ? timeOf(endDate) : timeOf(startDate)}
        title={timePicker === 'end' ? 'Return time' : 'Pickup time'}
        onSelect={(t) => {
          if (timePicker === 'end') setEndDate((d) => withTime(d, t));
          else setStartDate((d) => withTime(d, t));
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
