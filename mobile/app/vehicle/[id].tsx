import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import type { VehicleDetail } from '../../types/api';

const { width, height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.38;

const TABS = ['Overview', 'Specs', 'Reviews'] as const;
type DetailTab = (typeof TABS)[number];

const INCLUDED = ['Insurance', '24/7 Support', '200 km/day', 'Roadside assist'];

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DetailTab>('Overview');

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => vehiclesApi.detail(id!),
    select: (res) => res.data.data as VehicleDetail,
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
  const dailyPrice = vehicle.pricing?.daily;

  return (
    <View style={styles.root}>
      {/* Hero */}
      <View style={[styles.hero, { height: HERO_HEIGHT }]}>
        {heroImage ? (
          <Image source={{ uri: heroImage }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={['#141414', '#242424', '#0e0e0e']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroImage}
          >
            <View style={styles.heroGlow} />
          </LinearGradient>
        )}

        {/* Gradient overlay */}
        <LinearGradient
          colors={['rgba(0,0,0,0.5)', 'transparent', 'transparent']}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Top overlay controls */}
        <View style={[styles.heroControls, { top: insets.top + 10 }]}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Text style={styles.controlIcon}>←</Text>
          </TouchableOpacity>
          <View style={styles.heroControlsRight}>
            <TouchableOpacity style={styles.controlBtn} hitSlop={8}>
              <Text style={styles.controlIcon}>♡</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlBtn} hitSlop={8}>
              <Text style={styles.controlIcon}>↗</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero footer */}
        <View style={styles.heroFooter}>
          <View>
            <Text style={styles.heroName}>
              {vehicle.make} {vehicle.model}
            </Text>
            <Text style={styles.heroBranch}>{vehicle.branch}</Text>
          </View>
          {dailyPrice != null && (
            <View style={styles.pricePill}>
              <Text style={styles.priceText}>
                ₹{dailyPrice.toLocaleString('en-IN')}
                <Text style={styles.priceDay}>/day</Text>
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Category + availability */}
        <View style={styles.metaRow}>
          <View style={styles.metaBadge}>
            <Text style={styles.metaText}>{vehicle.category}</Text>
          </View>
          <View
            style={[
              styles.metaBadge,
              { backgroundColor: vehicle.availability ? '#d4edda' : '#f8d7da' },
            ]}
          >
            <Text
              style={[
                styles.metaText,
                { color: vehicle.availability ? '#1a7035' : '#842029' },
              ]}
            >
              {vehicle.availability === null
                ? 'Check dates'
                : vehicle.availability
                ? 'Available'
                : 'Unavailable'}
            </Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'Overview' && (
          <>
            {/* What's included */}
            <Text style={styles.sectionTitle}>What's included</Text>
            <View style={styles.includedGrid}>
              {INCLUDED.map((item) => (
                <View key={item} style={styles.includedItem}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.includedText}>{item}</Text>
                </View>
              ))}
            </View>

            {/* Pricing breakdown */}
            {vehicle.pricingDetails && (
              <>
                <Text style={styles.sectionTitle}>Pricing</Text>
                <View style={styles.priceCard}>
                  {[
                    ['Base rate', `₹${vehicle.pricingDetails.pricingBreakdown.applicablePrice.toLocaleString('en-IN')}/day`],
                    ['Deposit', `₹${vehicle.pricingDetails.deposit.toLocaleString('en-IN')}`],
                    ['Tax (GST)', `${vehicle.pricingDetails.taxRate}%`],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.priceRow}>
                      <Text style={styles.priceLabel}>{label}</Text>
                      <Text style={styles.priceValue}>{value}</Text>
                    </View>
                  ))}
                  <View style={styles.priceDivider} />
                  <View style={styles.priceRow}>
                    <Text style={[styles.priceLabel, styles.priceTotalLabel]}>
                      Total (1 day)
                    </Text>
                    <Text style={styles.priceTotalValue}>
                      ₹{vehicle.pricingDetails.finalTotal.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {tab === 'Specs' && (
          <View style={styles.specsBlock}>
            {[
              ['Category', vehicle.category],
              ['Branch', vehicle.branch],
              ['Status', vehicle.status],
              ['Free km/day', `${vehicle.pricingDetails?.freeKmLimit ?? '—'} km`],
              ['Extra km rate', vehicle.pricingDetails ? `₹${vehicle.pricingDetails.extraKmRate}/km` : '—'],
            ].map(([k, v]) => (
              <View key={k} style={styles.specRow}>
                <Text style={styles.specKey}>{k}</Text>
                <Text style={styles.specValue}>{v}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'Reviews' && (
          <View style={styles.reviewsBlock}>
            <Text style={styles.reviewsEmpty}>Reviews coming soon.</Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        <View>
          {dailyPrice != null && (
            <>
              <Text style={styles.ctaPrice}>
                ₹{dailyPrice.toLocaleString('en-IN')}
                <Text style={styles.ctaPriceDay}>/day</Text>
              </Text>
              <Text style={styles.ctaNote}>+ deposit & taxes</Text>
            </>
          )}
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, !vehicle.availability && styles.ctaBtnDisabled]}
          onPress={() =>
            router.push({
              pathname: '/booking/checkout',
              params: { vehicleId: vehicle.publicId },
            })
          }
          disabled={vehicle.availability === false}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaBtnText}>
            {vehicle.availability === false ? 'Not available' : 'Book now →'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  errorText: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink },
  backLink: { marginTop: 12 },
  backLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.orange },
  hero: { width, position: 'relative', overflow: 'hidden', backgroundColor: Colors.black },
  heroImage: { width: '100%', height: '100%', position: 'absolute' },
  heroGlow: {
    position: 'absolute',
    top: '10%',
    left: '5%',
    width: '50%',
    height: '70%',
    borderRadius: 100,
    backgroundColor: Colors.orange,
    opacity: 0.12,
  },
  heroControls: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroControlsRight: { flexDirection: 'row', gap: 8 },
  controlBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: { fontSize: 18, color: Colors.white },
  heroFooter: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroName: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.white,
    letterSpacing: -0.8,
    lineHeight: 30,
  },
  heroBranch: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 3,
  },
  pricePill: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  priceText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.white,
  },
  priceDay: {
    fontFamily: Fonts.body,
    fontSize: 11,
  },
  content: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  metaBadge: {
    backgroundColor: Colors.orangeSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  metaText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.orange,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  tabBtnActive: {
    backgroundColor: Colors.black,
    borderColor: Colors.black,
  },
  tabBtnText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink2,
  },
  tabBtnTextActive: { color: Colors.white },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 17,
    color: Colors.ink,
    letterSpacing: -0.4,
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  includedGrid: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  includedItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '46%' },
  checkmark: { fontSize: 13, color: '#2d9d61', fontWeight: '700' },
  includedText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  priceCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 8,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  priceValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  priceDivider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 4 },
  priceTotalLabel: { fontFamily: Fonts.bodySemiBold, color: Colors.ink, fontSize: 15 },
  priceTotalValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
  },
  specsBlock: { paddingHorizontal: 20, paddingTop: 20, gap: 0 },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  specKey: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  specValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  reviewsBlock: { paddingHorizontal: 20, paddingTop: 40, alignItems: 'center' },
  reviewsEmpty: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  ctaPrice: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  ctaPriceDay: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
  },
  ctaNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 28,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaBtnDisabled: { backgroundColor: Colors.ink4, shadowOpacity: 0 },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});
