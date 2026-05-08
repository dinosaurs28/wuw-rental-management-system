import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface CustomerResult {
  publicId: string;
  name: string;
  email: string;
  phone: string | null;
  customerProfile: {
    isProfileCompleted: boolean;
  } | null;
}

const VIEWFINDER = 260;
const CORNER = 28;
const BORDER = 3;
const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

export default function CustomerSearch() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // QR scan state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState('');
  const [scanLookupLoading, setScanLookupLoading] = useState(false);
  const scannerActive = useRef(true);
  const scanLine = useRef(new Animated.Value(0)).current;

  // Debounce input → query (mirrors useEffect + setTimeout pattern)
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isFetching } = useQuery<CustomerResult[]>({
    queryKey: ['employee', 'customer-search', debouncedQuery],
    queryFn: async () => {
      const res = await employeeApi.searchCustomer(debouncedQuery);
      return (res.data?.customers ?? []) as CustomerResult[];
    },
    enabled: debouncedQuery.length >= MIN_CHARS,
    staleTime: 30_000,
  });

  // Scan line animation
  useEffect(() => {
    if (!scannerOpen) return;
    scanLine.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scannerOpen]);

  const closeScanner = useCallback(() => {
    setScannerOpen(false);
    setScanError('');
    scannerActive.current = true;
    setScanning(true);
  }, []);

  const handleScannedValue = useCallback(async (raw: string) => {
    if (scanLookupLoading) return;
    setScanLookupLoading(true);
    setScanError('');

    let value = raw.trim();
    // Strip optional "pickup:" / "return:" prefixes used by booking QRs
    if (value.startsWith('pickup:')) value = value.slice('pickup:'.length);
    else if (value.startsWith('return:')) value = value.slice('return:'.length);

    try {
      // First try as a booking ID
      try {
        const bookingRes = await employeeApi.scanBooking(value);
        const booking = bookingRes.data?.data;
        if (booking?.publicId) {
          if (booking.status === 'CONFIRMED') {
            closeScanner();
            router.push(`/employee/pickup/${booking.publicId}`);
            return;
          }
          if (booking.status === 'PICKED_UP') {
            closeScanner();
            router.push(`/employee/return/${booking.publicId}`);
            return;
          }
          // Other statuses: fall through to customer lookup attempt
        }
      } catch (err: any) {
        if (err.response?.status !== 404) {
          // Non-404 booking errors: continue to customer search fallback
        }
      }

      // Fallback: treat as customer search query
      closeScanner();
      setQuery(value);
      setDebouncedQuery(value);
    } catch (err: any) {
      setScanError(err.response?.data?.message ?? 'Could not resolve scanned code.');
      setTimeout(() => {
        scannerActive.current = true;
        setScanning(true);
      }, 2000);
    } finally {
      setScanLookupLoading(false);
    }
  }, [closeScanner, router, scanLookupLoading]);

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (!scannerActive.current || !data) return;
    scannerActive.current = false;
    setScanning(false);
    Vibration.vibrate(60);
    handleScannedValue(data);
  };

  const openScanner = async () => {
    setScanError('');
    scannerActive.current = true;
    setScanning(true);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setScannerOpen(true);
        return;
      }
    }
    setScannerOpen(true);
  };

  const goToWalkIn = () => {
    // Path is owned by another agent; bypass typed routes until generated.
    router.push('/employee/walkin/initiate?next=/employee/customer/search' as any);
  };

  const scanLineY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, VIEWFINDER - 4],
  });

  const showResults = debouncedQuery.length >= MIN_CHARS;
  const hasResults = (results?.length ?? 0) > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Customer Search</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Name or phone number..."
            placeholderTextColor={Colors.ink4}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoFocus
          />
          {isFetching && showResults ? (
            <ActivityIndicator color={Colors.orange} size="small" />
          ) : query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.searchDivider} />
          <TouchableOpacity onPress={openScanner} hitSlop={8} style={styles.qrBtn} activeOpacity={0.7}>
            <Ionicons name="qr-code-outline" size={20} color={Colors.ink2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Results */}
      {!showResults ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={44} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Search customers</Text>
          <Text style={styles.emptySub}>
            Enter a name or phone number (min. {MIN_CHARS} characters), or scan a QR code.
          </Text>
          <TouchableOpacity onPress={goToWalkIn} style={styles.walkInCta} activeOpacity={0.85}>
            <Ionicons name="person-add-outline" size={16} color={Colors.orange} />
            <Text style={styles.walkInCtaText}>Create new walk-in customer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            isFetching ? null : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No results</Text>
                <Text style={styles.emptySub}>
                  No customers match "{debouncedQuery}". Try a different term.
                </Text>
                <TouchableOpacity onPress={goToWalkIn} style={styles.walkInCta} activeOpacity={0.85}>
                  <Ionicons name="person-add-outline" size={16} color={Colors.orange} />
                  <Text style={styles.walkInCtaText}>Create new walk-in customer</Text>
                </TouchableOpacity>
              </View>
            )
          }
          ListFooterComponent={
            hasResults ? (
              <TouchableOpacity onPress={goToWalkIn} style={styles.walkInCtaInline} activeOpacity={0.85}>
                <Ionicons name="person-add-outline" size={16} color={Colors.orange} />
                <Text style={styles.walkInCtaText}>Create new walk-in customer</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.customerCard}
              onPress={() => router.push(`/employee/customer/${item.publicId}`)}
              activeOpacity={0.85}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{item.name}</Text>
                <Text style={styles.customerPhone}>{item.phone ?? item.email}</Text>
              </View>
              <View style={[styles.kycBadge, item.customerProfile?.isProfileCompleted ? styles.kycGreen : styles.kycAmber]}>
                <Text style={[styles.kycText, item.customerProfile?.isProfileCompleted ? styles.kycTextGreen : styles.kycTextAmber]}>
                  {item.customerProfile?.isProfileCompleted ? 'Verified' : 'Incomplete'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        />
      )}

      {/* QR scanner overlay */}
      {scannerOpen && (
        <View style={[styles.scannerRoot, { paddingTop: insets.top }]}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity onPress={closeScanner} style={styles.scannerClose} hitSlop={8}>
              <Ionicons name="close" size={26} color={Colors.white} />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan</Text>
            <View style={{ width: 36 }} />
          </View>

          {!permission?.granted ? (
            <View style={styles.permBox}>
              <View style={styles.permIcon}>
                <Ionicons name="camera-outline" size={36} color={Colors.ink3} />
              </View>
              <Text style={styles.permTitle}>Camera Access Needed</Text>
              <Text style={styles.permSub}>Allow camera access to scan QR codes.</Text>
              <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.85}>
                <Text style={styles.permBtnText}>Allow Camera</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
              />
              <View style={styles.overlay} pointerEvents="none">
                <View style={styles.overlayTop} />
                <View style={styles.overlayRow}>
                  <View style={styles.overlaySide} />
                  <View style={styles.viewfinder}>
                    <View style={[styles.corner, styles.cornerTL]} />
                    <View style={[styles.corner, styles.cornerTR]} />
                    <View style={[styles.corner, styles.cornerBL]} />
                    <View style={[styles.corner, styles.cornerBR]} />
                    {scanning && (
                      <Animated.View
                        style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]}
                      />
                    )}
                    {scanLookupLoading && (
                      <View style={styles.processingOverlay}>
                        <ActivityIndicator color={Colors.orange} size="large" />
                        <Text style={styles.processingText}>Looking up...</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.overlaySide} />
                </View>
                <View style={styles.overlayBottom} />
              </View>
              <View style={styles.hintWrap}>
                {scanError ? (
                  <View style={styles.errorPill}>
                    <Ionicons name="alert-circle-outline" size={15} color="#fff" />
                    <Text style={styles.errorPillText}>{scanError}</Text>
                  </View>
                ) : (
                  <Text style={styles.scanHint}>Point camera at a booking or customer QR</Text>
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    padding: 0,
  },
  searchDivider: {
    width: 1,
    height: 22,
    backgroundColor: Colors.hairline,
  },
  qrBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

  list: { paddingHorizontal: 20, paddingBottom: 100, gap: 8 },

  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  customerInfo: { flex: 1 },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },
  kycBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  kycGreen: { backgroundColor: '#10b98115' },
  kycAmber: { backgroundColor: '#f59e0b15' },
  kycText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  kycTextGreen: { color: '#10b981' },
  kycTextAmber: { color: '#f59e0b' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', paddingHorizontal: 16 },

  walkInCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#ff6a1f12',
    borderWidth: 1,
    borderColor: '#ff6a1f30',
    marginTop: 16,
  },
  walkInCtaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#ff6a1f0d',
    borderWidth: 1,
    borderColor: '#ff6a1f30',
    borderStyle: 'dashed',
    marginTop: 12,
  },
  walkInCtaText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.orange,
  },

  /* QR scanner overlay */
  scannerRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 10,
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  scannerClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  scannerTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.white,
    letterSpacing: -0.4,
  },

  cameraWrap: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    bottom: '50%',
    marginBottom: VIEWFINDER / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayRow: { flexDirection: 'row', alignItems: 'center' },
  overlaySide: {
    width: 40,
    height: VIEWFINDER,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    top: '50%',
    marginTop: VIEWFINDER / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintWrap: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
  },

  viewfinder: {
    width: VIEWFINDER,
    height: VIEWFINDER,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: Colors.orange,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderTopLeftRadius: 10 },
  cornerTR: { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER, borderTopRightRadius: 10 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderBottomRightRadius: 10 },

  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.orange,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },

  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: '#fff' },

  scanHint: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
  },
  errorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(229,62,62,0.85)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  errorPillText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#fff' },

  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  permIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permTitle: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.white, letterSpacing: -0.4, textAlign: 'center' },
  permSub: { fontFamily: Fonts.body, fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 20 },
  permBtn: {
    marginTop: 8,
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  permBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
