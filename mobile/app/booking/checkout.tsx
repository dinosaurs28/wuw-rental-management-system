import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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
  const insets = useSafeAreaInsets();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();

  const tomorrow = new Date(Date.now() + 86400 * 1000);
  const dayAfter = new Date(Date.now() + 2 * 86400 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const [startDate] = useState(tomorrow);
  const [endDate] = useState(dayAfter);
  const [loading, setLoading] = useState(false);

  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () =>
      vehiclesApi.detail(vehicleId!, {
        start: tomorrow.toISOString(),
        end: dayAfter.toISOString(),
      }),
    select: (res) => res.data.data as VehicleDetail,
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
        vehicles: [vehicle.publicId],
        groupKeys: [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        file_public_id: kyc[0]!.publicId,
        payment_type: 'ONLINE',
        payment_flow: 'FULL',
      });

      const { holdId, data } = res.data;
      const paymentURL = data?.totals?.paymentURL;

      if (paymentURL) {
        await WebBrowser.openBrowserAsync(paymentURL, {
          dismissButtonStyle: 'cancel',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        });
        router.push({ pathname: '/booking/confirmation', params: { holdId } });
      } else {
        router.push({ pathname: '/booking/confirmation', params: { holdId } });
      }
    } catch (err: any) {
      Alert.alert(
        'Booking failed',
        err.response?.data?.message ?? 'Unable to complete booking. Please try again.',
      );
    } finally {
      setLoading(false);
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

  const days = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000),
  );
  const daily = vehicle.pricing?.daily ?? 0;
  const subtotal = daily * days;
  const deposit = vehicle.pricingDetails?.deposit ?? 0;
  const tax = vehicle.pricingDetails
    ? vehicle.pricingDetails.taxAmount
    : Math.round(subtotal * 0.18);
  const total = subtotal + deposit + tax;

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
            <View style={styles.carThumb} />
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
            label={`₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={`₹${subtotal.toLocaleString('en-IN')}`}
          />
          <LineItem label="Deposit (refundable)" value={`₹${deposit.toLocaleString('en-IN')}`} />
          <LineItem label="GST" value={`₹${tax.toLocaleString('en-IN')}`} />
          <View style={styles.divider} />
          <LineItem
            label="Total"
            value={`₹${total.toLocaleString('en-IN')}`}
            bold
          />
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
            <ActivityIndicator color={Colors.white} size="small" />
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
    backgroundColor: '#1a1a1a',
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
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    minWidth: 160,
    alignItems: 'center',
  },
  ctaBtnLoading: { opacity: 0.8 },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});
