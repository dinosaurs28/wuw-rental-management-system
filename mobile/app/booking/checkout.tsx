import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi, userApi, discountApi, api } from '../../lib/api';
import SwipeButton from '../../components/ui/SwipeButton';
import WhatsappFab from '../../components/ui/WhatsappFab';
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
  const [swipeReset, setSwipeReset] = useState(0);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [paymentFlow, setPaymentFlow] = useState<'FULL' | 'ADVANCE'>('FULL');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Active hold state — populated after a successful POST and surfaced as a
  // live countdown above the swipe CTA. Cleared on cancel/expiry.
  const [activeHold, setActiveHold] = useState<{ holdId: string; expiresAt: string } | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number>(0);
  const [cancellingHold, setCancellingHold] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Countdown ticker — runs only while a hold is active.
  useEffect(() => {
    if (!activeHold) {
      setHoldSecondsLeft(0);
      return;
    }
    const compute = () =>
      Math.max(0, Math.floor((new Date(activeHold.expiresAt).getTime() - Date.now()) / 1000));
    setHoldSecondsLeft(compute());
    const id = setInterval(() => {
      const left = compute();
      setHoldSecondsLeft(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [activeHold]);

  const handleCancelHold = () => {
    if (!activeHold) return;
    Alert.alert(
      'Cancel booking hold?',
      'Your held vehicle will be released. You can re-hold and pay again any time.',
      [
        { text: 'Keep hold', style: 'cancel' },
        {
          text: 'Cancel hold',
          style: 'destructive',
          onPress: async () => {
            const heldId = activeHold.holdId;
            setCancellingHold(true);
            try {
              await userApi.cancelHold(heldId);
            } catch (err) {
              // Best-effort — hold will expire server-side regardless.
              console.warn('[checkout] cancelHold failed:', err);
            } finally {
              if (!mountedRef.current) return;
              setCancellingHold(false);
              setActiveHold(null);
              setSwipeReset((n) => n + 1);
              await qc.invalidateQueries({ queryKey: ['bookings'] });
              router.back();
            }
          },
        },
      ],
    );
  };

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

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || !vehicle) return;
    setCouponError(null);
    setCouponLoading(true);
    try {
      const res = await discountApi.validateCoupon({
        couponCode: code,
        ...(isGroupKey ? { groupKey: vehicle.publicId } : { vehiclePublicId: vehicle.publicId }),
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
      });
      const result = res.data.data;
      if (!result.valid) {
        setCouponError(result.reason || 'Invalid coupon code.');
        return;
      }
      setAppliedCoupon(result.couponCode);
      setCouponDiscount(parseFloat(result.discountAmount) || 0);
      setCouponInput('');
    } catch (err: any) {
      setCouponError(err.response?.data?.message ?? 'Could not validate coupon.');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponError(null);
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

    setLoading(true);
    try {
      const res = await api.post('/api/public/vehicles/booking', {
        vehicles: isGroupKey ? [] : [vehicle.publicId],
        groupKeys: isGroupKey ? [vehicle.publicId] : [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        file_public_id: kyc[0]!.file.publicId,
        payment_type: 'ONLINE',
        payment_flow: paymentFlow,
        ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
      });

      const { holdId, data, expiresAt } = res.data;
      const paymentURL = data?.totals?.paymentURL;
      const transactionId: string | undefined = data?.totals?.transactionId;
      console.log(`[checkout] booking created holdId=${holdId} transactionId=${transactionId} hasPaymentURL=${!!paymentURL} expiresAt=${expiresAt}`);

      // Surface active hold + countdown so the user can see the timer / cancel
      // if they back out of the WebBrowser without paying.
      if (holdId && expiresAt) {
        setActiveHold({ holdId, expiresAt });
      }

      if (paymentURL && transactionId?.startsWith('MT')) {
        await WebBrowser.openAuthSessionAsync(
          paymentURL,
          'wuw://payment/callback',
        );

        if (!mountedRef.current) return;
        // Hand off polling to the dedicated status screen.
        router.replace({
          pathname: '/booking/status',
          params: { transactionId, holdId },
        });
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
      setSwipeReset((n) => n + 1);
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
  const subtotal = pd ? pd.basePrice : daily * days;
  const deposit = pd?.deposit ?? 0;
  const tax = pd?.taxAmount ?? Math.round(subtotal * 0.18);
  const cgstAmount = pd?.cgstAmount;
  const sgstAmount = pd?.sgstAmount;
  const baseTotal = pd ? (pd.finalTotal + deposit) : (subtotal + deposit + tax);
  const total = Math.max(0, baseTotal - couponDiscount);
  const advancePayAmount = Number(vehicle.advancePayAmount ?? 0);
  const hasAdvanceOption = advancePayAmount > 0 && advancePayAmount < total;
  const remainingAtPickup = hasAdvanceOption ? Math.max(0, total - advancePayAmount) : 0;
  const payNow = paymentFlow === 'ADVANCE' && hasAdvanceOption ? advancePayAmount : total;

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
            <View style={styles.carThumbWrap}>
              {vehicle.images?.[0] ? (
                <Image source={{ uri: vehicle.images[0] }} style={styles.carThumb} resizeMode="contain" />
              ) : (
                <Ionicons name="car-sport-outline" size={28} color="rgba(0,0,0,0.18)" />
              )}
            </View>
            <View style={styles.carInfo}>
              <Text style={styles.carMake} numberOfLines={1}>
                {vehicle.make?.toUpperCase()}
              </Text>
              <Text style={styles.carModel} numberOfLines={1}>
                {vehicle.model}
              </Text>
              <View style={styles.carMetaRow}>
                <Ionicons name="location-outline" size={11} color={Colors.ink3} />
                <Text style={styles.carMeta} numberOfLines={1}>
                  {vehicle.branch} · {vehicle.category}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => router.back()}
              hitSlop={8}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil" size={14} color={Colors.ink2} />
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

        {/* KYC status — only shown when verified (the bottom CTA handles the missing case) */}
        {kyc && kyc.length > 0 ? (
          <View style={[styles.kycBanner, styles.kycOk]}>
            <Text style={[styles.kycText, styles.kycTextOk]}>
              Identity verified ({kyc.length} doc{kyc.length > 1 ? 's' : ''})
            </Text>
          </View>
        ) : null}

        {/* Coupon */}
        <Text style={styles.sectionTitle}>Coupon code</Text>
        <View style={styles.couponCard}>
          {appliedCoupon ? (
            <View style={styles.couponPill}>
              <Ionicons name="checkmark-circle" size={16} color="#1a7035" />
              <Text style={styles.couponPillText} numberOfLines={1}>
                Applied: <Text style={styles.couponPillCode}>{appliedCoupon}</Text>
                {couponDiscount > 0 ? `  · Saved ₹${couponDiscount.toLocaleString('en-IN')}` : ''}
              </Text>
              <TouchableOpacity onPress={handleRemoveCoupon} hitSlop={8}>
                <Text style={styles.couponRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={styles.couponRow}>
                <TextInput
                  value={couponInput}
                  onChangeText={(t) => {
                    setCouponInput(t.toUpperCase());
                    if (couponError) setCouponError(null);
                  }}
                  placeholder="Enter coupon code"
                  placeholderTextColor={Colors.ink3}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!couponLoading}
                  style={[styles.couponInput, !!couponError && styles.couponInputError]}
                />
                <TouchableOpacity
                  onPress={handleApplyCoupon}
                  disabled={!couponInput.trim() || couponLoading}
                  activeOpacity={0.8}
                  style={[
                    styles.couponApplyBtn,
                    (!couponInput.trim() || couponLoading) && styles.couponApplyBtnDisabled,
                  ]}
                >
                  {couponLoading ? (
                    <ActivityIndicator size="small" color={Colors.orange} />
                  ) : (
                    <Text style={styles.couponApplyText}>Apply</Text>
                  )}
                </TouchableOpacity>
              </View>
              {couponError ? (
                <Text style={styles.couponErrorText}>{couponError}</Text>
              ) : null}
            </View>
          )}
        </View>

        {/* Payment plan */}
        {hasAdvanceOption ? (
          <>
            <Text style={styles.sectionTitle}>Payment plan</Text>
            <View style={styles.planSegment}>
              <TouchableOpacity
                style={[styles.planOption, paymentFlow === 'FULL' && styles.planOptionActive]}
                onPress={() => setPaymentFlow('FULL')}
                activeOpacity={0.85}
              >
                <Text style={[styles.planLabel, paymentFlow === 'FULL' && styles.planLabelActive]}>
                  Pay full now
                </Text>
                <Text style={[styles.planAmount, paymentFlow === 'FULL' && styles.planAmountActive]}>
                  ₹{total.toLocaleString('en-IN')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.planOption, paymentFlow === 'ADVANCE' && styles.planOptionActive]}
                onPress={() => setPaymentFlow('ADVANCE')}
                activeOpacity={0.85}
              >
                <Text style={[styles.planLabel, paymentFlow === 'ADVANCE' && styles.planLabelActive]}>
                  Advance + pay at pickup
                </Text>
                <Text style={[styles.planAmount, paymentFlow === 'ADVANCE' && styles.planAmountActive]}>
                  ₹{advancePayAmount.toLocaleString('en-IN')} now
                </Text>
                <Text style={[styles.planSub, paymentFlow === 'ADVANCE' && styles.planSubActive]}>
                  ₹{remainingAtPickup.toLocaleString('en-IN')} at pickup
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {/* Price breakdown */}
        <Text style={styles.sectionTitle}>Price breakdown</Text>
        <View style={styles.priceCard}>
          <LineItem
            label={pd ? `Base rate (${days} night${days !== 1 ? 's' : ''})` : `₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={`₹${(pd?.basePrice ?? daily * days).toLocaleString('en-IN')}`}
          />
          {pd && pd.discountAmount > 0 && (
            <LineItem label="Discount" value={`-₹${pd.discountAmount.toLocaleString('en-IN')}`} />
          )}
          {couponDiscount > 0 && appliedCoupon ? (
            <LineItem label={`Coupon (${appliedCoupon})`} value={`-₹${couponDiscount.toLocaleString('en-IN')}`} />
          ) : null}
          <LineItem label="Deposit (refundable)" value={`₹${deposit.toLocaleString('en-IN')}`} />
          {cgstAmount != null && sgstAmount != null && pd ? (
            <>
              <LineItem
                label={`CGST (${(pd.taxRate / 2).toLocaleString('en-IN')}%)`}
                value={`₹${cgstAmount.toLocaleString('en-IN')}`}
              />
              <LineItem
                label={`SGST (${(pd.taxRate / 2).toLocaleString('en-IN')}%)`}
                value={`₹${sgstAmount.toLocaleString('en-IN')}`}
              />
            </>
          ) : (
            <LineItem label={`GST${pd ? ` (${pd.taxRate}%)` : ''}`} value={`₹${tax.toLocaleString('en-IN')}`} />
          )}
          <View style={styles.divider} />
          <LineItem label="Total" value={`₹${total.toLocaleString('en-IN')}`} bold />
          {paymentFlow === 'ADVANCE' && hasAdvanceOption ? (
            <View style={styles.advanceNote}>
              <View style={styles.lineItem}>
                <Text style={styles.advanceNoteLabel}>Pay now</Text>
                <Text style={styles.advanceNoteValue}>₹{advancePayAmount.toLocaleString('en-IN')}</Text>
              </View>
              <View style={styles.lineItem}>
                <Text style={styles.advanceNoteLabelMuted}>Remaining at pickup</Text>
                <Text style={styles.advanceNoteValueMuted}>₹{remainingAtPickup.toLocaleString('en-IN')}</Text>
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.disclaimer}>
          Payment is processed securely via PhonePe. Deposit will be refunded upon return.
        </Text>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        {kyc && kyc.length > 0 ? (
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setTermsAccepted((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.termsBox, termsAccepted && styles.termsBoxChecked]}>
              {termsAccepted ? (
                <Ionicons name="checkmark" size={14} color={Colors.white} />
              ) : null}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => router.push('/legal/terms' as any)}
              >
                Terms of Service
              </Text>
            </Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.ctaSummary}>
          <Text style={styles.ctaTotalNote}>
            {paymentFlow === 'ADVANCE' && hasAdvanceOption
              ? `Pay now · ${days} day${days !== 1 ? 's' : ''}`
              : `Total · ${days} day${days !== 1 ? 's' : ''}`}
          </Text>
          <Text style={styles.ctaTotal}>₹{payNow.toLocaleString('en-IN')}</Text>
        </View>
        {!kyc || kyc.length === 0 ? (
          <TouchableOpacity
            style={styles.uploadBlocker}
            onPress={() => router.push('/(tabs)/profile')}
            activeOpacity={0.85}
          >
            <View style={styles.uploadBlockerIcon}>
              <Ionicons name="document-text-outline" size={20} color="#856404" />
            </View>
            <View style={styles.uploadBlockerText}>
              <Text style={styles.uploadBlockerTitle}>Upload driving license</Text>
              <Text style={styles.uploadBlockerSub}>Required to confirm your booking</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#856404" />
          </TouchableOpacity>
        ) : (
          <>
            {/* Hold countdown — shown after a hold is created, above the swipe CTA */}
            {activeHold ? (
              <View style={styles.holdBlock}>
                {holdSecondsLeft > 0 ? (
                  <View
                    style={[
                      styles.holdPill,
                      holdSecondsLeft < 60
                        ? styles.holdPillUrgent
                        : holdSecondsLeft < 180
                          ? styles.holdPillWarn
                          : styles.holdPillOk,
                    ]}
                  >
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={
                        holdSecondsLeft < 180 ? '#8a3a00' : '#1a7035'
                      }
                    />
                    <Text
                      style={[
                        styles.holdPillText,
                        holdSecondsLeft < 180
                          ? styles.holdPillTextWarn
                          : styles.holdPillTextOk,
                      ]}
                    >
                      Booking held · {String(Math.floor(holdSecondsLeft / 60)).padStart(2, '0')}:
                      {String(holdSecondsLeft % 60).padStart(2, '0')} remaining
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.holdPill, styles.holdPillExpired]}>
                    <Ionicons name="alert-circle-outline" size={13} color="#a31515" />
                    <Text style={[styles.holdPillText, styles.holdPillTextExpired]}>
                      Hold expired — re-hold to continue
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  onPress={handleCancelHold}
                  disabled={cancellingHold}
                  hitSlop={8}
                >
                  <Text style={styles.cancelHoldText}>
                    {cancellingHold ? 'Cancelling…' : 'Cancel and go back'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeHold && holdSecondsLeft <= 0 ? (
              <TouchableOpacity
                style={styles.rehold}
                onPress={() => {
                  setActiveHold(null);
                  setSwipeReset((n) => n + 1);
                  handleBook();
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.reholdText}>Re-hold and pay</Text>
              </TouchableOpacity>
            ) : (
              <SwipeButton
                label="Slide to confirm & pay"
                loadingLabel={verifying ? 'Verifying payment…' : 'Processing…'}
                loading={loading}
                disabled={!termsAccepted}
                onComplete={handleBook}
                resetSignal={swipeReset}
              />
            )}
          </>
        )}
      </View>
      <WhatsappFab bottom={insets.bottom + 180} />
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
  carRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  carThumbWrap: {
    width: 88,
    height: 72,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#f6f6f4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carThumb: { width: '100%', height: '100%' },
  carInfo: { flex: 1, gap: 2 },
  carMake: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.ink3,
    letterSpacing: 1.4,
  },
  carModel: {
    fontFamily: Fonts.displayBold,
    fontSize: 17,
    color: Colors.ink,
    letterSpacing: -0.4,
    lineHeight: 21,
  },
  carMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  carMeta: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    flexShrink: 1,
  },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
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
  kycText: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  kycTextOk: { color: '#1a7035' },
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
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 14,
  },
  ctaSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  ctaTotal: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  ctaTotalNote: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  uploadBlocker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff3cd',
    borderWidth: 1,
    borderColor: '#ffc107',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  uploadBlockerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#ffe299',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBlockerText: { flex: 1 },
  uploadBlockerTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: '#856404',
    letterSpacing: 0.1,
  },
  uploadBlockerSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: '#856404',
    opacity: 0.85,
    marginTop: 2,
  },
  couponCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  couponInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    color: Colors.ink,
    backgroundColor: Colors.bg,
    letterSpacing: 0.5,
  },
  couponInputError: {
    borderColor: '#dc2626',
  },
  couponApplyBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
  },
  couponApplyBtnDisabled: {
    opacity: 0.5,
  },
  couponApplyText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.orange,
    letterSpacing: 0.3,
  },
  couponErrorText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: '#dc2626',
    marginTop: 6,
    paddingLeft: 4,
  },
  couponPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#d4edda',
    borderWidth: 1,
    borderColor: '#c3e6cb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  couponPillText: {
    flex: 1,
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: '#1a7035',
  },
  couponPillCode: {
    fontFamily: Fonts.bodySemiBold,
    letterSpacing: 0.5,
  },
  couponRemove: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: '#1a7035',
    textDecorationLine: 'underline',
  },
  planSegment: {
    flexDirection: 'row',
    gap: 8,
  },
  planOption: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 4,
  },
  planOptionActive: {
    borderColor: Colors.orange,
    backgroundColor: '#fff7f0',
  },
  planLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    letterSpacing: 0.2,
  },
  planLabelActive: {
    color: Colors.ink,
  },
  planAmount: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.ink,
    letterSpacing: -0.2,
  },
  planAmountActive: {
    color: Colors.orange,
  },
  planSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
  },
  planSubActive: {
    color: Colors.ink2,
  },
  advanceNote: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    gap: 6,
  },
  advanceNoteLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.orange,
  },
  advanceNoteValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.orange,
  },
  advanceNoteLabelMuted: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
  },
  advanceNoteValueMuted: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink2,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  termsBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  termsBoxChecked: {
    backgroundColor: Colors.orange,
    borderColor: Colors.orange,
  },
  termsText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink2,
  },
  termsLink: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.orange,
    textDecorationLine: 'underline',
  },

  // Hold countdown block (shown above swipe CTA once hold is active)
  holdBlock: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  holdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  holdPillOk: {
    backgroundColor: '#e6f4ea',
    borderColor: '#c3e6cb',
  },
  holdPillWarn: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffe299',
  },
  holdPillUrgent: {
    backgroundColor: '#ffe2c2',
    borderColor: '#ffc78a',
  },
  holdPillExpired: {
    backgroundColor: '#fdecea',
    borderColor: '#f5c6cb',
  },
  holdPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  holdPillTextOk: { color: '#1a7035' },
  holdPillTextWarn: { color: '#8a3a00' },
  holdPillTextExpired: { color: '#a31515' },
  cancelHoldText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.ink3,
    textDecorationLine: 'underline',
  },
  rehold: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  reholdText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.3,
  },
});
