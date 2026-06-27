import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import type { BookingVehicle } from '../../types/api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const STATUS_COLOR: Record<string, string> = {
  HOLD:      '#8b8b8b',
  CONFIRMED: '#2d9d61',
  PICKED_UP: '#ff6a1f',
  RETURNED:  '#8b8b8b',
  CANCELLED: '#e53e3e',
};

const STATUS_LABEL: Record<string, string> = {
  HOLD:      'Pending Payment',
  CONFIRMED: 'Confirmed',
  PICKED_UP: 'Active',
  RETURNED:  'Returned',
  CANCELLED: 'Cancelled',
};

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
  }>();

  const {
    bookingId,
    id,
    status,
    make,
    model,
    thumbnail,
    startAt,
    endAt,
    days,
    total,
    paymentStatus,
    vehiclesJson,
  } = params;

  // Full vehicle list (#39) — render every vehicle, not just the first.
  const vehicles = useMemo<BookingVehicle[]>(() => {
    try {
      const parsed = JSON.parse(vehiclesJson ?? '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through to the single-vehicle fallback */
    }
    return make ? [{ publicId: bookingId, make, model, thumbnail: thumbnail || null, finalTotal: Number(total) || 0 }] : [];
  }, [vehiclesJson, make, model, thumbnail, total, bookingId]);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const color = STATUS_COLOR[status] ?? Colors.ink3;
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
  const canInvoice = (status === 'CONFIRMED' || status === 'RETURNED') && Number.isFinite(numericId) && numericId > 0;

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
        <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.statusText, { color }]}>{STATUS_LABEL[status] ?? status}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Vehicle card(s) — one per vehicle on the booking */}
        {vehicles.map((veh, i) => (
          <View key={veh.publicId ?? i} style={[styles.vehicleCard, i > 0 && styles.vehicleCardStacked]}>
            {veh.thumbnail ? (
              <Image source={{ uri: veh.thumbnail }} style={styles.vehiclePhoto} resizeMode="cover" />
            ) : (
              <View style={[styles.vehiclePhoto, styles.vehiclePhotoPlaceholder]}>
                <Ionicons name="car-sport-outline" size={40} color={Colors.ink4} />
              </View>
            )}
            <View style={styles.vehicleInfo}>
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

        {/* Booking details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Booking Info</Text>
          <View style={styles.card}>
            <InfoRow icon="calendar-outline"   label="Pickup"   value={fmt(startAt)} />
            <View style={styles.divider} />
            <InfoRow icon="calendar-outline"   label="Return"   value={fmt(endAt)} />
            <View style={styles.divider} />
            <InfoRow icon="time-outline"       label="Duration" value={`${days} day${Number(days) !== 1 ? 's' : ''}`} />
          </View>
        </View>

        {/* Payment */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <View style={styles.card}>
            <InfoRow
              icon="cash-outline"
              label="Total"
              value={`₹${Number(total).toLocaleString('en-IN')}`}
            />
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <View style={styles.infoLeft}>
                <Ionicons name="checkmark-circle-outline" size={15} color={Colors.ink3} />
                <Text style={styles.infoLabel}>Status</Text>
              </View>
              <View style={[styles.payBadge, { backgroundColor: paymentStatus === 'SUCCESS' ? '#2d9d6120' : '#f59e0b20' }]}>
                <Text style={[styles.payBadgeText, { color: paymentStatus === 'SUCCESS' ? '#2d9d61' : '#d97706' }]}>
                  {paymentStatus === 'SUCCESS'
                    ? 'Paid'
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

        {/* Invoice — available once confirmed/returned */}
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
                { icon: 'phone-portrait-outline' as IoniconName,  text: 'This QR code for verification' },
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
