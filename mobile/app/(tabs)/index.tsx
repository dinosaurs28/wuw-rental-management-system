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
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { normalizeGroups } from '../../lib/vehicles';
import CarCard from '../../components/cars/CarCard';
import SearchCard, { type SearchQuery } from '../../components/cars/SearchCard';
import Avatar from '../../components/ui/Avatar';

const { height } = Dimensions.get('window');
const HERO_HEIGHT = Math.min(0.52 * height, 440);
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

  const { data: branches } = useQuery<Branch[]>({
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

  // Recommended rail — real availability for a default next-day window.
  const today = new Date().toISOString().slice(0, 10);
  const browseStart = useMemo(() => new Date(Date.now() + 86_400_000).toISOString(), [today]);
  const browseEnd = useMemo(() => new Date(Date.now() + 2 * 86_400_000).toISOString(), [today]);

  const { data: recommended, isLoading: recommendedLoading } = useQuery({
    queryKey: ['vehicles', selectedBranch?.publicId ?? 'all', today],
    queryFn: () =>
      vehiclesApi.list({
        limit: 100,
        start: browseStart,
        end: browseEnd,
        branch: selectedBranch?.publicId,
      }),
    select: (res) => normalizeGroups((res.data?.data ?? []) as any[]).slice(0, 8),
    staleTime: 30_000,
    enabled: !!selectedBranch,
  });

  const onSearch = (q: SearchQuery) =>
    router.push({
      pathname: '/search',
      params: { branch: q.branchId, branchName: q.branchName, start: q.start, end: q.end },
    });

  return (
    <View style={styles.root}>
      {isFocused ? <StatusBar style="light" /> : null}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Hero ── */}
        <View style={[styles.hero, { height: HERO_HEIGHT }]}>
          <Image source={CAR} style={styles.heroImg} resizeMode="cover" />
          <LinearGradient
            colors={['transparent', Colors.bgDark]}
            style={styles.heroFade}
            pointerEvents="none"
          />

          {/* Brand + profile */}
          <View style={[styles.topBar, { top: insets.top + 10 }]}>
            <View style={styles.logoRow}>
              <Text style={styles.logo}>WUW</Text>
              <View style={styles.logoDot} />
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.85}>
              <Avatar seed={user?.name ?? 'you'} size={44} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Centred search box, overlapping the hero ── */}
        <View style={styles.searchWrap}>
          <SearchCard
            branches={branches ?? []}
            branch={selectedBranch}
            onBranchChange={setSelectedBranch}
            onSubmit={onSearch}
          />
        </View>

        {/* ── Recommended for you ── */}
        <Text style={styles.sectionTitle}>Recommended for you</Text>
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
                onPress={() => router.push(`/vehicle/${item.publicId}`)}
              />
            )}
          />
        ) : (
          <Text style={styles.emptyText}>No vehicles available right now — check back soon.</Text>
        )}
      </ScrollView>
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

  searchWrap: { paddingHorizontal: 16, marginTop: -96 },

  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.white,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginTop: 32,
    marginBottom: 16,
  },
  rail: { paddingHorizontal: 20, gap: 12 },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.onDarkMuted,
    paddingHorizontal: 20,
    marginTop: 8,
  },
});
