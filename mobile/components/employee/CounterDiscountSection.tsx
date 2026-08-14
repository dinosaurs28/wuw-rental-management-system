import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

interface DiscountSummary {
  couponCode: string | null;
  durationDiscountAmount: string;
  couponDiscountAmount: string;
  manualDiscountAmount: string;
  totalDiscountAmount: string;
  finalTotal: string;
  manualDiscount: { publicId: string; amount: string; reason: string; status: string; requiresApproval: boolean } | null;
}

const inr = (v: string | number) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// #52 — counter coupon + manual discount. All money values arrive as STRINGS.
export default function CounterDiscountSection({ bookingId, onChanged }: { bookingId: string; onChanged?: () => void }) {
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAmt, setManualAmt] = useState('');
  const [manualReason, setManualReason] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['employee', 'discount-summary', bookingId],
    queryFn: async () => (await employeeApi.getDiscountSummary(bookingId)).data?.data ?? null,
    select: (d: any) => d as DiscountSummary | null,
    staleTime: 15_000,
    retry: false,
  });

  const refresh = () => { refetch(); onChanged?.(); };

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    setBusy(true);
    try {
      await employeeApi.applyDiscountCoupon(bookingId, code);
      setCoupon('');
      refresh();
    } catch (err: any) {
      Alert.alert('Coupon', err?.response?.data?.message ?? 'Could not apply coupon.');
    } finally { setBusy(false); }
  };

  // Note: the backend only permits coupon REMOVAL on HOLD bookings, but this panel is
  // mounted on the pickup screen (CONFIRMED) where removal is rejected — so we show the
  // applied coupon read-only rather than a Remove control that would always fail.

  const applyManual = async () => {
    const amt = Number(manualAmt);
    if (!(amt > 0)) { Alert.alert('Amount', 'Enter a valid discount amount.'); return; }
    if (manualReason.trim().length < 5) { Alert.alert('Reason', 'Reason must be at least 5 characters.'); return; }
    setBusy(true);
    try {
      const res = await employeeApi.applyManualDiscount(bookingId, { amount: amt, reason: manualReason.trim() });
      const d = res.data?.data;
      Alert.alert(
        'Manual discount',
        d?.requiresApproval ? 'Discount issued — pending manager approval.' : 'Discount applied.',
      );
      setManualAmt('');
      setManualReason('');
      setShowManual(false);
      refresh();
    } catch (err: any) {
      Alert.alert('Manual discount', err?.response?.data?.message ?? 'Could not apply discount.');
    } finally { setBusy(false); }
  };

  const total = Number(data?.totalDiscountAmount ?? 0);
  const manual = data?.manualDiscount;

  return (
    <View style={styles.card}>
      {isLoading ? (
        <ActivityIndicator color={Colors.orange} />
      ) : (
        <>
          {/* Summary */}
          {data && total > 0 && (
            <View style={styles.summary}>
              {Number(data.couponDiscountAmount) > 0 && (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Coupon{data.couponCode ? ` (${data.couponCode})` : ''}</Text>
                  <Text style={styles.sumValue}>−{inr(data.couponDiscountAmount)}</Text>
                </View>
              )}
              {Number(data.manualDiscountAmount) > 0 && (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Manual discount</Text>
                  <Text style={styles.sumValue}>−{inr(data.manualDiscountAmount)}</Text>
                </View>
              )}
              <View style={styles.sumRow}>
                <Text style={styles.sumLabelBold}>Total discount</Text>
                <Text style={styles.sumValueBold}>−{inr(total)}</Text>
              </View>
            </View>
          )}

          {manual && (
            <View style={[styles.pendingBox, manual.status === 'APPROVED' ? styles.pendingOk : styles.pendingWarn]}>
              <Ionicons
                name={manual.status === 'APPROVED' ? 'checkmark-circle' : 'time-outline'}
                size={15}
                color={manual.status === 'APPROVED' ? '#10b981' : '#d97706'}
              />
              <Text style={styles.pendingText}>
                Manual {inr(manual.amount)} · {manual.status === 'PENDING_APPROVAL' ? 'awaiting manager approval' : manual.status.toLowerCase()}
              </Text>
            </View>
          )}

          {/* Coupon */}
          {data?.couponCode ? (
            <View style={styles.couponApplied}>
              <Ionicons name="pricetag" size={15} color="#2d9d61" />
              <Text style={styles.couponAppliedText}>{data.couponCode} applied</Text>
            </View>
          ) : (
            <View style={styles.couponRow}>
              <TextInput
                style={styles.couponInput}
                value={coupon}
                onChangeText={setCoupon}
                placeholder="Coupon code"
                placeholderTextColor={Colors.ink4}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.applyBtn, (!coupon.trim() || busy) && styles.btnDisabled]}
                onPress={applyCoupon}
                disabled={!coupon.trim() || busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.applyBtnText}>Apply</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Manual discount */}
          <TouchableOpacity style={styles.manualToggle} onPress={() => setShowManual((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={showManual ? 'remove-circle-outline' : 'add-circle-outline'} size={16} color={Colors.ink2} />
            <Text style={styles.manualToggleText}>Manual discount</Text>
          </TouchableOpacity>
          {showManual && (
            <>
              <TextInput
                style={styles.input}
                value={manualAmt}
                onChangeText={(t) => setManualAmt(t.replace(/[^0-9]/g, ''))}
                placeholder="Amount ₹"
                placeholderTextColor={Colors.ink4}
                keyboardType="numeric"
              />
              <TextInput
                style={styles.input}
                value={manualReason}
                onChangeText={setManualReason}
                placeholder="Reason (min 5 chars)"
                placeholderTextColor={Colors.ink4}
              />
              <TouchableOpacity
                style={[styles.applyBtnWide, busy && styles.btnDisabled]}
                onPress={applyManual}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.applyBtnText}>Apply manual discount</Text>}
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4, gap: 12 },
  summary: { gap: 6 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  sumValue: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#2d9d61' },
  sumLabelBold: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  sumValueBold: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#2d9d61' },
  pendingBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10 },
  pendingWarn: { backgroundColor: '#fef3c7' },
  pendingOk: { backgroundColor: '#dcfce7' },
  pendingText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  couponRow: { flexDirection: 'row', gap: 10 },
  couponInput: {
    flex: 1, backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 11, fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink, letterSpacing: 0.5,
  },
  applyBtn: { backgroundColor: Colors.ink, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  applyBtnWide: { backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  btnDisabled: { opacity: 0.4 },
  couponApplied: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e8f5ee', borderRadius: 12,
    borderWidth: 1, borderColor: '#2d9d6130', paddingHorizontal: 14, paddingVertical: 11,
  },
  couponAppliedText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#1a7035' },
  removeText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc3545' },
  manualToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  manualToggleText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 11, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink,
  },
});
