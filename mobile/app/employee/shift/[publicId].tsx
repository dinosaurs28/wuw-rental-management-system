import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/counterErrors';
import StatusBadge from '../../../components/ui/StatusBadge';
import ImageViewer from '../../../components/ui/ImageViewer';
import {
  PURPOSE_LABEL,
  TXN_STATUS_BADGE,
  inr2,
  inrOrDash,
  istDateTime,
  money,
  paise,
  shiftStatusBadge,
  signedInr,
} from '../../../lib/cashShift';
import type { ShiftDetail, ShiftTransaction } from '../../../types/shift';

// Short = red, over = amber, exact = green.
function varianceColor(v: number): string {
  const p = paise(v);
  if (p === 0) return Colors.availGood;
  return p < 0 ? Colors.availNone : Colors.availLow;
}

function Line({
  label,
  value,
  sub,
  strong,
  color,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  strong?: boolean;
  color?: string;
}) {
  return (
    <View style={[styles.line, strong && styles.lineStrong]}>
      <View style={styles.lineMain}>
        <Text style={strong ? styles.lineLabelStrong : styles.lineLabel}>{label}</Text>
        <Text style={[strong ? styles.lineValueStrong : styles.lineValue, color ? { color } : null]}>{value}</Text>
      </View>
      {sub ? <Text style={styles.lineSub}>{sub}</Text> : null}
    </View>
  );
}

// "Cash", "UPI", or "Cash ₹500.00 + UPI ₹300.00" for a split.
function methodLabel(t: ShiftTransaction): string {
  const online = t.onlineGateway === 'UPI' ? 'UPI' : 'Online';
  if (t.method === 'CASH') return 'Cash';
  if (t.method === 'ONLINE') return online;
  return `Cash ${inrOrDash(t.cashAmount)} + ${online} ${inrOrDash(t.onlineAmount)}`;
}

function TransactionRow({ t, onViewProof }: { t: ShiftTransaction; onViewProof?: (t: ShiftTransaction) => void }) {
  const badge = TXN_STATUS_BADGE[t.status] ?? { label: t.status, tone: 'neutral' as const };
  // Photo of the customer's UPI payment screen (#3) — a 15-minute link.
  const proofUrl = t.proofPhoto?.url ?? t.proofPhotoUrl ?? null;
  const out = t.direction === 'OUT';
  const amount = money(t.totalAmount) ?? 0;
  const at = t.collectedAt ?? t.createdAt;
  return (
    <View style={styles.txn}>
      <View style={styles.txnTop}>
        <View style={styles.txnTitleWrap}>
          <Text style={styles.txnTitle}>{PURPOSE_LABEL[t.purpose] ?? t.purpose}</Text>
          <Text style={styles.txnMeta} numberOfLines={1}>
            {t.customerName ? `${t.customerName} · ` : ''}#{t.bookingPublicId.slice(-8).toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.txnAmount, out && styles.txnAmountOut]}>
          {out ? '−' : ''}
          {inr2(amount)}
        </Text>
      </View>
      <View style={styles.txnBottom}>
        <Text style={styles.txnMeta} numberOfLines={2}>
          {methodLabel(t)}
          {out ? ' · paid from the drawer' : ''}
          {at ? ` · ${istDateTime(at)}` : ''}
        </Text>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>
      {t.onlineTransactionRef ? <Text style={styles.txnMeta}>UTR {t.onlineTransactionRef}</Text> : null}
      {proofUrl ? (
        <TouchableOpacity
          style={styles.proofRow}
          onPress={() => onViewProof?.(t)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="View the UPI payment photo"
        >
          <Image source={{ uri: proofUrl }} style={styles.proofThumb} resizeMethod="resize" />
          <Text style={styles.proofText}>UPI payment photo</Text>
          <Ionicons name="expand-outline" size={14} color={Colors.ink3} />
        </TouchableOpacity>
      ) : null}
      {t.status === 'CONFIRMED' && t.confirmedByName ? (
        <Text style={styles.txnMeta}>Confirmed by {t.confirmedByName}</Text>
      ) : null}
      {t.status === 'REJECTED' ? (
        <Text style={[styles.txnMeta, styles.txnRejected]}>
          Rejected{t.rejectedByName ? ` by ${t.rejectedByName}` : ''}
          {t.rejectionReason ? ` — ${t.rejectionReason}` : ''}
        </Text>
      ) : null}
      {t.linkedAfterClose ? (
        <View style={styles.afterClose}>
          <Ionicons name="alert-circle-outline" size={13} color={Colors.availLow} />
          <Text style={styles.afterCloseText}>Recorded after the shift closed — not in its figures</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ShiftDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { publicId } = useLocalSearchParams<{ publicId: string }>();

  const { data: shift, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery<ShiftDetail>({
    // Under ['employee', 'shifts'] so a close refreshes it.
    queryKey: ['employee', 'shifts', 'detail', publicId],
    queryFn: async () => {
      const res = await employeeApi.getMyShift(publicId!);
      return res.data?.data as ShiftDetail;
    },
    enabled: !!publicId,
    staleTime: 15_000,
    retry: false,
  });

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  };

  // UPI payment photos (#3) are 15-minute links: reload the shift for fresh
  // ones when the loaded copy is about to lapse, then zoom.
  const [proofView, setProofView] = useState<string | null>(null);
  const openProof = async (t: ShiftTransaction) => {
    let url = t.proofPhoto?.url ?? t.proofPhotoUrl ?? null;
    if (Date.now() - dataUpdatedAt > 13 * 60_000) {
      const fresh = await refetch();
      const ft = fresh.data?.transactions.find((x) => x.publicId === t.publicId);
      url = ft?.proofPhoto?.url ?? ft?.proofPhotoUrl ?? url;
    }
    if (url) setProofView(url);
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Cash Shift</Text>
        {publicId ? <Text style={styles.subtitle}>#{publicId.slice(-8).toUpperCase()}</Text> : null}
      </View>
      {shift ? <StatusBadge {...shiftStatusBadge(shift)} /> : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <ActivityIndicator style={{ marginTop: 48 }} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !shift) {
    const notFound = (error as any)?.response?.status === 404;
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.empty}>
          <Ionicons name={notFound ? 'search-outline' : 'cloud-offline-outline'} size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>{notFound ? 'Shift not found' : 'Could not load this shift'}</Text>
          <Text style={styles.emptySub}>
            {notFound ? 'It may belong to someone else.' : apiErrorMessage(error, 'Check your connection and try again.')}
          </Text>
          {!notFound ? (
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const variance = money(shift.variance);
  const pending = money(shift.pendingCash) ?? 0;
  const confirmed = money(shift.confirmedCash) ?? 0;
  const rejected = money(shift.rejectedCash) ?? 0;
  const upi = money(shift.upiCollected) ?? 0;
  const legacy = shift.legacyVariance;
  // Legacy shifts kept their stored expected (vs manager-confirmed cash), so
  // the parts are listed without the + / − / = that would imply they add up.
  const op = (sign: string) => (legacy ? '' : `${sign} `);

  const reviewParts = [
    confirmed > 0 ? `${inr2(confirmed)} confirmed` : null,
    pending > 0 ? `${inr2(pending)} pending confirmation` : null,
    rejected > 0 ? `${inr2(rejected)} rejected` : null,
  ].filter(Boolean) as string[];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Colors.orange} />}
      >
        {/* When / where */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="play-circle-outline" size={16} color={Colors.ink3} />
            <Text style={styles.infoText}>Opened {istDateTime(shift.openedAt)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="stop-circle-outline" size={16} color={Colors.ink3} />
            <Text style={styles.infoText}>{shift.closedAt ? `Closed ${istDateTime(shift.closedAt)}` : 'Still open'}</Text>
          </View>
          {shift.branchName ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color={Colors.ink3} />
              <Text style={styles.infoText}>{shift.branchName}</Text>
            </View>
          ) : null}
        </View>

        {/* Drawer: opening + collected − refunded = expected, vs counted */}
        <Text style={styles.sectionTitle}>Cash drawer</Text>
        <View style={styles.card}>
          <Line label="Opening cash" value={inrOrDash(shift.openingCash)} />
          <Line
            label={`${op('+')}Cash collected`}
            value={inrOrDash(shift.cashCollected)}
            sub={reviewParts.length ? `Manager review: ${reviewParts.join(' · ')}` : undefined}
          />
          <Line label={`${op('−')}Cash refunded`} value={inrOrDash(shift.cashRefunded)} />
          <Line
            strong
            label={shift.isOpen ? `${op('=')}Expected in drawer now` : `${op('=')}Expected in drawer`}
            value={inrOrDash(shift.expectedClosing)}
          />
          {/* Closing cash and variance don't exist while the shift is open */}
          <Line label="Counted at close" value={inrOrDash(shift.closingCash)} />
          <Line
            label="Variance"
            value={variance == null ? '—' : signedInr(variance)}
            color={variance == null ? undefined : varianceColor(variance)}
            sub={
              variance != null && paise(variance) !== 0 ? (variance < 0 ? 'Short of expected' : 'Over expected') : undefined
            }
          />
          {shift.isOpen ? (
            <Text style={styles.note}>Live figures — they change as you collect or refund cash.</Text>
          ) : (
            <Text style={styles.note}>
              Figures were fixed when the shift closed. Manager review shows each payment’s status now.
            </Text>
          )}
          {legacy ? (
            <Text style={styles.note}>Closed under the old rule (variance vs manager-confirmed cash).</Text>
          ) : null}
        </View>

        {upi > 0 ? (
          <View style={[styles.card, styles.upiCard]}>
            <Line label="UPI collected" value={inr2(upi)} sub="Paid to the account — not part of the drawer" />
          </View>
        ) : null}

        {/* Close note / reconciliation */}
        {shift.discrepancyExplanation || shift.reconciledAt || shift.status === 'DISCREPANCY_FLAGGED' ? (
          <View style={styles.card}>
            {shift.discrepancyExplanation ? (
              <>
                <Text style={styles.noteTitle}>
                  {/* Reconcile replaces the close note with the manager's note */}
                  {shift.reconciledAt ? 'Reconciliation note' : 'Your note at close'}
                </Text>
                <Text style={styles.noteBody}>{shift.discrepancyExplanation}</Text>
              </>
            ) : null}
            {shift.reconciledAt ? (
              <View style={styles.infoRow}>
                <Ionicons name="checkmark-done-outline" size={16} color={Colors.availGood} />
                <Text style={styles.infoText}>
                  Reconciled{shift.reconciledByName ? ` by ${shift.reconciledByName}` : ''} ·{' '}
                  {istDateTime(shift.reconciledAt)}
                </Text>
              </View>
            ) : shift.status === 'DISCREPANCY_FLAGGED' ? (
              <View style={styles.infoRow}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.availLow} />
                <Text style={styles.infoText}>Flagged — waiting for your manager to reconcile.</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Payments */}
        <Text style={styles.sectionTitle}>
          Payments{shift.transactions.length ? ` (${shift.transactions.length})` : ''}
        </Text>
        {shift.transactions.length ? (
          <View style={styles.card}>
            {shift.transactions.map((t, i) => (
              <View key={t.publicId}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <TransactionRow t={t} onViewProof={openProof} />
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard]}>
            <Text style={styles.emptySub}>No payments recorded in this shift.</Text>
          </View>
        )}
      </ScrollView>
      <ImageViewer
        visible={!!proofView}
        images={proofView ? [{ url: proofView, label: 'UPI payment photo' }] : []}
        onClose={() => setProofView(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.ink, letterSpacing: -0.6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },

  content: { paddingHorizontal: 20, gap: 12 },
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  upiCard: { paddingVertical: 12 },
  emptyCard: { alignItems: 'center' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink2 },

  line: { gap: 2 },
  lineStrong: { paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.hairline },
  lineMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  lineLabel: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2 },
  lineValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  lineLabelStrong: { flexShrink: 1, fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  lineValueStrong: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  lineSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },

  noteTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  noteBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink, lineHeight: 20 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  txn: { gap: 6 },
  txnTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  txnTitleWrap: { flex: 1, gap: 2, minWidth: 0 },
  txnTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  txnAmount: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  txnAmountOut: { color: Colors.availNone },
  txnBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  txnMeta: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  txnRejected: { color: Colors.availNone },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  proofThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Colors.bg },
  proofText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  afterClose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.availLowSoft,
  },
  afterCloseText: { fontFamily: Fonts.bodyMedium, fontSize: 11.5, color: Colors.availLow },

  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 48 },
  emptyTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 4 },
});
