import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
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
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import { useSavedStore } from '../../store/saved';
import DateRangePicker from '../../components/ui/DateRangePicker';
import type { VehicleDetail } from '../../types/api';

const { width, height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.42;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const INCLUDED: { icon: IoniconName; label: string }[] = [
  { icon: 'shield-checkmark-outline', label: 'Insurance covered' },
  { icon: 'headset-outline',           label: '24/7 Support' },
  { icon: 'speedometer-outline',       label: '200 km/day free' },
  { icon: 'construct-outline',         label: 'Roadside assist' },
];

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(d: Date) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
function fmtDateFull(d: Date) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
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

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'overview' | 'specs'>('overview');
  const [showPicker, setShowPicker] = useState(false);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const toggle = useSavedStore(s => s.toggle);
  const savedList = useSavedStore(s => s.saved);

  const isGroupKey = !!id && id.includes('__');
  const nights = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);

  const { data: vehicle, isLoading, isFetching } = useQuery({
    queryKey: ['vehicle', id, startDate.toDateString(), endDate.toDateString()],
    queryFn: () =>
      isGroupKey
        ? vehiclesApi.groupDetail(id!, { start: startDate.toISOString(), end: endDate.toISOString() })
        : vehiclesApi.detail(id!, { start: startDate.toISOString(), end: endDate.toISOString() }),
    select: (res) => {
      const d = res.data.data as any;
      if (!isGroupKey) return d as VehicleDetail;
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

  const heroImage = vehicle.images?.[0];
  const isAvail = vehicle.availability !== false;
  const saved = savedList.some(v => v.publicId === vehicle.publicId);
  const pd = vehicle.pricingDetails;
  // Compute true per-night rate: basePrice / nights when multi-day, else listing daily
  const perNightPrice = pd
    ? Math.round(pd.basePrice / Math.max(nights, 1))
    : vehicle.pricing?.daily ?? null;

  return (
    <View style={styles.root}>
      {/* ── Hero ── */}
      <View style={[styles.hero, { height: HERO_HEIGHT }]}>
        {heroImage ? (
          <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
        ) : (
          <LinearGradient colors={['#1a1a1a', '#2d2d2d', '#111']} style={StyleSheet.absoluteFillObject}>
            <View style={styles.heroGlow} />
          </LinearGradient>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.75)']}
          locations={[0, 0.4, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Controls */}
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
                message: `Check out this ${vehicle.make} ${vehicle.model} at WUW Rentals — ${vehicle.branch}!${perNightPrice != null ? ` From ₹${perNightPrice.toLocaleString('en-IN')}/night.` : ''}`,
              })}
            >
              <Ionicons name="share-outline" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero bottom */}
        <View style={styles.heroBottom}>
          <Text style={styles.heroName}>{vehicle.make} {vehicle.model}</Text>
          <View style={styles.heroMeta}>
            <View style={styles.heroBranchRow}>
              <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.65)" />
              <Text style={styles.heroBranch}>{vehicle.branch}</Text>
            </View>
            {perNightPrice != null && (
              <View style={styles.heroPricePill}>
                <Text style={styles.heroPriceText}>₹{perNightPrice.toLocaleString('en-IN')}</Text>
                <Text style={styles.heroPriceDay}>/night</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── Scroll content ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Date picker card */}
        <TouchableOpacity style={styles.dateCard} onPress={() => setShowPicker(true)} activeOpacity={0.85}>
          <View style={styles.dateHalf}>
            <Text style={styles.dateLabel}>PICKUP</Text>
            <Text style={styles.dateValue}>{fmtDateFull(startDate)}</Text>
          </View>
          <View style={styles.dateDivider} />
          <View style={styles.dateHalf}>
            <Text style={styles.dateLabel}>RETURN</Text>
            <Text style={styles.dateValue}>{fmtDateFull(endDate)}</Text>
          </View>
          <View style={styles.dateEditBtn}>
            <Ionicons name="calendar-outline" size={16} color={Colors.orange} />
          </View>
        </TouchableOpacity>

        {/* Nights + availability badge */}
        <View style={styles.badgeRow}>
          <View style={styles.nightsBadge}>
            <Ionicons name="moon-outline" size={12} color={Colors.ink3} />
            <Text style={styles.nightsText}>{nights} night{nights !== 1 ? 's' : ''}</Text>
          </View>
          <View style={[styles.availBadge, !isAvail && styles.availBadgeRed]}>
            <View style={[styles.availDot, !isAvail && styles.availDotRed]} />
            <Text style={[styles.availText, !isAvail && styles.availTextRed]}>
              {vehicle.availability === null ? 'Checking...' : isAvail ? `${vehicle.availableCount ?? ''} available` : 'Unavailable'}
            </Text>
          </View>
          {isFetching && !isLoading && (
            <ActivityIndicator size="small" color={Colors.orange} />
          )}
        </View>

        {/* Stat strip */}
        {(() => {
          const cells = [
            { icon: 'layers-outline' as IoniconName, label: 'Type', value: vehicle.category, accent: false, show: true },
            { icon: 'speedometer-outline' as IoniconName, label: 'Free km', value: `${pd?.freeKmLimit ?? 0}/day`, accent: false, show: !!pd?.freeKmLimit },
            { icon: 'shield-outline' as IoniconName, label: 'Deposit', value: `₹${pd?.deposit?.toLocaleString('en-IN') ?? 0}`, accent: true, show: !!pd?.deposit },
            { icon: 'navigate-outline' as IoniconName, label: 'Extra km', value: `₹${pd?.extraKmRate ?? 0}/km`, accent: false, show: !!pd?.extraKmRate },
          ].filter((c) => c.show);
          return (
            <View style={styles.statStrip}>
              {cells.map((c, i) => (
                <View
                  key={c.label}
                  style={[styles.statCell, i < cells.length - 1 && styles.statCellDivider]}
                >
                  <Ionicons name={c.icon} size={14} color={c.accent ? Colors.orange : Colors.ink3} />
                  <Text style={styles.statCellLabel}>{c.label}</Text>
                  <Text
                    style={[styles.statCellValue, c.accent && styles.statCellValueAccent]}
                    numberOfLines={1}
                  >
                    {c.value}
                  </Text>
                </View>
              ))}
            </View>
          );
        })()}

        {/* Tabs */}
        <View style={styles.tabBar}>
          {(['overview', 'specs'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tabItem, tab === t && styles.tabItemActive]}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                {t === 'overview' ? 'Overview' : 'Specs'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'overview' && (
          <>
            {/* What's included */}
            <Text style={styles.sectionTitle}>What's included</Text>
            <View style={styles.includedGrid}>
              {INCLUDED.map(item => (
                <View key={item.label} style={styles.includedCard}>
                  <View style={styles.includedIconWrap}>
                    <Ionicons name={item.icon} size={20} color={Colors.orange} />
                  </View>
                  <Text style={styles.includedLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            {/* Pricing */}
            {pd ? (
              <>
                <Text style={styles.sectionTitle}>Pricing breakdown</Text>
                <View style={styles.priceCard}>
                  <PriceLine label={`Base rate (${nights} night${nights !== 1 ? 's' : ''})`} value={`₹${pd.basePrice.toLocaleString('en-IN')}`} />
                  <PriceLine label="Deposit (refundable)" value={`₹${pd.deposit.toLocaleString('en-IN')}`} />
                  <PriceLine label={`Tax (GST ${pd.taxRate}%)`} value={`₹${pd.taxAmount.toLocaleString('en-IN')}`} />
                  {pd.discountAmount > 0 && (
                    <PriceLine label="Discount" value={`-₹${pd.discountAmount.toLocaleString('en-IN')}`} valueColor="#2d9d61" />
                  )}
                  <View style={styles.priceDivider} />
                  <PriceLine label="Total" value={`₹${(pd.finalTotal + pd.deposit).toLocaleString('en-IN')}`} bold />
                </View>
              </>
            ) : (
              <View style={styles.noPriceHint}>
                <Ionicons name="calendar-outline" size={20} color={Colors.ink4} />
                <Text style={styles.noPriceText}>Select dates above to see pricing</Text>
              </View>
            )}
          </>
        )}

        {tab === 'specs' && (
          <>
            <Text style={styles.sectionTitle}>Vehicle specs</Text>
            <View style={styles.specsCard}>
              {[
                { icon: 'layers-outline' as IoniconName,          label: 'Category',      value: vehicle.category },
                { icon: 'location-outline' as IoniconName,        label: 'Branch',        value: vehicle.branch },
                { icon: 'checkmark-circle-outline' as IoniconName,label: 'Status',        value: vehicle.status ?? 'Available' },
                ...(pd ? [
                  { icon: 'speedometer-outline' as IoniconName,   label: 'Free km/day',   value: `${pd.freeKmLimit} km` },
                  { icon: 'navigate-outline' as IoniconName,      label: 'Extra km rate', value: `₹${pd.extraKmRate}/km` },
                ] : []),
              ].map(({ icon, label, value }, i, arr) => (
                <View key={label} style={[styles.specRow, i === arr.length - 1 && styles.specRowLast]}>
                  <View style={styles.specIconWrap}>
                    <Ionicons name={icon} size={16} color={Colors.ink3} />
                  </View>
                  <Text style={styles.specLabel}>{label}</Text>
                  <Text style={styles.specValue}>{value}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.ctaLeft}>
          {pd ? (
            <>
              <Text style={styles.ctaPrice}>
                ₹{(pd.finalTotal + pd.deposit).toLocaleString('en-IN')}
              </Text>
              <Text style={styles.ctaNote}>total · {nights} night{nights !== 1 ? 's' : ''}</Text>
            </>
          ) : perNightPrice != null ? (
            <>
              <Text style={styles.ctaPrice}>₹{perNightPrice.toLocaleString('en-IN')}</Text>
              <Text style={styles.ctaNote}>/night · select dates</Text>
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

      {/* Date picker */}
      <DateRangePicker
        visible={showPicker}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => { setStartDate(s); setEndDate(e); }}
        onClose={() => setShowPicker(false)}
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
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  errorText: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink },
  backLink: { marginTop: 12 },
  backLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.orange },

  hero: { width, overflow: 'hidden', backgroundColor: '#111' },
  heroGlow: {
    position: 'absolute', top: '15%', left: '10%',
    width: '40%', height: '60%', borderRadius: 100,
    backgroundColor: Colors.orange, opacity: 0.1,
  },
  heroTop: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  heroTopRight: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnSaved: {
    backgroundColor: 'rgba(229,62,62,0.2)',
    borderColor: 'rgba(229,62,62,0.4)',
  },
  heroBottom: { position: 'absolute', bottom: 20, left: 20, right: 20 },
  heroName: {
    fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.white,
    letterSpacing: -0.8, lineHeight: 33, marginBottom: 10,
  },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBranchRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroBranch: { fontFamily: Fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  heroPricePill: {
    flexDirection: 'row', alignItems: 'baseline', gap: 2,
    backgroundColor: Colors.orange, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  heroPriceText: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.white, letterSpacing: -0.4 },
  heroPriceDay: { fontFamily: Fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.75)' },

  scroll: { flex: 1 },

  // Date card
  dateCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dateHalf: { flex: 1, padding: 16 },
  dateDivider: { width: 1, height: 40, backgroundColor: Colors.hairline },
  dateLabel: {
    fontFamily: Fonts.bodyMedium, fontSize: 9,
    color: Colors.ink3, letterSpacing: 0.9, marginBottom: 5,
  },
  dateValue: {
    fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink,
  },
  dateEditBtn: {
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Badge row
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  nightsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  nightsText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  availBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(45,157,97,0.12)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(45,157,97,0.25)',
  },
  availBadgeRed: {
    backgroundColor: 'rgba(220,53,69,0.12)',
    borderColor: 'rgba(220,53,69,0.25)',
  },
  availDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2d9d61' },
  availDotRed: { backgroundColor: '#dc3545' },
  availText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: '#2d9d61' },
  availTextRed: { color: '#dc3545' },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
    gap: 4,
  },
  statCellDivider: {
    borderRightWidth: 1,
    borderRightColor: Colors.hairline,
  },
  statCellLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.ink3,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statCellValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  statCellValueAccent: { color: Colors.orange },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16, marginTop: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14, padding: 4,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  tabItem: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  tabItemActive: { backgroundColor: Colors.ink },
  tabLabel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  tabLabelActive: { color: Colors.white },

  sectionTitle: {
    fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink,
    letterSpacing: -0.4, paddingHorizontal: 16, marginTop: 28, marginBottom: 14,
  },

  includedGrid: {
    paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  includedCard: {
    width: '46.5%', backgroundColor: Colors.surface,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.hairline, gap: 10,
  },
  includedIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  includedLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink, lineHeight: 18 },

  // Price
  priceCard: {
    marginHorizontal: 16, backgroundColor: Colors.surface,
    borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: Colors.hairline, gap: 2,
  },
  priceLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 7,
  },
  priceLineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  priceLineLabelBold: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  priceLineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  priceLineValueBold: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.5 },
  priceDivider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 6 },

  noPriceHint: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: Colors.surface, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: Colors.hairline,
  },
  noPriceText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },

  // Specs
  specsCard: {
    marginHorizontal: 16, backgroundColor: Colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: Colors.hairline, overflow: 'hidden',
  },
  specRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.hairline, gap: 12,
  },
  specRowLast: { borderBottomWidth: 0 },
  specIconWrap: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  specLabel: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  specValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },

  // CTA
  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.hairline,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14,
  },
  ctaLeft: { flex: 1, marginRight: 16 },
  ctaPrice: {
    fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.6,
  },
  ctaNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 16,
    paddingVertical: 15, paddingHorizontal: 24,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  ctaBtnDisabled: { backgroundColor: Colors.ink4, shadowOpacity: 0 },
  ctaBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white, letterSpacing: 0.2 },
});
