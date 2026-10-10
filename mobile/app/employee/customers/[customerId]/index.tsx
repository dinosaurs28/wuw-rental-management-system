import { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../../constants/colors';
import { employeeCustomersApi } from '../../../../lib/api';
import { apiErrorMessage } from '../../../../lib/counterErrors';
import { fmtDate, fmtIstDateTime } from '../../../../lib/dates';
import { callPhone } from '../../../../components/employee/recovery/recoveryUtils';
import Toast from '../../../../components/ui/Toast';
import { BlacklistSheet } from '../../../../components/employee/customers/BlacklistSheet';
import { RentCard } from '../../../../components/employee/customers/RentCard';
import {
  RENT_BUCKETS,
  RENT_EMPTY_TEXT,
  humanize,
  inr,
  isPositive,
  shortRef,
} from '../../../../components/employee/customers/format';
import { refreshAfterBlacklist, useCustomerDetail } from '../../../../components/employee/customers/useCustomers';
import type { BlacklistResult, RentBucket, RentRow } from '../../../../types/customers';

function InfoRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {onPress ? (
        <TouchableOpacity style={styles.infoLink} onPress={onPress} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="call-outline" size={13} color={Colors.orange} />
          <Text style={[styles.infoValue, styles.infoLinkText]}>{value}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.infoValue}>{value}</Text>
      )}
    </View>
  );
}

/** One rents bucket: the first page from the customer detail, then "Load more". */
function RentList({
  customerId,
  bucket,
  initial,
  total,
  hasMore,
  onOpen,
}: {
  customerId: string;
  bucket: RentBucket;
  initial: RentRow[];
  total: number;
  hasMore: boolean;
  onOpen: (bookingId: string) => void;
}) {
  const [extra, setExtra] = useState<RentRow[]>([]);
  const [page, setPage] = useState(1);
  const [moreLeft, setMoreLeft] = useState(hasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seen = new Set(initial.map((r) => r.publicId));
  const rows = [...initial, ...extra.filter((r) => !seen.has(r.publicId))];

  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = (await employeeCustomersApi.rents(customerId, { bucket, page: page + 1 })).data;
      setExtra((e) => [...e, ...next.data]);
      setPage(next.page);
      setMoreLeft(next.page < next.totalPages);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load more rents.'));
    } finally {
      setLoading(false);
    }
  };

  if (rows.length === 0) {
    return (
      <View style={[styles.card, styles.emptyCard]}>
        <Text style={styles.emptyCardText}>{RENT_EMPTY_TEXT[bucket]}</Text>
      </View>
    );
  }

  return (
    <View style={styles.rentList}>
      {rows.map((r) => (
        <RentCard key={r.publicId} r={r} onPress={() => onOpen(r.publicId)} />
      ))}
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      {moreLeft ? (
        <TouchableOpacity style={styles.moreBtn} onPress={loadMore} disabled={loading} activeOpacity={0.85}>
          {loading ? (
            <ActivityIndicator color={Colors.ink2} />
          ) : (
            <Text style={styles.moreText}>
              Load more ({rows.length} of {total})
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function FleetCustomerDetailScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, dataUpdatedAt } = useCustomerDetail(customerId);
  const [bucket, setBucket] = useState<RentBucket>('upcoming');
  const [sheet, setSheet] = useState<'blacklist' | 'remove' | null>(null);
  const [toast, setToast] = useState<{ title: string; message?: string; type: 'success' | 'error' | 'info' } | null>(
    null,
  );
  const [pulling, setPulling] = useState(false);

  // A failed refresh keeps the loaded customer on screen and says so.
  const onPull = async () => {
    setPulling(true);
    try {
      const res = await refetch();
      if (res.isError) {
        setToast({
          title: 'Could not refresh',
          message: apiErrorMessage(res.error, 'Check your connection and try again.'),
          type: 'error',
        });
      }
    } finally {
      setPulling(false);
    }
  };

  const onBlacklistDone = (message: string, result?: BlacklistResult) => {
    setSheet(null);
    const open = result?.openRents;
    setToast({
      title: message,
      message:
        open && (open.upcoming > 0 || open.active > 0)
          ? `Existing rents are not cancelled: ${open.upcoming} upcoming, ${open.active} active.`
          : undefined,
      type: 'success',
    });
    refreshAfterBlacklist(queryClient);
  };

  const onStale = (message: string) => {
    setSheet(null);
    setToast({ title: message, type: 'info' });
    refreshAfterBlacklist(queryClient);
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>
      <Text style={styles.title}>Customer</Text>
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
  if (!data) {
    const notFound = (error as any)?.response?.status === 404;
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.errorState}>
          <Ionicons name={notFound ? 'search-outline' : 'cloud-offline-outline'} size={40} color={Colors.ink4} />
          <Text style={styles.errorTitle}>{notFound ? 'Customer not found' : 'Could not load this customer'}</Text>
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

  const c = data.customer;
  const bl = data.blacklist;
  const addressLine = [c.address.line1, c.address.city, c.address.state, c.address.zipCode, c.address.country]
    .filter(Boolean)
    .join(', ');
  const hasCredit = isPositive(data.credit.pendingTotal);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Colors.orange} />}
      >
        {bl.isBlacklisted ? (
          <View style={styles.blacklistBox}>
            <Ionicons name="ban-outline" size={20} color={Colors.availNone} />
            <View style={styles.blacklistBody}>
              <Text style={styles.blacklistTitle}>Blacklisted — can't make new bookings</Text>
              {bl.reason ? <Text style={styles.blacklistText}>Reason: {bl.reason}</Text> : null}
              {bl.blacklistedAt || bl.blacklistedBy ? (
                <Text style={styles.blacklistMeta}>
                  {bl.blacklistedAt ? `Since ${fmtIstDateTime(bl.blacklistedAt)}` : ''}
                  {bl.blacklistedBy
                    ? ` · by ${bl.blacklistedBy.name}${bl.blacklistedBy.branch ? ` (${bl.blacklistedBy.branch.name})` : ''}`
                    : ''}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Profile */}
        <View style={styles.card}>
          <View style={styles.profileTop}>
            <View style={[styles.avatar, bl.isBlacklisted && styles.avatarBlocked]}>
              <Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.name} numberOfLines={2}>{c.name}</Text>
              <Text style={styles.registered}>
                Registered {fmtDate(c.registeredAt)}
                {c.isProfileCompleted ? '' : ' · Profile incomplete'}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <InfoRow label="Phone" value={c.phone} onPress={c.phone ? () => callPhone(c.phone) : undefined} />
          <View style={styles.divider} />
          <InfoRow
            label="Alternate phone"
            value={c.alternatePhone || '—'}
            onPress={c.alternatePhone ? () => callPhone(c.alternatePhone as string) : undefined}
          />
          <View style={styles.divider} />
          <InfoRow label="Email" value={c.email || '—'} />
          <View style={styles.divider} />
          <InfoRow label="Address" value={addressLine || '—'} />
          <View style={styles.divider} />
          <InfoRow label="Driving licence" value={c.drivingLicenceNumberMasked || 'Not added'} />
          <View style={styles.divider} />
          <InfoRow label="Aadhaar" value={c.aadhaarNumberMasked || 'Not added'} />
        </View>

        {bl.isBlacklisted ? (
          <TouchableOpacity style={[styles.actionBtn, styles.actionRemove]} onPress={() => setSheet('remove')} activeOpacity={0.85}>
            <Ionicons name="shield-checkmark-outline" size={18} color={Colors.orange} />
            <Text style={[styles.actionText, { color: Colors.orange }]}>Remove blacklist</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBlacklist]} onPress={() => setSheet('blacklist')} activeOpacity={0.85}>
            <Ionicons name="ban-outline" size={18} color={Colors.availNone} />
            <Text style={[styles.actionText, { color: Colors.availNone }]}>Blacklist</Text>
          </TouchableOpacity>
        )}

        {/* Pending credit */}
        <View style={[styles.card, styles.creditCard, hasCredit && styles.creditCardDue]}>
          <View style={styles.creditTop}>
            <View>
              <Text style={styles.creditLabel}>Pending credit (all branches)</Text>
              <Text style={styles.creditValue}>{inr(data.credit.pendingTotal)}</Text>
            </View>
            {isPositive(data.credit.pendingAtBranch) ? (
              <View style={styles.creditHere}>
                <Text style={styles.creditLabel}>At your branch</Text>
                <Text style={styles.creditHereValue}>{inr(data.credit.pendingAtBranch)}</Text>
              </View>
            ) : null}
          </View>
          {data.credit.entries.map((e) => (
            <View key={e.creditPublicId} style={styles.creditEntry}>
              <View style={styles.creditEntryTop}>
                <Text style={styles.creditEntryTitle} numberOfLines={1}>
                  {e.branch.name}
                  {e.isOwnBranch ? ' (yours)' : ''} · {shortRef(e.bookingPublicId)}
                </Text>
                <Text style={styles.creditEntryAmount}>{inr(e.pendingAmount)}</Text>
              </View>
              <Text style={styles.creditEntryMeta}>
                {humanize(e.status)} · total {inr(e.totalAmount)} · cleared {inr(e.clearedAmount)}
              </Text>
              {e.pendingSections
                .filter((s) => typeof s.collateral === 'string' && s.collateral)
                .map((s) => (
                  <Text key={s.sectionKey} style={styles.creditEntryMeta}>
                    Collateral held: {s.collateral}
                  </Text>
                ))}
            </View>
          ))}
        </View>

        {/* Rents */}
        <Text style={styles.sectionLabel}>Rents</Text>
        <View style={styles.segment}>
          {RENT_BUCKETS.map((b) => {
            const active = bucket === b.key;
            return (
              <TouchableOpacity
                key={b.key}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setBucket(b.key)}
                activeOpacity={0.85}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {b.label} ({data.counts[b.key]})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <RentList
          // A refresh starts the bucket over from the fresh first page.
          key={`${bucket}:${dataUpdatedAt}`}
          customerId={customerId as string}
          bucket={bucket}
          initial={data.rents[bucket]}
          total={data.counts[bucket]}
          hasMore={data.hasMore[bucket]}
          onOpen={(bookingId) =>
            router.push(
              `/employee/customers/${encodeURIComponent(customerId as string)}/${encodeURIComponent(bookingId)}` as Href,
            )
          }
        />
      </ScrollView>

      <BlacklistSheet
        visible={sheet !== null}
        mode={sheet ?? 'blacklist'}
        customerId={customerId as string}
        customerName={c.name}
        onClose={() => setSheet(null)}
        onDone={onBlacklistDone}
        onStale={onStale}
      />
      <Toast
        visible={!!toast}
        title={toast?.title ?? ''}
        message={toast?.message}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />
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
  loader: { marginTop: 80 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingBottom: 80 },
  errorTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4, textAlign: 'center' },
  errorSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 4 },

  content: { paddingHorizontal: 20, gap: 12 },

  blacklistBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.availNoneSoft,
    borderWidth: 1,
    borderColor: '#e53e3e30',
    borderRadius: 16,
    padding: 14,
  },
  blacklistBody: { flex: 1, gap: 3 },
  blacklistTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.availNone },
  blacklistText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
  blacklistMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBlocked: { backgroundColor: Colors.availNone },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.white },
  profileInfo: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.displayBold, fontSize: 19, color: Colors.ink, letterSpacing: -0.4 },
  registered: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 12, gap: 16 },
  infoLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, flexShrink: 0 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flexShrink: 1, textAlign: 'right' },
  infoLink: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  infoLinkText: { color: Colors.orange },
  divider: { height: 1, backgroundColor: Colors.hairline },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
  },
  actionBlacklist: { borderColor: '#e53e3e40', backgroundColor: Colors.surface },
  actionRemove: { borderColor: '#ff6a1f40', backgroundColor: '#fff7f2' },
  actionText: { fontFamily: Fonts.bodySemiBold, fontSize: 15 },

  creditCard: { paddingVertical: 14, gap: 10 },
  creditCardDue: { borderColor: '#ff6a1f40', backgroundColor: '#fff7f2' },
  creditTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  creditLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  creditValue: { fontFamily: Fonts.bodyBold, fontSize: 19, color: Colors.ink, marginTop: 2 },
  creditHere: { alignItems: 'flex-end' },
  creditHereValue: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink, marginTop: 2 },
  creditEntry: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 10,
    gap: 2,
  },
  creditEntryTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  creditEntryTitle: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  creditEntryAmount: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  creditEntryMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 6,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 4,
    gap: 4,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  segmentItemActive: { backgroundColor: Colors.ink },
  segmentText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  segmentTextActive: { color: Colors.white },

  rentList: { gap: 10 },
  emptyCard: { paddingVertical: 24, alignItems: 'center' },
  emptyCardText: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.ink3, textAlign: 'center' },
  inlineError: { fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, textAlign: 'center' },
  moreBtn: {
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  moreText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
});
