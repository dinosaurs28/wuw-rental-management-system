import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../../constants/colors';
import { apiErrorMessage } from '../../../../lib/counterErrors';
import { fmtIstDateTime } from '../../../../lib/dates';
import ImageViewer from '../../../../components/ui/ImageViewer';
import StatusBadge from '../../../../components/ui/StatusBadge';
import Toast from '../../../../components/ui/Toast';
import { humanize, inr, isPositive, methodLabel, shortRef } from '../../../../components/employee/customers/format';
import { useCustomerBooking } from '../../../../components/employee/customers/useCustomers';
import type { CustomerBookingTransaction } from '../../../../types/customers';

/** Presigned proof links live 15 minutes; reload before opening an older one. */
const PROOF_REFRESH_MS = 13 * 60_000;

function Row({
  label,
  value,
  bold,
  muted,
  discount,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  discount?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold, muted && styles.rowMuted, discount && styles.rowDiscount]}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// Booking summary from the Customers tab — the same amount breakdown and
// payments the branch manager's booking drawer shows. Read-only.
export default function CustomerBookingScreen() {
  const { customerId, bookingId } = useLocalSearchParams<{ customerId: string; bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: d, isLoading, error, refetch, dataUpdatedAt } = useCustomerBooking(customerId, bookingId);
  const [pulling, setPulling] = useState(false);
  const [proof, setProof] = useState<{ url: string; label: string } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // A failed refresh keeps the loaded booking on screen and says so.
  const onPull = async () => {
    setPulling(true);
    try {
      const res = await refetch();
      if (res.isError) setRefreshError(apiErrorMessage(res.error, 'Check your connection and try again.'));
    } finally {
      setPulling(false);
    }
  };

  const openProof = async (t: CustomerBookingTransaction) => {
    let url = t.proofPhoto?.url ?? null;
    if (t.proofPhoto?.expiresIn != null && Date.now() - dataUpdatedAt > PROOF_REFRESH_MS) {
      const fresh = await refetch();
      if (fresh.isError) {
        // Still try the loaded link — it may not have lapsed yet.
        setRefreshError(apiErrorMessage(fresh.error, 'The photo link could not be renewed and may have expired.'));
      } else {
        url = fresh.data?.payments.transactions.find((x) => x.publicId === t.publicId)?.proofPhoto?.url ?? url;
      }
    }
    if (url) setProof({ url, label: `${methodLabel(t.method)} payment proof` });
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Booking {bookingId ? shortRef(bookingId) : ''}</Text>
        <Text style={styles.subtitle}>Amount breakdown and payments</Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  // Full-screen error only when nothing is loaded (React Query keeps data after a failed refetch).
  if (!d) {
    const notFound = (error as any)?.response?.status === 404;
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.errorState}>
          <Ionicons name={notFound ? 'search-outline' : 'cloud-offline-outline'} size={40} color={Colors.ink4} />
          <Text style={styles.errorTitle}>{notFound ? 'Booking not found' : 'Could not load this booking'}</Text>
          <Text style={styles.errorSub}>{apiErrorMessage(error, 'Check your connection and try again.')}</Text>
          {!notFound ? (
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const b = d.breakdown;
  const bk = d.booking;
  const gstRate = b.rental.gstRate != null ? Number(b.rental.gstRate) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Colors.orange} />}
      >
        <Section title="Booking">
          <View style={styles.badgeRow}>
            <StatusBadge label={humanize(bk.status)} tone={bk.status === 'CANCELLED' ? 'neutral' : 'info'} />
          </View>
          <Row label="Branch" value={`${bk.branch.name}${bk.isOwnBranch ? ' (yours)' : ''}`} />
          <Row
            label="Source"
            value={bk.source === 'COUNTER' ? `Walk-in${bk.createdBy ? ` (${bk.createdBy.name})` : ''}` : 'Online'}
          />
          <Row label="Type" value={bk.type === 'MONTHLY' ? 'Monthly' : 'Daily'} />
          <Row
            label="Vehicle"
            value={bk.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(', ') || '—'}
          />
          <Row label="Pickup" value={fmtIstDateTime(bk.startAt)} />
          <Row label="Return due" value={fmtIstDateTime(bk.endAt)} />
          {bk.originalEndAt ? <Row label="Original return" value={fmtIstDateTime(bk.originalEndAt)} muted /> : null}
          {bk.returnedAt ? <Row label="Returned" value={fmtIstDateTime(bk.returnedAt)} /> : null}
          {bk.cancelledAt ? (
            <Row
              label="Cancelled"
              value={`${fmtIstDateTime(bk.cancelledAt)}${bk.cancellationReason ? ` — ${bk.cancellationReason}` : ''}`}
            />
          ) : null}
          {bk.couponCode ? <Row label="Coupon" value={bk.couponCode} /> : null}
        </Section>

        <Section title="Original rental">
          <Row label="Rent without GST" value={inr(b.rental.rentWithoutGst)} />
          {isPositive(b.rental.discount) ? <Row label="Discount" value={`− ${inr(b.rental.discount)}`} discount /> : null}
          <Row label="Taxable amount" value={inr(b.rental.taxableAmount)} muted />
          {b.rental.cgst != null && b.rental.sgst != null ? (
            <>
              <Row label={`CGST${gstRate ? ` (${gstRate / 2}%)` : ''}`} value={inr(b.rental.cgst)} />
              <Row label={`SGST${gstRate ? ` (${gstRate / 2}%)` : ''}`} value={inr(b.rental.sgst)} />
            </>
          ) : (
            <Row label={`GST${gstRate ? ` (${gstRate}%)` : ''}`} value={inr(b.rental.gst)} />
          )}
          <Row label="Rent incl. GST" value={inr(b.rental.rentInclGst)} bold />
          <Row label="Refundable deposit" value={inr(b.rental.refundableDeposit)} />
          <Row label="Original total" value={inr(b.rental.total)} bold />
        </Section>

        {b.extensions.items.length > 0 ? (
          <Section title="Extensions">
            {b.extensions.items.map((e) => (
              <View key={e.publicId} style={styles.subItem}>
                <Row label={`Until ${fmtIstDateTime(e.newEndAt)}`} value={inr(e.amount)} muted={!e.includedInTotal} />
                <Text style={styles.note}>
                  {humanize(e.status)}
                  {!e.includedInTotal ? ' · not counted in total' : ''}
                  {e.taxableAmount != null && e.gst != null
                    ? ` · Rent without GST ${inr(e.taxableAmount)} + GST ${inr(e.gst)}`
                    : ''}
                </Text>
              </View>
            ))}
            <Row label="Confirmed extensions" value={inr(b.extensions.total)} bold />
          </Section>
        ) : null}

        <Section title="Rent amount">
          <Row label="Total (incl. deposit and extensions)" value={inr(b.totalFinal)} bold />
        </Section>

        {b.returnCharges.items.length > 0 ? (
          <Section title="Return / drop charges">
            {b.returnCharges.items.map((c, i) => (
              <Row
                key={`${c.type}-${i}`}
                label={c.label}
                value={`${c.isDiscount ? '− ' : ''}${inr(Math.abs(Number(c.total)))}`}
                discount={c.isDiscount}
              />
            ))}
            <Row label="Total charges" value={inr(b.returnCharges.total)} bold />
          </Section>
        ) : null}

        {isPositive(b.safetyDeposit.amount) ? (
          <Section title="Safety deposit">
            <Row label="Collected" value={inr(b.safetyDeposit.charged)} />
            <Row label="Credited back" value={inr(b.safetyDeposit.credited)} />
            <Row label="Held" value={inr(b.safetyDeposit.held)} />
            {b.safetyDeposit.setOff ? <Text style={styles.note}>Set off against charges</Text> : null}
          </Section>
        ) : null}

        <Section title="Total owed">
          <Row label="Total owed" value={inr(b.totalOwed)} bold />
        </Section>

        <Section title="Payments">
          <Row label="Status" value={humanize(d.payments.lifecycleState)} />
          <Row label="Confirmed" value={inr(d.payments.totalCollectedConfirmed)} />
          {isPositive(d.payments.totalCollectedPending) ? (
            <Row label="Awaiting confirmation" value={inr(d.payments.totalCollectedPending)} />
          ) : null}
          {isPositive(d.payments.totalRefunded) ? <Row label="Refunded" value={inr(d.payments.totalRefunded)} /> : null}
          <Row label="Amount due" value={inr(d.payments.amountDue)} bold />

          {d.payments.transactions.map((t) => (
            <View key={t.publicId} style={styles.txn}>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, styles.rowBold]}>
                  {t.isRefund ? 'Refund' : humanize(t.purpose)} · {methodLabel(t.method)}
                </Text>
                <Text style={[styles.rowValue, styles.rowBold]}>
                  {t.isRefund ? '− ' : ''}
                  {inr(t.totalAmount)}
                </Text>
              </View>
              <Text style={styles.note}>
                {humanize(t.status)} · {fmtIstDateTime(t.collectedAt ?? t.createdAt)}
                {t.collectedBy ? ` · by ${t.collectedBy}` : ''}
              </Text>
              {t.confirmedBy ? (
                <Text style={styles.note}>
                  Confirmed by {t.confirmedBy} · {fmtIstDateTime(t.confirmedAt)}
                </Text>
              ) : null}
              {t.rejectionReason ? <Text style={[styles.note, styles.noteBad]}>Rejected: {t.rejectionReason}</Text> : null}
              {t.onlineTransactionRef ? <Text style={styles.note}>Ref {t.onlineTransactionRef}</Text> : null}
              {t.notes ? <Text style={styles.note}>{t.notes}</Text> : null}
              {t.proofPhoto ? (
                <TouchableOpacity style={styles.proofLink} onPress={() => openProof(t)} hitSlop={6} activeOpacity={0.7}>
                  <Ionicons name="image-outline" size={14} color={Colors.orange} />
                  <Text style={styles.proofText}>View payment proof</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </Section>

        {d.credit ? (
          <Section title="Customer credit">
            <Row label="Status" value={humanize(d.credit.status)} />
            <Row label="Total" value={inr(d.credit.totalAmount)} />
            <Row label="Cleared" value={inr(d.credit.clearedAmount)} />
            <Row label="Pending" value={inr(d.credit.pendingAmount)} bold />
            {d.credit.sections
              .filter((s) => typeof s.collateral === 'string' && s.collateral)
              .map((s) => (
                <Text key={s.sectionKey} style={styles.note}>
                  Collateral held ({s.label}): {s.collateral}
                </Text>
              ))}
            {d.credit.clearances.map((c) => (
              <Text key={c.publicId} style={styles.note}>
                Cleared {inr(c.amountCleared)} via {methodLabel(c.paymentMethod)} on {fmtIstDateTime(c.clearedAt)}
                {c.clearedBy ? ` by ${c.clearedBy}` : ''}
              </Text>
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <ImageViewer
        visible={!!proof}
        images={proof ? [{ url: proof.url, label: proof.label }] : []}
        onClose={() => setProof(null)}
      />
      <Toast
        visible={!!refreshError}
        title="Could not refresh"
        message={refreshError ?? undefined}
        type="error"
        onDismiss={() => setRefreshError(null)}
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
    paddingTop: 8,
    paddingBottom: 14,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  loader: { marginTop: 80 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingBottom: 80 },
  errorTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4, textAlign: 'center' },
  errorSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 4 },

  content: { paddingHorizontal: 20, gap: 14 },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  badgeRow: { paddingBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 2 },
  rowLabel: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 13.5, color: Colors.ink2 },
  rowValue: { flexShrink: 1, textAlign: 'right', fontFamily: Fonts.bodyMedium, fontSize: 13.5, color: Colors.ink },
  rowBold: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  rowMuted: { color: Colors.ink3 },
  rowDiscount: { color: Colors.availGood },
  subItem: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.hairline, marginBottom: 2 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  noteBad: { color: Colors.availNone },
  txn: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 10,
    gap: 2,
  },
  proofLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  proofText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.orange },
});
