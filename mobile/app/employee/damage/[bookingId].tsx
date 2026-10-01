import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../components/employee/PhotoCaptureSection';
import type { DropDamageSeverity, ReturnBooking } from '../../../types/return';

// One list covering two- and four-wheelers (the employee return endpoint does
// not expose the vehicle category, and the backend stores `area` as free text).
const ZONES = [
  'Front', 'Rear', 'Left Side', 'Right Side',
  'Front Bumper', 'Rear Bumper', 'Door', 'Bonnet / Hood', 'Roof', 'Boot / Trunk',
  'Mirror', 'Headlight / Taillight', 'Windscreen', 'Wheels / Tyres', 'Seat', 'Interior', 'Other',
];

const SEVERITIES: DropDamageSeverity[] = ['Minor', 'Moderate', 'Severe'];

// "Add damage" at drop: the report is attached to the booking and, when charged
// to the customer, billed on the return session's next compute (legacy
// branches: charged by the manager on review).
export default function DropDamageScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  // Photos taken but still uploading — they'd be missing from damageImageIds.
  const [photosPending, setPhotosPending] = useState(0);
  const [vehiclePublicId, setVehiclePublicId] = useState('');
  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState<DropDamageSeverity>('Minor');
  const [chargeCustomer, setChargeCustomer] = useState(true);
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const contentRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Android is edge-to-edge (SDK 54): scroll the focused field above the keyboard.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        if (!input || !contentRef.current) return;
        input.measureLayout(
          contentRef.current as any,
          (_x, y) => { scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }); },
          () => {},
        );
      }, 100);
    });
    return () => sub.remove();
  }, []);

  const { data: booking } = useQuery<ReturnBooking>({
    queryKey: ['employee', 'return', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getReturnDetails(bookingId as string);
      return res.data?.data as ReturnBooking;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const vehicles = booking?.items?.map((i) => i.vehicle) ?? [];
  // Multi-vehicle bookings must say which vehicle is damaged (VEHICLE_REQUIRED).
  const multiVehicle = vehicles.length > 1;
  const vehicle = multiVehicle ? vehicles.find((v) => v.publicId === vehiclePublicId) : vehicles[0];
  const customerName = booking?.customer?.user?.name ?? 'the customer';
  // Session branches bill a charged damage on the drop; legacy branches leave
  // it to the manager's damage review.
  const billedAtDrop = booking?.usePaymentSessions ?? true;

  const submit = async () => {
    if (busyRef.current || photosPending > 0) return;
    if (multiVehicle && !vehiclePublicId) return setError('Select the damaged vehicle.');
    if (photos.length === 0) return setError('Take at least one photo of the damage.');
    if (!area) return setError('Select the damaged area.');
    if (description.trim().length < 3) return setError('Describe the damage.');
    const amount = cost.trim() === '' ? NaN : Number(cost);
    if (!Number.isFinite(amount) || amount < 0) return setError('Enter the damage cost in ₹ (0 if none).');
    // Legacy branches may leave the cost at 0 for the manager to set on review.
    if (billedAtDrop && chargeCustomer && amount <= 0) {
      return setError('Enter the damage cost to charge the customer, or choose Company expense.');
    }

    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await employeeApi.addDropDamage(bookingId as string, {
        area,
        severity,
        description: description.trim(),
        amount,
        chargeCustomer,
        damageImageIds: photos.map((p) => p.fileId),
        ...(multiVehicle ? { vehiclePublicId } : {}),
      });
      // The drop screen refetches this list on focus and recomputes the bill.
      qc.invalidateQueries({ queryKey: ['employee', 'return-damages', bookingId] });
      router.back();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not save the damage.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Add Damage</Text>
          {vehicle ? (
            <Text style={styles.subtitle}>{vehicle.make} {vehicle.model} · {vehicle.regNo}</Text>
          ) : multiVehicle ? (
            <Text style={styles.subtitle}>{vehicles.length} vehicles on this booking</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        innerViewRef={contentRef as React.RefObject<View>}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.warnBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#d97706" />
          <Text style={styles.warnText}>
            {billedAtDrop
              ? `A charged damage is added to ${customerName}'s drop bill.`
              : `A charged damage is billed to ${customerName} by the manager after review.`}
            {' '}After the drop, the vehicle goes to the manager for a condition check.
          </Text>
        </View>

        {multiVehicle && (
          <>
            <Text style={styles.label}>Vehicle</Text>
            <View style={styles.chipWrap}>
              {vehicles.map((v) => (
                <TouchableOpacity
                  key={v.publicId}
                  style={[styles.chip, vehiclePublicId === v.publicId && styles.chipActive]}
                  onPress={() => setVehiclePublicId(v.publicId)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, vehiclePublicId === v.publicId && styles.chipTextActive]}>
                    {v.make} {v.model} · {v.regNo}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Damage photos</Text>
        <View style={styles.card}>
          <PhotoCaptureSection
            value={photos}
            onChange={setPhotos}
            upload={async (form) => {
              const res = await employeeApi.uploadDamageImage(form);
              return { fileId: res.data.fileId, url: res.data.url };
            }}
            genericLabel="Add"
            profile="damage"
            onPendingChange={setPhotosPending}
          />
        </View>

        <Text style={styles.label}>Damaged area</Text>
        <View style={styles.chipWrap}>
          {ZONES.map((z) => (
            <TouchableOpacity
              key={z}
              style={[styles.chip, area === z && styles.chipActive]}
              onPress={() => setArea(z)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, area === z && styles.chipTextActive]}>{z}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Severity</Text>
        <View style={styles.segRow}>
          {SEVERITIES.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.seg, severity === s && styles.segActive]}
              onPress={() => setSeverity(s)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segText, severity === s && styles.segTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="What is damaged and how"
          placeholderTextColor={Colors.ink4}
          multiline
        />

        <Text style={styles.label}>Damage cost (₹)</Text>
        <TextInput
          style={styles.input}
          value={cost}
          onChangeText={(t) => setCost(t.replace(/[^\d.]/g, ''))}
          placeholder="0"
          placeholderTextColor={Colors.ink4}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Who pays</Text>
        <View style={styles.segRow}>
          <TouchableOpacity
            style={[styles.seg, chargeCustomer && styles.segActive]}
            onPress={() => setChargeCustomer(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, chargeCustomer && styles.segTextActive]}>Charge customer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.seg, !chargeCustomer && styles.segActive]}
            onPress={() => setChargeCustomer(false)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, !chargeCustomer && styles.segTextActive]}>Company expense</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          {!chargeCustomer
            ? 'Recorded for the manager — the customer is not charged.'
            : billedAtDrop
              ? 'The cost is added to the drop bill (no GST on top).'
              : 'The manager charges this cost when reviewing the damage.'}
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.submitBtn, (busy || photosPending > 0) && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={busy || photosPending > 0}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : photosPending > 0 ? (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color={Colors.white} />
              <Text style={styles.submitBtnText}>Finish uploading photos above</Text>
            </>
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={18} color={Colors.white} />
              <Text style={styles.submitBtnText}>Add damage</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  content: { paddingHorizontal: 20, gap: 8 },
  warnBanner: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: 12,
    marginBottom: 8,
  },
  warnText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: '#92400e', lineHeight: 17 },

  label: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, marginTop: 14, marginBottom: 8 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  chipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },

  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  segActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  segText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink3 },
  segTextActive: { color: Colors.white },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: Colors.ink,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30', marginTop: 12 },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e' },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#dc3545', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#dc3545', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  submitBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  submitBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});
