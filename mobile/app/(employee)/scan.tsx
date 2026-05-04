import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

export default function ScanBooking() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [bookingId, setBookingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleScan = async () => {
    const id = bookingId.trim();
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await employeeApi.scanBooking(id);
      const booking = res.data?.data;
      if (!booking) {
        setError('Booking not found.');
        return;
      }
      if (booking.status === 'CONFIRMED') {
        router.push(`/employee/pickup/${id}`);
      } else if (booking.status === 'PICKED_UP') {
        router.push(`/employee/return/${id}`);
      } else {
        setError(`Booking status is ${booking.status}. No action available.`);
      }
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Booking not found. Check the ID and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Scan Booking</Text>
        <Text style={styles.subtitle}>Enter a booking ID to pull up the details.</Text>
      </View>

      {/* QR placeholder */}
      <View style={styles.qrBox}>
        <View style={styles.qrFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          <Ionicons name="qr-code-outline" size={64} color={Colors.ink4} />
          <Text style={styles.qrHint}>Camera scanner coming soon</Text>
        </View>
      </View>

      {/* Manual input */}
      <View style={styles.inputSection}>
        <Text style={styles.orLabel}>Or enter booking ID manually</Text>

        <View style={styles.inputRow}>
          <View style={[styles.inputWrap, error ? styles.inputWrapError : null]}>
            <Ionicons name="document-text-outline" size={18} color={Colors.ink3} />
            <TextInput
              style={styles.input}
              placeholder="Booking ID"
              placeholderTextColor={Colors.ink4}
              value={bookingId}
              onChangeText={(t) => { setBookingId(t.toUpperCase()); setError(''); }}
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleScan}
            />
            {bookingId.length > 0 && (
              <TouchableOpacity onPress={() => { setBookingId(''); setError(''); }} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={Colors.ink4} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.searchBtn, (!bookingId.trim() || loading) && styles.searchBtnDisabled]}
            onPress={handleScan}
            disabled={!bookingId.trim() || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="arrow-forward" size={20} color={Colors.white} />
            )}
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={14} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const CORNER = 24;
const BORDER = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginTop: 4,
  },

  qrBox: { alignItems: 'center', paddingVertical: 20 },
  qrFrame: {
    width: 220,
    height: 220,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: Colors.orange,
  },
  cornerTL: { top: -1, left: -1, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderTopLeftRadius: 14 },
  cornerTR: { top: -1, right: -1, borderTopWidth: BORDER, borderRightWidth: BORDER, borderTopRightRadius: 14 },
  cornerBL: { bottom: -1, left: -1, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderBottomLeftRadius: 14 },
  cornerBR: { bottom: -1, right: -1, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderBottomRightRadius: 14 },
  qrHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  inputSection: { paddingHorizontal: 20, marginTop: 8 },
  orLabel: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    textAlign: 'center',
    marginBottom: 16,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
  },
  inputWrapError: { borderColor: '#e53e3e' },
  input: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: 0.5,
    padding: 0,
  },
  searchBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnDisabled: { opacity: 0.4 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  errorText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: '#e53e3e',
    flex: 1,
  },
});
