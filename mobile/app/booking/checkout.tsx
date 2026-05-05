import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi, userApi, api } from '../../lib/api';
import type { VehicleDetail, KycDocument } from '../../types/api';

function DateInput({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.dateInput} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{value || 'Select date'}</Text>
    </TouchableOpacity>
  );
}

function LineItem({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.lineItem}>
      <Text style={[styles.lineLabel, bold && styles.lineLabelBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineValueBold]}>{value}</Text>
    </View>
  );
}

export default function Checkout() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { vehicleId, start, end } = useLocalSearchParams<{ vehicleId: string; start?: string; end?: string }>();

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const [startDate] = useState(() => start ? new Date(start) : new Date(Date.now() + 86400 * 1000));
  const [endDate] = useState(() => end ? new Date(end) : new Date(Date.now() + 2 * 86400 * 1000));
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const isGroupKey = !!vehicleId && vehicleId.includes('__');

  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ['vehicle', vehicleId, startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      isGroupKey
        ? vehiclesApi.groupDetail(vehicleId!, {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          })
        : vehiclesApi.detail(vehicleId!, {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          }),
    select: (res) => {
      const d = res.data.data as any;
      if (!isGroupKey) return d as VehicleDetail;
      const images: string[] = (d.imageUrl ?? d.images ?? [])
        .map((img: any) => (typeof img === 'string' ? img : img?.file?.url ?? null))
        .filter(Boolean);
      return {
        publicId: d.groupKey,
        make: d.make,
        model: d.model,
        category: d.category,
        branch: d.branch,
        images,
        pricing: { daily: d.pricing?.daily ?? null },
        availability: d.availability,
        status: 'AVAILABLE',
        deposit: d.deposit ?? 0,
        advancePayAmount: Number(d.advancePayAmount ?? 0),
        pricingDetails: d.pricingDetails ?? null,
      } as VehicleDetail;
    },
    enabled: !!vehicleId,
  });

  const { data: kyc, isLoading: kycLoading } = useQuery({
    queryKey: ['kyc'],
    queryFn: () => userApi.kyc(),
    select: (res) => (res.data.data ?? []) as KycDocument[],
  });

  const handleBook = async () => {
    if (!vehicle) return;

    if (!kyc || kyc.length === 0) {
      Alert.alert(
        'KYC required',
        'You need to upload a driving license or ID document before booking. Please go to Profile → Documents.',
        [
          { text: 'Go to Profile', onPress: () => router.push('/(tabs)/profile') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/api/public/vehicles/booking', {
        vehicles: isGroupKey ? [] : [vehicle.publicId],
        groupKeys: isGroupKey ? [vehicle.publicId] : [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        file_public_id: kyc[0]!.file.publicId,
        payment_type: 'ONLINE',
        payment_flow: 'FULL',
      });

      const { holdId, data } = res.data;
      const paymentURL = data?.totals?.paymentURL;
      const transactionId: string | undefined = data?.totals?.transactionId;
      console.log(`[checkout] booking created holdId=${holdId} transactionId=${transactionId} hasPaymentURL=${!!paymentURL}`);

      if (paymentURL && transactionId?.startsWith('MT')) {
        await WebBrowser.openAuthSessionAsync(
          paymentURL,
          'wuw://payment/callback',
        );

        // Browser closed — verify payment status before proceeding
        setVerifying(true);
        let confirmed = false;
        const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];
        const MAX_ATTEMPTS = POLL_DELAYS.length + 1;
        console.log(`[checkout] browser closed, starting payment verification transactionId=${transactionId} holdId=${holdId}`);
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (!mountedRef.current) break;
          try {
            const statusRes = await api.get(`/api/payment/status/${transactionId}`);
            const { status } = statusRes.data;
            console.log(`[checkout] poll attempt=${attempt + 1}/${MAX_ATTEMPTS} status=${status}`);
            if (status === 'Success') { confirmed = true; break; }
            if (status === 'Failed') break;
            const delay = POLL_DELAYS[attempt] ?? 5000;
            if (attempt < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, delay));
          } catch (pollErr: any) {
            console.error(`[checkout] poll attempt=${attempt + 1} ERROR:`, pollErr?.response?.data ?? pollErr?.message);
            const delay = POLL_DELAYS[attempt] ?? 5000;
            if (attempt < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, delay));
          }
        }
        console.log(`[checkout] polling done confirmed=${confirmed}`);

        if (!mountedRef.current) return;
        if (confirmed) {
          await qc.invalidateQueries({ queryKey: ['bookings'] });
          router.push({ pathname: '/booking/confirmation', params: { holdId } });
        } else {
          Alert.alert(
            'Payment not completed',
            'Your payment could not be verified. Your booking hold will expire in 10 minutes. Please check My Trips or contact support.',
            [
              { text: 'View My Trips', onPress: () => router.replace('/(tabs)/trips') },
              { text: 'OK', style: 'cancel' },
            ],
          );
        }
      } else {
        // For cash bookings (no payment URL), navigate to confirmation
        // For online bookings this path should never be reached — log a warning if it is
        const isCashBooking = !paymentURL && !transactionId?.startsWith('MT');
        if (isCashBooking) {
          router.push({ pathname: '/booking/confirmation', params: { holdId } });
        } else {
          Alert.alert(
            'Payment error',
            'Could not initiate payment. Please try again or contact support.',
          );
        }
      }
    } catch (err: any) {
      Alert.alert(
        'Booking failed',
        err.response?.data?.message ?? 'Unable to complete booking. Please try again.',
      );
    } finally {
      setLoading(false);
      setVerifying(false);
    }
  };

  if (vehicleLoading || kycLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

  if (!vehicle) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Vehicle not found.</Text>
      </View>
    );
  }

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
  const pd = vehicle.pricingDetails;
  const daily = pd?.pricingBreakdown?.applicablePrice ?? vehicle.pricing?.daily ?? 0;
  // pd.finalTotal = base + tax (no deposit). Deposit is separate and added on top.
  const subtotal = pd ? pd.basePrice : daily * days;
  const deposit = pd?.deposit ?? 0;
  const tax = pd?.taxAmount ?? Math.round(subtotal * 0.18);
  const total = pd ? (pd.finalTotal + deposit) : (subtotal + deposit + tax);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Car summary */}
        <View style={styles.section}>
          <View style={styles.carRow}>
            {vehicle.images?.[0] ? (
              <Image source={{ uri: vehicle.images[0] }} style={styles.carThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.carThumb, styles.carThumbPlaceholder]} />
            )}
            <View style={styles.carInfo}>
              <Text style={styles.carName}>
                {vehicle.make} {vehicle.model}
              </Text>
              <Text style={styles.carMeta}>{vehicle.category} · {vehicle.branch}</Text>
            </View>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Dates */}
        <Text style={styles.sectionTitle}>Rental period</Text>
        <View style={styles.datesRow}>
          <DateInput label="Pick up" value={fmt(startDate)} />
          <View style={styles.dateSep}>
            <Ionicons name="arrow-forward" size={16} color={Colors.ink3} />
          </View>
          <DateInput label="Return" value={fmt(endDate)} />
        </View>

        {/* KYC status */}
        <View style={[styles.kycBanner, kyc && kyc.length > 0 ? styles.kycOk : styles.kycMissing]}>
          <Text style={[styles.kycText, kyc && kyc.length > 0 ? styles.kycTextOk : styles.kycTextMissing]}>
            {kyc && kyc.length > 0
              ? `Identity verified (${kyc.length} doc${kyc.length > 1 ? 's' : ''})`
              : 'Upload a driving license to continue'}
          </Text>
        </View>

        {/* Price breakdown */}
        <Text style={styles.sectionTitle}>Price breakdown</Text>
        <View style={styles.priceCard}>
          <LineItem
            label={pd ? `Base rate (${days} night${days !== 1 ? 's' : ''})` : `₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={`₹${(pd?.basePrice ?? daily * days).toLocaleString('en-IN')}`}
          />
          {(pd?.discountAmount ?? 0) > 0 && (
            <LineItem label="Discount" value={`-₹${pd.discountAmount.toLocaleString('en-IN')}`} />
          )}
          <LineItem label="Deposit (refundable)" value={`₹${deposit.toLocaleString('en-IN')}`} />
          <LineItem label={`GST${pd ? ` (${pd.taxRate}%)` : ''}`} value={`₹${tax.toLocaleString('en-IN')}`} />
          <View style={styles.divider} />
          <LineItem label="Total" value={`₹${total.toLocaleString('en-IN')}`} bold />
        </View>

        <Text style={styles.disclaimer}>
          Payment is processed securely via PhonePe. Deposit will be refunded upon return.
        </Text>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        <View>
          <Text style={styles.ctaTotal}>₹{total.toLocaleString('en-IN')}</Text>
          <Text style={styles.ctaTotalNote}>total · {days}d</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, loading && styles.ctaBtnLoading]}
          onPress={handleBook}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <View style={styles.ctaBtnInner}>
              <ActivityIndicator color={Colors.white} size="small" />
              {verifying && (
                <Text style={styles.ctaBtnVerifying}>Verifying payment…</Text>
              )}
            </View>
          ) : (
            <Text style={styles.ctaBtnText}>Confirm & pay →</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  errorText: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, color: Colors.ink },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  carThumb: {
    width: 64,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
  },
  carThumbPlaceholder: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  carInfo: { flex: 1 },
  carName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  carMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  editLink: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 16,
    color: Colors.ink,
    letterSpacing: -0.3,
    marginTop: 20,
    marginBottom: 10,
  },
  datesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  dateLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  dateSep: { paddingTop: 10 },
  dateSepIcon: { fontSize: 16, color: Colors.ink3 },
  kycBanner: {
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
  },
  kycOk: { backgroundColor: '#d4edda', borderColor: '#c3e6cb' },
  kycMissing: { backgroundColor: '#fff3cd', borderColor: '#ffc107' },
  kycText: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  kycTextOk: { color: '#1a7035' },
  kycTextMissing: { color: '#856404' },
  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  lineLabelBold: { fontFamily: Fonts.bodySemiBold, color: Colors.ink, fontSize: 15 },
  lineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  lineValueBold: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
  },
  divider: { height: 1, backgroundColor: Colors.hairline },
  disclaimer: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
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
  ctaTotal: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  ctaTotalNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 24,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minWidth: 160,
    alignItems: 'center',
  },
  ctaBtnLoading: { opacity: 0.8 },
  ctaBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctaBtnVerifying: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.white,
    opacity: 0.9,
  },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});
