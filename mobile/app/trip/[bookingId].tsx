import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Fonts } from '../../constants/colors';
import { extensionApi, userApi } from '../../lib/api';
import { startsInLabel } from '../../lib/dates';
import { gstNumber, inrExact, rentGstNoteLines, rentInclGstView, round2 } from '../../lib/gst';
import StudioImage from '../../components/cars/StudioImage';
import StatusBadge, { type BadgeTone } from '../../components/ui/StatusBadge';
import ItineraryTimeline from '../../components/ui/ItineraryTimeline';
import VerifyLicenseCard, { type DLStatus } from '../../components/ui/VerifyLicenseCard';
import type { BookingTrip, BookingVehicle, ExtensionEligibility } from '../../types/api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const STATUS_LABEL: Record<string, string> = {
  HOLD:      'Pending Payment',
  CONFIRMED: 'Confirmed',
  PICKED_UP: 'Active',
  RETURNED:  'Returned',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  HOLD:      'warn',
  CONFIRMED: 'good',
  PICKED_UP: 'info',
  RETURNED:  'neutral',
  CANCELLED: 'bad',
};

function dlStatusFrom(rows: any[]): DLStatus {
  const dls = (rows ?? []).filter((d) => d?.type === 'DL');
  if (dls.length === 0) return 'none';
  if (dls.some((d) => d.status === 'APPROVED')) return 'approved';
  if (dls.some((d) => d.status === 'PENDING')) return 'pending';
  if (dls.some((d) => d.status === 'REJECTED')) return 'rejected';
  return 'none';
}

// The list endpoint is the only customer booking read; page through it for
// this booking (newest first, so an active trip is found on the first page).
async function findTrip(bookingId: string): Promise<BookingTrip | null> {
  for (let page = 1; page <= 5; page++) {
    const res = await userApi.bookings(page, 50);
    const body = res.data as { data?: BookingTrip[]; meta?: { page: number; totalPages: number } };
    const hit = (body.data ?? []).find((b) => b.bookingId === bookingId);
    if (hit) return hit;
    if (!body.meta || body.meta.page >= body.meta.totalPages) break;
  }
  return null;
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function InfoRow({ icon, label, value }: { icon: IoniconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function TripDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    bookingId: string;
    id: string;
    status: string;
    make: string;
    model: string;
    thumbnail: string;
    startAt: string;
    endAt: string;
    days: string;
    total: string;
    paymentStatus: string;
    vehiclesJson: string;
    // Partial payment + coupon (#6/#20) from the trips list — absent on older servers.
    paid?: string;
    balanceDue?: string;
    balanceDueAt?: string;
    // Part of balanceDue on credit at the counter (#11) — absent on older servers.
    balanceOnCredit?: string;
    couponCode?: string;
    totalDiscount?: string;
    // Discounts off the GST-inclusive rent (item 17) — absent on older servers.
    discountInclGst?: string;
  }>();

  const { bookingId, id, make, model, thumbnail, startAt, vehiclesJson } = params;

  // The params are a snapshot from the trips list. Re-read the booking whenever
  // the screen regains focus, so a new return time (extension) or status shows.
  const { data: live, refetch: refetchTrip } = useQuery({
    queryKey: ['trip', bookingId],
    queryFn: () => findTrip(bookingId),
    enabled: false,
  });
  const status: string = live?.status ?? params.status;
  const endAt: string = live?.endAt ?? params.endAt;
  const total: string = live ? String(live.total) : params.total;
  const paymentStatus: string = live?.paymentStatus ?? params.paymentStatus;

  // What was actually received and what is still owed (#6). `paid` is 0 for a
  // HOLD / expired / failed booking, so "Paid" only ever shows real money.
  const paidNow = gstNumber(live ? live.paid : params.paid);
  const balanceDue = gstNumber(live ? live.balanceDue : params.balanceDue) ?? 0;
  const balanceDueAt = (live ? live.balanceDueAt : params.balanceDueAt) ?? null;
  // Left on credit at the counter (#11): owed to the branch, which holds collateral
  // for it — not due at a pickup / drop step. The rest of balanceDue is.
  const onCredit = Math.min(balanceDue, gstNumber(live ? live.balanceOnCredit : params.balanceOnCredit) ?? 0);
  const dueAtStep = Math.max(0, balanceDue - onCredit);
  const couponCode = (live ? live.couponCode : params.couponCode) || null;
  // Off the GST-inclusive rent (item 17) when the server says; else the stored discount.
  const totalDiscount =
    gstNumber(live ? live.discountInclGst ?? live.totalDiscount : params.discountInclGst ?? params.totalDiscount) ?? 0;
  const partlyPaid = paymentStatus === 'SUCCESS' && balanceDue > 0;

  // The original booking's rent (#23, item 17): GST-inclusive rent → discounts
  // → rent after discounts, with the GST inside it (rent without GST + GST).
  // totalBase / totalDiscount / totalTax leave out the refundable deposit and
  // extensions (each extension carries its own GST); older servers don't send
  // them, so nothing is shown then.
  const gstSource = live as (BookingTrip & { totalBase?: number; totalDiscount?: number; totalTax?: number }) | null | undefined;
  const bookingTax = gstNumber(gstSource?.totalTax);
  const bookingBase = gstNumber(gstSource?.totalBase);
  const bookingDiscount = gstNumber(gstSource?.totalDiscount) ?? 0;
  const bookingTaxable = bookingBase != null ? round2(bookingBase - bookingDiscount) : null;
  // CGST / SGST as the server stored them (newer servers)
  const bookingCgst = gstNumber(gstSource?.totalCgst);
  const bookingSgst = gstNumber(gstSource?.totalSgst);
  // Servers before item 17 send no inclusive fields: rentInclGstView reads the
  // same figures from totalBase − totalDiscount + totalTax (what the rent cost).
  const bookingRent =
    bookingBase != null && bookingTax != null && bookingTaxable != null && bookingTaxable > 0
      ? rentInclGstView({
          rentInclGst: gstSource?.rentInclGst,
          discountInclGst: gstSource?.discountInclGst,
          rentAfterDiscountInclGst: gstSource?.rentAfterDiscountInclGst,
          rentWithoutGst: gstSource?.rentWithoutGst,
          gst: bookingTax,
          cgst: bookingCgst,
          sgst: bookingSgst,
          basePrice: bookingBase,
          discountAmount: bookingDiscount,
          taxAmount: bookingTax,
          cgstAmount: bookingCgst,
          sgstAmount: bookingSgst,
        })
      : null;
  const bookingRentGstNotes = bookingRent
    ? rentGstNoteLines(bookingRent, { cgstRate: live?.cgstRate, sgstRate: live?.sgstRate })
    : [];
  const beyondRental = bookingRent ? round2(Number(total) - bookingRent.rentAfterDiscount) : 0;

  const canExtendStatus = status === 'CONFIRMED' || status === 'PICKED_UP';
  // { eligible, reason }: eligible = not ended and no other extension open.
  const { data: eligibility, refetch: refetchEligibility } = useQuery({
    queryKey: ['extension-eligibility', bookingId],
    queryFn: async () => {
      const res = await extensionApi.eligibility(bookingId);
      return (res.data?.data ?? null) as ExtensionEligibility | null;
    },
    enabled: canExtendStatus && !!bookingId,
  });
  // #15 — the trip already runs to the booking-period limit: no Extend, say why.
  // P3 — or less than the 12-hour package is left before that limit.
  const extendCapped =
    canExtendStatus &&
    (eligibility?.atCap === true ||
      (eligibility?.eligible === false && Array.isArray(eligibility.packageOptions) && eligibility.packageOptions.length === 0));
  // An extension left open (e.g. the app was closed mid-quote) blocks new ones;
  // the extend screen can release it, so keep the way in visible.
  const extensionBlocked = !!eligibility?.reason && /pending extension/i.test(eligibility.reason);
  const showExtend = canExtendStatus && (eligibility?.eligible === true || extensionBlocked);

  useFocusEffect(
    useCallback(() => {
      if (!bookingId) return;
      refetchTrip();
      if (canExtendStatus) refetchEligibility();
    }, [bookingId, canExtendStatus, refetchTrip, refetchEligibility]),
  );

  // Full vehicle list (#39) — render every vehicle, not just the first.
  const vehicles = useMemo<BookingVehicle[]>(() => {
    try {
      const parsed = JSON.parse(vehiclesJson ?? '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through to the single-vehicle fallback */
    }
    return make ? [{ publicId: bookingId, make, model, thumbnail: thumbnail || null, finalTotal: Number(params.total) || 0 }] : [];
  }, [vehiclesJson, make, model, thumbnail, params.total, bookingId]);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const upcoming = status === 'HOLD' || status === 'CONFIRMED';
  // Real DL/KYC status drives the "verify your licence" card (only for upcoming trips).
  const { data: dlStatus = 'none' } = useQuery<DLStatus>({
    queryKey: ['user-kyc-dl'],
    queryFn: async () => {
      const res = await userApi.kyc();
      const rows = (res.data?.kyc ?? res.data?.data ?? []) as any[];
      return dlStatusFrom(rows);
    },
    enabled: upcoming,
    staleTime: 60_000,
  });
  const startsLabel = startsInLabel(startAt);

  // A HOLD is unpaid/unconfirmed and pickup is blocked server-side — no pickup QR for it.
  const showQR = status === 'CONFIRMED' || status === 'PICKED_UP';
  const canCancelHold = status === 'HOLD';

  const cancelHold = () => {
    if (cancelBusy) return;
    Alert.alert(
      'Cancel booking',
      'Release this held booking? This frees the vehicle for other customers and cannot be undone.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setCancelBusy(true);
            try {
              await userApi.cancelHold(bookingId);
              router.replace('/(tabs)/trips');
            } catch (err: any) {
              Alert.alert('Could not cancel', err?.response?.data?.message ?? 'Please try again.');
            } finally {
              setCancelBusy(false);
            }
          },
        },
      ],
    );
  };
  const numericId = Number(id);
  // PICKED_UP too: the server re-syncs the invoice (extensions etc.) before
  // building it; the final version is rebuilt at drop.
  const canInvoice =
    (status === 'CONFIRMED' || status === 'PICKED_UP' || status === 'RETURNED') &&
    Number.isFinite(numericId) &&
    numericId > 0;

  const openInvoice = async () => {
    if (!canInvoice || invoiceBusy) return;
    setInvoiceBusy(true);
    try {
      const res = await userApi.invoiceDownload(numericId);
      const d = res.data ?? {};
      if (d.cached && d.pdfUrl) {
        await WebBrowser.openBrowserAsync(d.pdfUrl);
        return;
      }
      if (d.generating && d.invoiceId) {
        for (let i = 0; i < 40; i++) {
          await sleep(3000);
          const s = (await userApi.invoiceStatus(d.invoiceId)).data ?? {};
          if (s.state === 'completed' && s.pdfUrl) {
            await WebBrowser.openBrowserAsync(s.pdfUrl);
            return;
          }
          if (s.state === 'failed') throw new Error('Invoice generation failed');
        }
        throw new Error('Invoice is taking longer than expected');
      }
      throw new Error(d.message ?? 'Invoice is not available yet');
    } catch (err: any) {
      Alert.alert('Invoice', err?.response?.data?.message ?? err?.message ?? 'Could not download invoice. Please try again.');
    } finally {
      setInvoiceBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trip Details</Text>
        <StatusBadge label={STATUS_LABEL[status] ?? status} tone={STATUS_TONE[status] ?? 'neutral'} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Vehicle card(s) — one per vehicle on the booking */}
        {vehicles.map((veh, i) => (
          <View key={veh.publicId ?? i} style={[styles.vehicleCard, i > 0 && styles.vehicleCardStacked]}>
            <StudioImage uri={veh.thumbnail} height={96} radius={0} contain style={styles.vehiclePhoto} />
            <View style={styles.vehicleInfo}>
              {i === 0 && startsLabel ? (
                <StatusBadge label={startsLabel} tone="info" style={{ marginBottom: 6 }} />
              ) : null}
              <Text style={styles.vehicleName}>{veh.make} {veh.model}</Text>
              {i === 0 ? (
                <Text style={styles.bookingRef} numberOfLines={1} ellipsizeMode="middle">
                  Ref: {bookingId}
                </Text>
              ) : null}
              {vehicles.length > 1 && veh.finalTotal != null ? (
                <Text style={styles.vehiclePrice}>₹{Number(veh.finalTotal).toLocaleString('en-IN')}</Text>
              ) : null}
            </View>
          </View>
        ))}

        {/* QR Code — for employee to scan at pickup */}
        {showQR && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pickup QR Code</Text>
            <View style={styles.qrCard}>
              <View style={styles.qrWrap}>
                <QRCode
                  value={bookingId}
                  size={180}
                  color={Colors.ink}
                  backgroundColor={Colors.surface}
                />
              </View>
              <Text style={styles.qrHint}>
                Show this to the staff at pickup
              </Text>
            </View>
          </View>
        )}

        {/* Verify licence — only for upcoming trips, driven by real KYC DL status */}
        {upcoming ? (
          <View style={styles.section}>
            <VerifyLicenseCard status={dlStatus} onVerify={() => router.push('/(tabs)/profile')} />
          </View>
        ) : null}

        {/* Itinerary — reservation # + pickup/return datetimes (no station: bookings carry no branch) */}
        <View style={styles.section}>
          <ItineraryTimeline reservationNumber={bookingId} start={startAt} end={endAt} />
        </View>

        {/* Extend the trip — CONFIRMED / PICKED_UP, while the server says it's possible */}
        {showExtend && (
          <TouchableOpacity
            style={styles.extendBtn}
            onPress={() => router.push({
              pathname: '/trip/extend',
              params: { bookingId, endAt, make: vehicles[0]?.make ?? make ?? '', model: vehicles[0]?.model ?? model ?? '' },
            })}
            activeOpacity={0.85}
          >
            <View style={styles.extendIcon}>
              <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
            </View>
            <View style={styles.extendTextWrap}>
              <Text style={styles.extendTitle}>Extend trip</Text>
              <Text style={styles.extendSub}>
                {extensionBlocked ? 'An extension request is still open' : `Returns ${fmtWhen(endAt)}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
          </TouchableOpacity>
        )}
        {!showExtend && extendCapped && eligibility?.reason ? (
          <View style={styles.extendCapNote}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.ink3} />
            <Text style={styles.extendCapText}>{eligibility.reason}</Text>
          </View>
        ) : null}

        {/* Payment */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <View style={styles.card}>
            <InfoRow
              icon="cash-outline"
              label="Total"
              value={`₹${Number(total).toLocaleString('en-IN')}`}
            />
            {/* Original booking, in order (item 17): rent incl. GST → discounts
                (duration slab + coupon, #20/#24, off the inclusive rent) → rent
                after discount, then the GST inside it (#23). That is what the
                rent cost before the deposit / extensions. */}
            {bookingRent ? (
              <View style={styles.gstBlock}>
                <View style={styles.gstRow}>
                  <Text style={styles.gstLabel}>Rent (incl. GST)</Text>
                  <Text style={styles.gstValue}>{inrExact(bookingRent.rent)}</Text>
                </View>
                {bookingRent.discount > 0 ? (
                  <>
                    <View style={styles.gstRow}>
                      <Text style={styles.gstLabel}>
                        {couponCode ? `Discounts (incl. coupon ${couponCode})` : 'Discounts'}
                      </Text>
                      <Text style={[styles.gstValue, styles.creditValue]}>−{inrExact(bookingRent.discount)}</Text>
                    </View>
                    <View style={styles.gstRow}>
                      <Text style={styles.gstLabel}>Rent after discount</Text>
                      <Text style={styles.gstValue}>{inrExact(bookingRent.rentAfterDiscount)}</Text>
                    </View>
                  </>
                ) : couponCode ? (
                  <View style={styles.gstRow}>
                    <Text style={styles.gstLabel}>Coupon applied</Text>
                    <Text style={styles.gstValue}>{couponCode}</Text>
                  </View>
                ) : null}
                {bookingRentGstNotes.map((t) => (
                  <Text key={t} style={styles.gstNote}>{t}</Text>
                ))}
                {beyondRental > 0 ? (
                  <Text style={styles.gstNote}>
                    The total also includes the refundable deposit and any extension or other charges.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {/* Older servers (no GST figures): discounts on their own */}
            {!bookingRent && (totalDiscount > 0 || couponCode) ? (
              <View style={styles.gstBlock}>
                {totalDiscount > 0 ? (
                  <View style={styles.gstRow}>
                    <Text style={styles.gstLabel}>
                      {couponCode ? `Discounts (incl. coupon ${couponCode})` : 'Discounts'}
                    </Text>
                    <Text style={[styles.gstValue, styles.creditValue]}>−{inrExact(totalDiscount)}</Text>
                  </View>
                ) : (
                  <View style={styles.gstRow}>
                    <Text style={styles.gstLabel}>Coupon applied</Text>
                    <Text style={styles.gstValue}>{couponCode}</Text>
                  </View>
                )}
              </View>
            ) : null}
            {/* Paid so far / still owed — "Paid" only once the payment succeeded */}
            {paidNow != null && paidNow > 0 ? (
              <View style={[styles.infoRow, styles.payRowGap]}>
                <View style={styles.infoLeft}>
                  <Ionicons name="wallet-outline" size={15} color={Colors.ink3} />
                  <Text style={styles.infoLabel}>{partlyPaid ? (dueAtStep > 0 ? 'Paid (advance)' : 'Paid so far') : 'Paid'}</Text>
                </View>
                <Text style={styles.infoValue}>{inrExact(paidNow)}</Text>
              </View>
            ) : null}
            {dueAtStep > 0 ? (
              <View style={[styles.infoRow, styles.payRowGap]}>
                <View style={styles.infoLeft}>
                  <Ionicons name="time-outline" size={15} color={Colors.ink3} />
                  <Text style={styles.infoLabel}>{balanceDueAt === 'DROP' ? 'Due at drop' : 'Due at pickup'}</Text>
                </View>
                <Text style={[styles.infoValue, styles.dueValue]}>{inrExact(dueAtStep)}</Text>
              </View>
            ) : null}
            {onCredit > 0 ? (
              <View style={[styles.infoRow, styles.payRowGap]}>
                <View style={styles.infoLeft}>
                  <Ionicons name="hourglass-outline" size={15} color={Colors.ink3} />
                  <Text style={styles.infoLabel}>On credit — owed to the branch</Text>
                </View>
                <Text style={[styles.infoValue, styles.dueValue]}>{inrExact(onCredit)}</Text>
              </View>
            ) : null}
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <View style={styles.infoLeft}>
                <Ionicons name="checkmark-circle-outline" size={15} color={Colors.ink3} />
                <Text style={styles.infoLabel}>Status</Text>
              </View>
              <View style={[styles.payBadge, { backgroundColor: paymentStatus === 'SUCCESS' ? '#2d9d6120' : '#f59e0b20' }]}>
                <Text style={[styles.payBadgeText, { color: paymentStatus === 'SUCCESS' ? '#2d9d61' : '#d97706' }]}>
                  {paymentStatus === 'SUCCESS'
                    ? onCredit > 0 && !(paidNow != null && paidNow > 0)
                      ? 'On credit'
                      : partlyPaid
                      ? onCredit > 0 ? 'Part paid' : 'Advance paid'
                      : 'Paid'
                    : paymentStatus === 'FAILED'
                    ? 'Failed'
                    : paymentStatus === 'REFUNDED'
                    ? 'Refunded'
                    : paymentStatus
                    ? 'Pending'
                    : '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Invoice — available once confirmed (also while the car is out) */}
        {canInvoice && (
          <TouchableOpacity style={styles.invoiceBtn} onPress={openInvoice} disabled={invoiceBusy} activeOpacity={0.85}>
            {invoiceBusy ? (
              <ActivityIndicator size="small" color={Colors.ink} />
            ) : (
              <Ionicons name="download-outline" size={18} color={Colors.ink} />
            )}
            <Text style={styles.invoiceBtnText}>{invoiceBusy ? 'Preparing invoice…' : 'Download invoice (PDF)'}</Text>
          </TouchableOpacity>
        )}

        {/* Cancel a held (unpaid) booking — releases the vehicle (#43) */}
        {canCancelHold && (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelHold} disabled={cancelBusy} activeOpacity={0.85}>
            {cancelBusy ? (
              <ActivityIndicator size="small" color="#e53e3e" />
            ) : (
              <Ionicons name="close-circle-outline" size={18} color="#e53e3e" />
            )}
            <Text style={styles.cancelBtnText}>{cancelBusy ? 'Cancelling…' : 'Cancel this booking'}</Text>
          </TouchableOpacity>
        )}

        {/* What to bring — only for upcoming */}
        {(status === 'CONFIRMED' || status === 'HOLD') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What to bring</Text>
            <View style={styles.card}>
              {[
                { icon: 'card-outline' as IoniconName,            text: 'Valid driving license (original)' },
                ...(showQR ? [{ icon: 'phone-portrait-outline' as IoniconName, text: 'This QR code for verification' }] : []),
                { icon: 'shield-checkmark-outline' as IoniconName, text: 'Your Aadhaar or govt. ID' },
              ].map((item, i, arr) => (
                <View key={item.text}>
                  <View style={styles.bringRow}>
                    <View style={styles.bringIcon}>
                      <Ionicons name={item.icon} size={16} color={Colors.orange} />
                    </View>
                    <Text style={styles.bringText}>{item.text}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.2 },

  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 4 },

  vehicleCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
    marginBottom: 20,
  },
  vehicleCardStacked: { marginTop: -10 },
  vehiclePrice: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange, marginTop: 2 },
  vehiclePhoto: { width: 110, height: 90 },
  vehiclePhotoPlaceholder: {
    backgroundColor: '#f0f0ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleInfo: { flex: 1, padding: 14, justifyContent: 'center', gap: 6 },
  vehicleName: {
    fontFamily: Fonts.displayBold,
    fontSize: 17,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  bookingRef: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
    letterSpacing: 0.2,
  },

  section: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },

  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 16,
  },
  qrWrap: {
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  qrHint: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    textAlign: 'center',
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  gstBlock: { marginTop: 10, paddingLeft: 23, gap: 6 },
  gstRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gstLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  gstValue: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  gstNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink4, lineHeight: 15 },
  creditValue: { color: '#2d9d61' },
  payRowGap: { marginTop: 12 },
  dueValue: { color: '#d97706' },

  payBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  payBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },

  invoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingVertical: 15,
    marginBottom: 20,
  },
  invoiceBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  extendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  extendIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ff6a1f10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extendTextWrap: { flex: 1, gap: 2 },
  extendTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  extendSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  extendCapNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  extendCapText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },

  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff5f5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingVertical: 15,
    marginBottom: 20,
  },
  cancelBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#e53e3e' },

  bringRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bringIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#ff6a1f10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bringText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink, flex: 1 },
});
