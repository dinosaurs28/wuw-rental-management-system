import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../components/employee/PhotoCaptureSection';

// One list covering two- and four-wheelers (the employee return endpoint does
// not expose the vehicle category, and the backend stores `area` as free text).
const ZONES = [
  'Front', 'Rear', 'Left Side', 'Right Side',
  'Front Bumper', 'Rear Bumper', 'Door', 'Bonnet / Hood', 'Roof', 'Boot / Trunk',
  'Mirror', 'Headlight / Taillight', 'Windscreen', 'Wheels / Tyres', 'Seat', 'Interior', 'Other',
];

const SEVERITIES = ['Minor', 'Moderate', 'Severe'] as const;
const FUEL_LEVELS = [
  { label: 'Empty', value: 0 },
  { label: '¼', value: 25 },
  { label: '½', value: 50 },
  { label: '¾', value: 75 },
  { label: 'Full', value: 100 },
];

export default function DamageReportScreen() {
  const { bookingId, odo: odoParam, returnImageIds: returnImageIdsParam } =
    useLocalSearchParams<{ bookingId: string; odo?: string; returnImageIds?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Return-condition photos captured on the return screen, carried over so they
  // persist as POST_RETURN photos with this report (the terminal return path).
  const carriedReturnImageIds: string[] = (() => {
    try {
      const parsed = returnImageIdsParam ? JSON.parse(returnImageIdsParam) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  })();

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('Minor');
  const [chargeType, setChargeType] = useState<'PENALTY' | 'COMPENSATION'>('PENALTY');
  const [description, setDescription] = useState('');
  const [odo, setOdo] = useState(odoParam ?? '');
  const [fuelLevel, setFuelLevel] = useState<number>(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: booking } = useQuery({
    queryKey: ['employee', 'return', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getReturnDetails(bookingId as string);
      return res.data?.data as any;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const vehicle = booking?.items?.[0]?.vehicle;
  const customerName = booking?.customer?.user?.name ?? 'the customer';
  const zones = ZONES;

  const submit = async () => {
    if (photos.length === 0) return setError('Add at least one damage photo.');
    if (!area) return setError('Select the damaged area.');
    if (description.trim().length < 4) return setError('Describe the damage.');
    const odoNum = Number(odo);
    if (!Number.isFinite(odoNum) || odoNum < 0) return setError('Enter a valid odometer reading.');

    setError(null);
    setBusy(true);
    try {
      await employeeApi.reportDamage({
        bookingId: bookingId as string,
        odo: odoNum,
        fuelLevel, // 0..100 percent
        severity,
        chargeType,
        damageImageIds: photos.map((p) => p.fileId),
        returnImageIds: carriedReturnImageIds,
        notes: {
          damages: [
            {
              id: String(Date.now()),
              area,
              type: chargeType,
              severity,
              description: description.trim(),
              photos: photos.map((p) => ({ publicId: p.fileId, url: p.url })),
            },
          ],
        },
      });
      Alert.alert(
        'Damage reported',
        'The report has been submitted to the branch manager for review. The booking is now marked returned.',
        [{ text: 'Back to queue', onPress: () => router.replace('/(employee)/bookings') }],
      );
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not submit the damage report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Report Damage</Text>
          {vehicle && <Text style={styles.subtitle}>{vehicle.make} {vehicle.model} · {vehicle.regNo}</Text>}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.warnBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#d97706" />
          <Text style={styles.warnText}>
            This sends a report to the branch manager, who decides the final charge. The booking will be marked returned.
          </Text>
        </View>

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
          />
        </View>

        <Text style={styles.label}>Damaged area</Text>
        <View style={styles.chipWrap}>
          {zones.map((z) => (
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

        <Text style={styles.label}>Charge type</Text>
        <View style={styles.segRow}>
          <TouchableOpacity
            style={[styles.seg, chargeType === 'PENALTY' && styles.segActive]}
            onPress={() => setChargeType('PENALTY')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, chargeType === 'PENALTY' && styles.segTextActive]}>Charge customer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.seg, chargeType === 'COMPENSATION' && styles.segActive]}
            onPress={() => setChargeType('COMPENSATION')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, chargeType === 'COMPENSATION' && styles.segTextActive]}>Company expense</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder={`Describe the damage for ${customerName}'s booking`}
          placeholderTextColor={Colors.ink4}
          multiline
        />

        <Text style={styles.label}>Odometer (km)</Text>
        <TextInput
          style={styles.input}
          value={odo}
          onChangeText={setOdo}
          placeholder="0"
          placeholderTextColor={Colors.ink4}
          keyboardType="numeric"
        />

        <Text style={styles.label}>Fuel level</Text>
        <View style={styles.fuelRow}>
          {FUEL_LEVELS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.fuelBtn, fuelLevel === f.value && styles.fuelBtnActive]}
              onPress={() => setFuelLevel(f.value)}
              activeOpacity={0.8}
            >
              <Text style={[styles.fuelBtnText, fuelLevel === f.value && styles.fuelBtnTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={[styles.submitBtn, busy && styles.submitBtnDisabled]} onPress={submit} disabled={busy} activeOpacity={0.85}>
          {busy ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color={Colors.white} />
              <Text style={styles.submitBtnText}>Submit to manager</Text>
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

  fuelRow: { flexDirection: 'row', gap: 6 },
  fuelBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  fuelBtnActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  fuelBtnTextActive: { color: Colors.white },

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
