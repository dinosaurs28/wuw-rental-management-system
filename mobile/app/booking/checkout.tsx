import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi, userApi } from '../../lib/api';
import { LEGAL_URLS } from '../../constants/links';
import type { VehicleDetail, KycDocument } from '../../types/api';

function DateInput({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dateInput}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{value || 'Select date'}</Text>
    </View>
  );
}

function LineItem({
  label,
  value,
  bold,
  credit,
}: {
  label: string;
  value: string;
  bold?: boolean;
  credit?: boolean;
}) {
  return (
    <View style={styles.lineItem}>
      <Text style={[styles.lineLabel, bold && styles.lineLabelBold]}>{label}</Text>
      <Text
        style={[
          styles.lineValue,
          bold && styles.lineValueBold,
          credit && styles.lineValueCredit,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { vehicleId, start, end } = useLocalSearchParams<{ vehicleId: string; start?: string; end?: string }>();

  const fmt = (d: Date) =>
    d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const [startDate] = useState(() => (start ? new Date(start) : new Date(Date.now() + 86400 * 1000)));
  const [endDate] = useState(() => (end ? new Date(end) : new Date(Date.now() + 2 * 86400 * 1000)));
  const [loading, setLoading] = useState(false);
  // #36 — which uploaded KYC doc to submit (defaults to the first)
  const [selectedKycId, setSelectedKycId] = useState<string | null>(null);

  // Coupon
  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; amount: number } | null>(null);

  // Payment plan + terms
  const [flow, setFlow] = useState<'FULL' | 'ADVANCE'>('FULL');
  const [terms, setTerms] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const isGroupKey = !!vehicleId && vehicleId.includes('__');

  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ['vehicle', vehicleId, startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      isGroupKey
        ? vehiclesApi.groupDetail(vehicleId!, { start: startDate.toISOString(), end: endDate.toISOString() })
        : vehiclesApi.detail(vehicleId!, { start: startDate.toISOString(), end: endDate.toISOString() }),
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

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code || !vehicle) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await vehiclesApi.validateCoupon({
        couponCode: code,
        ...(isGroupKey ? { groupKey: vehicle.publicId } : { vehiclePublicId: vehicle.publicId }),
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
      });
      const d = res.data?.data;
      if (d?.valid) {
        setAppliedCoupon({ code: d.couponCode ?? code.toUpperCase(), amount: Number(d.discountAmount ?? 0) });
        setCouponInput('');
      } else {
        setCouponError(d?.reason ?? 'This coupon is not valid for this booking.');
      }
    } catch (err: any) {
      setCouponError(err?.response?.data?.message ?? 'Could not validate coupon.');
    } finally {
      setCouponBusy(false);
    }
  };

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
    if (!terms) {
      Alert.alert('Accept terms', 'Please accept the Terms & Conditions to continue.');
      return;
    }

    // Recompute advance validity at submit time using the SAME fallback as the
    // displayed total, so the sent payment_flow can never diverge from the
    // pay-now amount shown in the CTA (even when pricingDetails is null).
    const pdNow = vehicle.pricingDetails;
    const daysNow = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
    const dailyNow = pdNow?.pricingBreakdown?.applicablePrice ?? vehicle.pricing?.daily ?? 0;
    const subtotalNow = pdNow ? pdNow.basePrice : dailyNow * daysNow;
    const depositNow = pdNow?.deposit ?? 0;
    const taxNow = pdNow?.taxAmount ?? Math.round(subtotalNow * 0.18);
    const baseTotalNow = pdNow ? pdNow.finalTotal + depositNow : subtotalNow + depositNow + taxNow;
    const totalNow = Math.max(0, baseTotalNow - (appliedCoupon?.amount ?? 0));
    const advNow = vehicle.advancePayAmount ?? 0;
    const sendFlow: 'FULL' | 'ADVANCE' =
      flow === 'ADVANCE' && advNow > 0 && advNow < totalNow ? 'ADVANCE' : 'FULL';

    // #36 — submit the customer-chosen KYC doc (default: first).
    const chosenKyc = kyc.find((k) => k.publicId === selectedKycId) ?? kyc[0]!;

    setLoading(true);
    try {
      const res = await vehiclesApi.createBooking({
        vehicles: isGroupKey ? [] : [vehicle.publicId],
        groupKeys: isGroupKey ? [vehicle.publicId] : [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        file_public_id: chosenKyc.file.publicId,
        payment_type: 'ONLINE',
        payment_flow: sendFlow,
        ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      });

      const { holdId, data } = res.data;
      const totals = data?.totals ?? {};
      const paymentURL: string | undefined = totals.paymentURL;
      const transactionId: string | undefined = totals.transactionId;

      const confirmParams = {
        holdId,
        make: vehicle.make,
        model: vehicle.model,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        total: String(totals.grandFinalTotal ?? ''),
        deposit: String(totals.grandDeposit ?? ''),
        payNow: String(totals.advanceAmount ?? ''),
        remaining: String(totals.remainingBalance ?? 0),
        flow: sendFlow,
        coupon: totals.appliedCouponCode ?? '',
      };

      if (!paymentURL || !transactionId?.startsWith('MT')) {
        Alert.alert('Payment error', 'Could not initiate payment. Please try again or contact support.');
        return;
      }

      const browserResult = await WebBrowser.openAuthSessionAsync(paymentURL, 'wuw://payment/callback');
      if (browserResult.type === 'cancel' || browserResult.type === 'dismiss') {
        // #43 — release the inventory hold immediately instead of waiting 10 min to expire.
        try { await userApi.cancelHold(holdId); } catch { /* best-effort */ }
        Alert.alert('Payment cancelled', 'You closed the payment page, so the booking hold was released.');
        return;
      }

      // #38 — hand off to the dedicated status screen (polls + success/pending/failed states).
      if (!mountedRef.current) return;
      router.replace({
        pathname: '/booking/payment-status',
        params: { transactionId, ...confirmParams },
      });
    } catch (err: any) {
      Alert.alert('Booking failed', err.response?.data?.message ?? 'Unable to complete booking. Please try again.');
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

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
  const pd = vehicle.pricingDetails;
  const daily = pd?.pricingBreakdown?.applicablePrice ?? vehicle.pricing?.daily ?? 0;
  const subtotal = pd ? pd.basePrice : daily * days;
  const deposit = pd?.deposit ?? 0;
  const tax = pd?.taxAmount ?? Math.round(subtotal * 0.18);
  const couponDiscount = appliedCoupon?.amount ?? 0;
  const baseTotal = pd ? pd.finalTotal + deposit : subtotal + deposit + tax;
  const total = Math.max(0, baseTotal - couponDiscount);

  const chosenKyc = kyc?.find((k) => k.publicId === selectedKycId) ?? kyc?.[0] ?? null;
  const advanceAmount = vehicle.advancePayAmount ?? 0;
  const canAdvance = advanceAmount > 0 && advanceAmount < total;
  const effectiveFlow: 'FULL' | 'ADVANCE' = canAdvance && flow === 'ADVANCE' ? 'ADVANCE' : 'FULL';
  const payNow = effectiveFlow === 'ADVANCE' ? advanceAmount : total;
  const remainingAtPickup = effectiveFlow === 'ADVANCE' ? Math.max(0, total - advanceAmount) : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Car summary */}
        <View style={styles.section}>
          <View style={styles.carRow}>
            {vehicle.images?.[0] ? (
              <Image source={{ uri: vehicle.images[0] }} style={styles.carThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.carThumb, styles.carThumbPlaceholder]} />
            )}
            <View style={styles.carInfo}>
              <Text style={styles.carName}>{vehicle.make} {vehicle.model}</Text>
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

        {/* #36 — pick which KYC doc to submit when more than one is on file */}
        {kyc && kyc.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Document to submit</Text>
            <View style={{ gap: 8 }}>
              {kyc.map((doc) => {
                const selected = doc.publicId === (chosenKyc?.publicId ?? null);
                return (
                  <TouchableOpacity
                    key={doc.publicId}
                    style={[styles.kycPick, selected && styles.kycPickActive]}
                    onPress={() => setSelectedKycId(doc.publicId)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri: doc.file.url }} style={styles.kycPickThumb} resizeMode="cover" />
                    <View style={styles.kycPickInfo}>
                      <Text style={styles.kycPickType}>
                        {doc.type.replace(/_/g, ' ')}{doc.side ? ` · ${doc.side}` : ''}
                      </Text>
                      <Text style={styles.kycPickStatus}>{doc.status}</Text>
                    </View>
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? Colors.orange : Colors.ink4}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Coupon */}
        <Text style={styles.sectionTitle}>Coupon</Text>
        {appliedCoupon ? (
          <View style={styles.couponApplied}>
            <Ionicons name="pricetag" size={16} color="#2d9d61" />
            <Text style={styles.couponAppliedText}>
              <Text style={styles.couponCode}>{appliedCoupon.code}</Text> applied · −₹
              {appliedCoupon.amount.toLocaleString('en-IN')}
            </Text>
            <TouchableOpacity onPress={() => setAppliedCoupon(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={Colors.ink4} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.couponRow}>
            <TextInput
              style={styles.couponInput}
              value={couponInput}
              onChangeText={(t) => { setCouponInput(t); setCouponError(null); }}
              placeholder="Enter coupon code"
              placeholderTextColor={Colors.ink4}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.couponBtn, (!couponInput.trim() || couponBusy) && styles.couponBtnDisabled]}
              onPress={applyCoupon}
              disabled={!couponInput.trim() || couponBusy}
              activeOpacity={0.85}
            >
              {couponBusy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.couponBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        )}
        {couponError && <Text style={styles.couponErrorText}>{couponError}</Text>}

        {/* Price breakdown */}
        <Text style={styles.sectionTitle}>Price breakdown</Text>
        <View style={styles.priceCard}>
          <LineItem
            label={pd ? `Base rate (${days} day${days !== 1 ? 's' : ''})` : `₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={`₹${(pd?.basePrice ?? daily * days).toLocaleString('en-IN')}`}
          />
          {(pd?.discountAmount ?? 0) > 0 && (
            <LineItem label="Discount" value={`−₹${pd!.discountAmount.toLocaleString('en-IN')}`} credit />
          )}
          {couponDiscount > 0 && (
            <LineItem label={`Coupon (${appliedCoupon!.code})`} value={`−₹${couponDiscount.toLocaleString('en-IN')}`} credit />
          )}
          <LineItem label="Deposit (refundable)" value={`₹${deposit.toLocaleString('en-IN')}`} />
          <LineItem label={`GST${pd ? ` (${pd.taxRate}%)` : ''}`} value={`₹${tax.toLocaleString('en-IN')}`} />
          <View style={styles.divider} />
          <LineItem label="Total" value={`₹${total.toLocaleString('en-IN')}`} bold />
        </View>

        {/* Payment plan */}
        {canAdvance && (
          <>
            <Text style={styles.sectionTitle}>Payment plan</Text>
            <View style={styles.planRow}>
              <TouchableOpacity
                style={[styles.planCard, flow === 'FULL' && styles.planCardActive]}
                onPress={() => setFlow('FULL')}
                activeOpacity={0.85}
              >
                <View style={styles.planTop}>
                  <Text style={[styles.planTitle, flow === 'FULL' && styles.planTitleActive]}>Pay full</Text>
                  {flow === 'FULL' && <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />}
                </View>
                <Text style={styles.planAmount}>₹{total.toLocaleString('en-IN')}</Text>
                <Text style={styles.planNote}>Nothing due at pickup</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.planCard, flow === 'ADVANCE' && styles.planCardActive]}
                onPress={() => setFlow('ADVANCE')}
                activeOpacity={0.85}
              >
                <View style={styles.planTop}>
                  <Text style={[styles.planTitle, flow === 'ADVANCE' && styles.planTitleActive]}>Pay advance</Text>
                  {flow === 'ADVANCE' && <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />}
                </View>
                <Text style={styles.planAmount}>₹{advanceAmount.toLocaleString('en-IN')}</Text>
                <Text style={styles.planNote}>₹{Math.max(0, total - advanceAmount).toLocaleString('en-IN')} at pickup</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Terms */}
        <TouchableOpacity style={styles.termsRow} onPress={() => setTerms((t) => !t)} activeOpacity={0.8}>
          <View style={[styles.checkbox, terms && styles.checkboxOn]}>
            {terms && <Ionicons name="checkmark" size={13} color={Colors.white} />}
          </View>
          <Text style={styles.termsText}>
            I agree to the{' '}
            <Text style={styles.termsLink} onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}>
              Terms & Conditions
            </Text>{' '}
            and{' '}
            <Text style={styles.termsLink} onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
              Privacy Policy
            </Text>
            .
          </Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Payment is processed securely via PhonePe. Deposit will be refunded upon return.
        </Text>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        <View>
          <Text style={styles.ctaTotal}>₹{payNow.toLocaleString('en-IN')}</Text>
          <Text style={styles.ctaTotalNote}>
            {flow === 'ADVANCE' && canAdvance ? `pay now · ₹${remainingAtPickup.toLocaleString('en-IN')} later` : `total · ${days}d`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, (loading || !terms) && styles.ctaBtnLoading]}
          onPress={handleBook}
          disabled={loading || !terms}
          activeOpacity={0.85}
        >
          {loading ? (
            <View style={styles.ctaBtnInner}>
              <ActivityIndicator color={Colors.white} size="small" />
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
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
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
  carThumb: { width: 64, height: 48, borderRadius: 10, overflow: 'hidden' },
  carThumbPlaceholder: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
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
  datesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  dateValue: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  dateSep: { paddingTop: 10 },
  kycBanner: { borderRadius: 12, padding: 12, marginTop: 16, borderWidth: 1 },
  kycOk: { backgroundColor: '#d4edda', borderColor: '#c3e6cb' },
  kycMissing: { backgroundColor: '#fff3cd', borderColor: '#ffc107' },
  kycText: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  kycTextOk: { color: '#1a7035' },
  kycTextMissing: { color: '#856404' },

  kycPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    padding: 10,
  },
  kycPickActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  kycPickThumb: { width: 48, height: 40, borderRadius: 8, backgroundColor: Colors.bg },
  kycPickInfo: { flex: 1 },
  kycPickType: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, textTransform: 'capitalize' },
  kycPickStatus: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },

  // Coupon
  couponRow: { flexDirection: 'row', gap: 10 },
  couponInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: 0.5,
  },
  couponBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  couponBtnDisabled: { opacity: 0.4 },
  couponBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  couponApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e8f5ee',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d9d6130',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  couponAppliedText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#1a7035' },
  couponCode: { fontFamily: Fonts.bodySemiBold },
  couponErrorText: { fontFamily: Fonts.body, fontSize: 12, color: '#dc3545', marginTop: 8 },

  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  lineLabelBold: { fontFamily: Fonts.bodySemiBold, color: Colors.ink, fontSize: 15 },
  lineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  lineValueBold: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  lineValueCredit: { color: '#2d9d61' },
  divider: { height: 1, backgroundColor: Colors.hairline },

  // Payment plan
  planRow: { flexDirection: 'row', gap: 10 },
  planCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    padding: 14,
    gap: 4,
  },
  planCardActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  planTitleActive: { color: Colors.ink, fontFamily: Fonts.bodySemiBold },
  planAmount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  planNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },

  // Terms
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.ink4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  termsText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19 },
  termsLink: { fontFamily: Fonts.bodySemiBold, color: Colors.orange },

  disclaimer: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 16, lineHeight: 18, textAlign: 'center' },
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
  ctaTotal: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.5 },
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
  ctaBtnLoading: { opacity: 0.6 },
  ctaBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctaBtnVerifying: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.white, opacity: 0.9 },
  ctaBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white, letterSpacing: 0.2 },
});
