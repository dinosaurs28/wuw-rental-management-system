import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Colors, Fonts } from '../../constants/colors';
import { offersApi, vehiclesApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { activeOfferCoupon, useOfferCouponStore } from '../../store/offerCoupon';
import { normalizeGroups } from '../../lib/vehicles';
import CarCard from '../../components/cars/CarCard';
import SearchCard, { type SearchQuery } from '../../components/cars/SearchCard';
import Avatar from '../../components/ui/Avatar';
import Toast from '../../components/ui/Toast';
import OfferHeroSlider from '../../components/offers/OfferHeroSlider';
import type { PublicOffer } from '../../types/offers';

const { height } = Dimensions.get('window');
const HERO_HEIGHT = Math.min(0.52 * height, 440);
// Cards in the Recommended rail; "See all (n)" opens the full list.
const RAIL_SIZE = 8;
// Generated studio hero — edges feathered to exactly #0e0f13 so it melts
// into the screen background with no visible frame.
const CAR = require('../../assets/hero-dark.jpg');

interface Branch {
  publicId: string;
  name: string;
}

// Sixt-style home: dark hero with the brand + profile, a huge centred search
// box overlapping the hero, and a "Recommended for you" rail of real vehicles.
export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);

  const { data: branches, status: branchesStatus } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await vehiclesApi.branches();
      return (res.data?.data ?? []) as Branch[];
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranch) {
      setSelectedBranch(branches[0]);
    }
  }, [branches]);

  // #15 — offer posters for the hero: the selected branch's plus global ones
  // (every live poster when there is no branch). None, still loading, or an
  // error → the static hero below.
  const offersBranch = selectedBranch?.publicId ?? null;
  const { data: offerFeed } = useQuery({
    queryKey: ['offers', offersBranch ?? 'all'],
    queryFn: async () => {
      const res = await offersApi.list(offersBranch);
      const serverMs = new Date(res.data?.serverTime ?? '').getTime();
      return {
        branch: offersBranch ?? 'all',
        offers: (res.data?.data ?? []).filter((o) => !!o?.publicId && !!o?.imageUrl),
        // Device clock vs server clock, so a poster that has ended drops out
        // even when the phone's time is off.
        clockSkewMs: Number.isFinite(serverMs) ? serverMs - Date.now() : 0,
      };
    },
    enabled: !!selectedBranch || (branchesStatus !== 'pending' && !branches?.length),
    staleTime: 60_000,
    // Switching branch keeps the current posters up until the new ones arrive
    // (no flash back to the static hero); new and ended posters show up while
    // the home tab stays open.
    placeholderData: keepPreviousData,
    refetchInterval: isFocused ? 5 * 60_000 : false,
  });
  const offers: PublicOffer[] = useMemo(() => {
    if (!offerFeed) return [];
    const now = Date.now() + offerFeed.clockSkewMs;
    return offerFeed.offers.filter((o) => {
      const end = new Date(o.endsAt).getTime();
      return !Number.isFinite(end) || end > now;
    });
  }, [offerFeed, isFocused]);
  const hasOffers = offers.length > 0;

  // "Use code" saves the poster's coupon; checkout fills it in.
  const savedOfferCoupon = useOfferCouponStore((s) => activeOfferCoupon(s.coupon));
  const loadOfferCoupon = useOfferCouponStore((s) => s.load);
  const saveOfferCoupon = useOfferCouponStore((s) => s.save);
  useEffect(() => {
    void loadOfferCoupon();
  }, [loadOfferCoupon]);
  const [codeToast, setCodeToast] = useState<string | null>(null);

  const saveOfferCode = (offer: PublicOffer) => {
    if (!offer.couponCode) return;
    saveOfferCoupon(offer.couponCode, offer.coupon?.validUntil ?? null);
    setCodeToast(offer.couponCode.toUpperCase());
  };

  // The poster's vehicle (group key or vehicle — /vehicle/[id] takes both), or
  // the vehicles list for the poster's branch.
  const openOffer = (offer: PublicOffer) => {
    if (offer.linkTarget) {
      router.push({
        pathname: '/vehicle/[id]',
        params: { id: offer.linkTarget, ...(offer.branch ? { branch: offer.branch.publicId } : {}) },
      });
      return;
    }
    const branch = offer.branch ?? selectedBranch;
    router.push({
      pathname: '/search',
      params: branch ? { branch: branch.publicId, branchName: branch.name } : {},
    });
  };

  // Recommended rail — real availability for a default next-day window.
  const today = new Date().toISOString().slice(0, 10);
  const browseStart = useMemo(() => new Date(Date.now() + 86_400_000).toISOString(), [today]);
  const browseEnd = useMemo(() => new Date(Date.now() + 2 * 86_400_000).toISOString(), [today]);

  const { data: recommendedData, isLoading: recommendedLoading } = useQuery({
    queryKey: ['vehicles', selectedBranch?.publicId ?? 'all', today],
    queryFn: () =>
      vehiclesApi.list({
        limit: 100,
        start: browseStart,
        end: browseEnd,
        branch: selectedBranch?.publicId,
      }),
    // The rail shows the first few cards; total = every card for the window
    select: (res) => ({
      cards: normalizeGroups((res.data?.data ?? []) as any[]).slice(0, RAIL_SIZE),
      total: Number(res.data?.count ?? 0),
    }),
    staleTime: 30_000,
    enabled: !!selectedBranch,
  });
  const recommended = recommendedData?.cards;
  const recommendedTotal = recommendedData?.total ?? 0;

  // "See all (n)": the full list for the same window (client item 7)
  const seeAllRecommended = () =>
    router.push({
      pathname: '/search',
      params: {
        ...(selectedBranch ? { branch: selectedBranch.publicId, branchName: selectedBranch.name } : {}),
        start: browseStart,
        end: browseEnd,
      },
    });

  const onSearch = (q: SearchQuery) =>
    router.push({
      pathname: '/search',
      params: { branch: q.branchId, branchName: q.branchName, start: q.start, end: q.end },
    });

  // Brand + profile
  const brandBar = (
    <>
      <View style={styles.logoRow}>
        <Text style={styles.logo}>WUW</Text>
        <View style={styles.logoDot} />
      </View>
      <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.85}>
        <Avatar seed={user?.name ?? 'you'} size={44} />
      </TouchableOpacity>
    </>
  );

  return (
    <View style={styles.root}>
      {isFocused ? <StatusBar style="light" /> : null}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Hero: the live offer posters (#15), else the studio car ── */}
        {hasOffers ? (
          <View style={[styles.offersHero, { paddingTop: insets.top + 10 }]}>
            <View style={styles.topBarFlow}>{brandBar}</View>
            <OfferHeroSlider
              key={offerFeed?.branch ?? 'all'}
              offers={offers}
              paused={!isFocused}
              savedCode={savedOfferCoupon?.code ?? null}
              onOpen={openOffer}
              onUseCode={saveOfferCode}
            />
          </View>
        ) : (
          <View style={[styles.hero, { height: HERO_HEIGHT }]}>
            <Image source={CAR} style={styles.heroImg} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', Colors.bgDark]}
              style={styles.heroFade}
              pointerEvents="none"
            />

            <View style={[styles.topBar, { top: insets.top + 10 }]}>{brandBar}</View>
          </View>
        )}

        {/* ── Centred search box, overlapping the hero (below the posters) ── */}
        <View style={[styles.searchWrap, hasOffers && styles.searchWrapAfterOffers]}>
          <SearchCard
            branches={branches ?? []}
            branch={selectedBranch}
            onBranchChange={setSelectedBranch}
            onSubmit={onSearch}
          />
        </View>

        {/* ── Recommended for you ── */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>Recommended for you</Text>
          {recommendedTotal > (recommended?.length ?? 0) ? (
            <TouchableOpacity onPress={seeAllRecommended} hitSlop={8} activeOpacity={0.8}>
              <Text style={styles.seeAll}>See all ({recommendedTotal})</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {recommendedLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.orange} size="large" />
        ) : (recommended?.length ?? 0) > 0 ? (
          <FlatList
            data={recommended}
            horizontal
            keyExtractor={(v, i) => v.publicId ?? String(i)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            renderItem={({ item }) => (
              <CarCard
                vehicle={item}
                width={250}
                onPress={() => {
                  const branch = item.branchPublicId ?? selectedBranch?.publicId;
                  router.push({ pathname: `/vehicle/${item.publicId}` as any, params: branch ? { branch } : {} });
                }}
              />
            )}
          />
        ) : (
          <Text style={styles.emptyText}>No vehicles available right now — check back soon.</Text>
        )}
      </ScrollView>

      <Toast
        visible={!!codeToast}
        type="success"
        title={codeToast ? `${codeToast} saved` : ''}
        message="It will be filled in at checkout. Pick a car to use it."
        onDismiss={() => setCodeToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgDark },

  hero: { width: '100%', overflow: 'hidden', backgroundColor: Colors.bgDark },
  heroImg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 },
  topBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  logo: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.white, letterSpacing: 1 },
  logoDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange, marginTop: 8 },

  offersHero: { backgroundColor: Colors.bgDark, gap: 16 },
  topBarFlow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  searchWrap: { paddingHorizontal: 16, marginTop: -96 },
  searchWrapAfterOffers: { marginTop: 20 },

  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.white,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginTop: 32,
    marginBottom: 16,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingRight: 20,
  },
  sectionTitleInRow: { flexShrink: 1 },
  seeAll: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
  rail: { paddingHorizontal: 20, gap: 12 },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.onDarkMuted,
    paddingHorizontal: 20,
    marginTop: 8,
  },
});
