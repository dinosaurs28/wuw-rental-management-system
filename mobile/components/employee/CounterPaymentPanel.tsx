import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import type { FinancialState } from '../../types/api';

const inr = (v: unknown) => `₹${Math.abs(Number(v ?? 0)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const LIFECYCLE: Record<string, { label: string; color: string }> = {
  UNPAID: { label: 'Unpaid', color: '#dc3545' },
  PARTIALLY_PAID: { label: 'Partially paid', color: '#d97706' },
  PAID_PENDING_CONFIRMATION: { label: 'Pending confirmation', color: '#d97706' },
  FULLY_PAID: { label: 'Fully paid', color: '#10b981' },
  OVERPAID: { label: 'Overpaid', color: '#3b82f6' },
  REFUNDED: { label: 'Refunded', color: '#3b82f6' },
};

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: '#10b981',
  COLLECTED: '#d97706',
  INITIATED: Colors.ink3,
  REJECTED: '#dc3545',
  FAILED: '#dc3545',
  REFUNDED: '#3b82f6',
};

function fmtDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function prettyPurpose(p: string) {
  return p.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  bookingPublicId: string;
}

// Read-only financial summary + transaction ledger for a booking. Money is
// collected via the dedicated balance/return flows; this panel is the audit view.
export default function CounterPaymentPanel({ bookingPublicId }: Props) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<FinancialState | null>({
    queryKey: ['employee', 'financial-state', bookingPublicId],
    queryFn: async () => {
      const res = await employeeApi.financialState(bookingPublicId);
      return (res.data?.data ?? null) as FinancialState | null;
    },
    enabled: !!bookingPublicId,
    staleTime: 15_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={Colors.orange} />
      </View>
    );
  }
  if (!data) return null;

  const life = LIFECYCLE[data.lifecycleState] ?? { label: data.lifecycleState, color: Colors.ink3 };
  const due = Number(data.amountDue ?? 0);
  const txns = data.transactions ?? [];

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.headerRow} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <Ionicons name="receipt-outline" size={16} color={Colors.ink2} />
          <Text style={styles.headerTitle}>Payment summary</Text>
          <View style={[styles.lifeBadge, { backgroundColor: life.color + '18' }]}>
            <Text style={[styles.lifeBadgeText, { color: life.color }]}>{life.label}</Text>
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.ink3} />
      </TouchableOpacity>

      <View style={styles.dueRow}>
        <Text style={styles.dueLabel}>{due > 0 ? 'Amount due' : 'Settled'}</Text>
        <Text style={[styles.dueValue, due > 0 && { color: '#dc3545' }]}>{due > 0 ? inr(due) : inr(0)}</Text>
      </View>

      {open && (
        <>
          <View style={styles.divider} />
          <Row label="Booking total" value={inr(data.totalFinal)} />
          <Row label="Collected (confirmed)" value={inr(data.totalCollectedConfirmed)} />
          {Number(data.totalCollectedPending) > 0 && (
            <Row label="Collected (pending)" value={inr(data.totalCollectedPending)} amber />
          )}
          {Number(data.totalRefunded) > 0 && <Row label="Refunded" value={inr(data.totalRefunded)} />}

          <View style={styles.divider} />
          <Text style={styles.ledgerTitle}>Transactions</Text>
          {txns.length === 0 ? (
            <Text style={styles.empty}>No transactions yet.</Text>
          ) : (
            txns.map((t) => {
              const sc = STATUS_COLOR[t.status] ?? Colors.ink3;
              return (
                <View key={t.publicId} style={styles.txnRow}>
                  <View style={styles.txnLeft}>
                    <Text style={styles.txnPurpose}>{prettyPurpose(t.purpose)}</Text>
                    <Text style={styles.txnMeta}>
                      {t.method} · {fmtDate(t.confirmedAt ?? t.collectedAt)}
                    </Text>
                  </View>
                  <View style={styles.txnRight}>
                    <Text style={styles.txnAmount}>{inr(t.totalAmount)}</Text>
                    <Text style={[styles.txnStatus, { color: sc }]}>{t.status}</Text>
                  </View>
                </View>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

function Row({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, amber && { color: '#d97706' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginBottom: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  lifeBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  lifeBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 10 },

  dueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  dueLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  dueValue: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.5 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  rowValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },

  ledgerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  empty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  txnRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  txnLeft: { flex: 1 },
  txnPurpose: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  txnMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },
  txnRight: { alignItems: 'flex-end' },
  txnAmount: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  txnStatus: { fontFamily: Fonts.bodySemiBold, fontSize: 10, marginTop: 2 },
});
