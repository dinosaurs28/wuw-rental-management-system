import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { useEmployeeBookingStore } from '../../../store/employeeBooking';

type Step = 'PHONE' | 'OTP' | 'PROFILE';

function Field({
  label, value, onChangeText, ...rest
}: { label: string; value: string; onChangeText: (t: string) => void } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={Colors.ink4}
        {...rest}
      />
    </View>
  );
}

export default function CreateCustomerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetBooking = useEmployeeBookingStore((s) => s.reset);
  const setBookingCustomer = useEmployeeBookingStore((s) => s.setCustomer);

  const [step, setStep] = useState<Step>('PHONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [customerPublicId, setCustomerPublicId] = useState('');
  const [otpShown, setOtpShown] = useState('');
  const [otp, setOtp] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [country, setCountry] = useState('India');
  const [altPhone, setAltPhone] = useState('');

  const sendOtp = async () => {
    const p = phone.trim();
    if (!/^\+?[1-9]\d{9,14}$/.test(p) || p.length > 15) {
      setError('Enter a valid phone number.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await employeeApi.walkinInitiate(p);
      setCustomerPublicId(res.data?.customer_public_id);
      setOtpShown(String(res.data?.otp ?? ''));
      setOtp(String(res.data?.otp ?? '')); // dev: OTP is returned in the response
      setStep('OTP');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not send OTP.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await employeeApi.walkinVerify(customerPublicId, otp.trim());
      setStep('PROFILE');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not verify OTP.');
    } finally {
      setBusy(false);
    }
  };

  const completeProfile = async () => {
    if (name.trim().length < 2) return setError('Enter the customer name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Enter a valid email.');
    if (!addressLine1.trim() || !city.trim() || !stateName.trim() || !zipCode.trim() || !country.trim()) {
      return setError('Fill in the full address.');
    }
    setError(null);
    setBusy(true);
    try {
      await employeeApi.walkinComplete({
        customer_public_id: customerPublicId,
        name: name.trim(),
        email: email.trim(),
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: stateName.trim(),
        country: country.trim(),
        zipCode: zipCode.trim(),
        ...(dob.trim() ? { dob: dob.trim() } : {}),
        ...(altPhone.trim() ? { alternatePhone: altPhone.trim() } : {}),
      });
      resetBooking();
      setBookingCustomer({ publicId: customerPublicId, name: name.trim(), phone: phone.trim() });
      router.replace('/employee/booking/vehicles');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not save the customer.');
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = step === 'PHONE' ? 1 : step === 'OTP' ? 2 : 3;

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
          <Text style={styles.title}>New Customer</Text>
          <Text style={styles.subtitle}>Step {stepIndex} of 3</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'PHONE' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Customer phone</Text>
            <Text style={styles.cardSub}>We'll send a one-time code to verify the number.</Text>
            <Field
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 9876543210"
              keyboardType="phone-pad"
              autoFocus
            />
          </View>
        )}

        {step === 'OTP' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verify OTP</Text>
            {otpShown ? (
              <View style={styles.otpBanner}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.orange} />
                <Text style={styles.otpBannerText}>Code sent to {phone}: <Text style={styles.otpCode}>{otpShown}</Text></Text>
              </View>
            ) : null}
            <Field
              label="6-digit code"
              value={otp}
              onChangeText={setOtp}
              placeholder="000000"
              keyboardType="number-pad"
              maxLength={6}
            />
            <Text style={styles.otpHint}>Code expires in 5 minutes — verify now.</Text>
          </View>
        )}

        {step === 'PROFILE' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Customer details</Text>
              <Field label="Full name" value={name} onChangeText={setName} placeholder="Customer name" autoCapitalize="words" />
              <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
              <Field label="Date of birth (optional)" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
              <Field label="Alternate phone (optional)" value={altPhone} onChangeText={setAltPhone} placeholder="Optional" keyboardType="phone-pad" />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Address</Text>
              <Field label="Address line" value={addressLine1} onChangeText={setAddressLine1} placeholder="Street address" />
              <Field label="City" value={city} onChangeText={setCity} placeholder="City" />
              <Field label="State" value={stateName} onChangeText={setStateName} placeholder="State" />
              <Field label="Zip code" value={zipCode} onChangeText={setZipCode} placeholder="Zip / PIN" keyboardType="number-pad" />
              <Field label="Country" value={country} onChangeText={setCountry} placeholder="Country" />
            </View>
          </>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.cta, busy && styles.ctaDisabled]}
          onPress={step === 'PHONE' ? sendOtp : step === 'OTP' ? verifyOtp : completeProfile}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.ctaText}>
              {step === 'PHONE' ? 'Send OTP' : step === 'OTP' ? 'Verify' : 'Create & continue'}
            </Text>
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
  headerText: { gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  content: { paddingHorizontal: 20, gap: 12 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, gap: 14 },
  cardTitle: { fontFamily: Fonts.displayBold, fontSize: 16, color: Colors.ink, letterSpacing: -0.3 },
  cardSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: -8, lineHeight: 18 },

  field: { gap: 6 },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },

  otpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff8f4',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ff6a1f25',
  },
  otpBannerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, flex: 1 },
  otpCode: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.orange, letterSpacing: 2 },
  otpHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30' },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  ctaDisabled: { opacity: 0.5, shadowOpacity: 0 },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});
