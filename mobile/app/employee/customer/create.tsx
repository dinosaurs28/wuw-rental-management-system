import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import {
  aadhaarError,
  drivingLicenceError,
  formatAadhaarInput,
  normalizeAadhaar,
  normalizeDrivingLicence,
  profileIncompleteMessage,
} from '../../../lib/identity';
import { useEmployeeBookingStore } from '../../../store/employeeBooking';

type Step = 'PHONE' | 'OTP' | 'PROFILE';

/** GET /employee/customer/:publicId — the fields this form prefills from. */
interface CustomerPrefill {
  name: string;
  email: string | null; // null for a walk-in placeholder
  phone: string | null;
  dob: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  drivingLicenceNumber?: string | null;
  aadhaarNumber?: string | null;
  isProfileCompleted?: boolean;
  missingFields?: string[];
}

// Date of birth from the three DD / MM / YYYY boxes → "YYYY-MM-DD", or an
// error. Same rule as the web form and the backend: required, and 18+.
function parseDob(dd: string, mm: string, yyyy: string): { value: string } | { error: string } {
  if (!dd && !mm && !yyyy) return { error: "Enter the customer's date of birth." };
  const d = Number(dd);
  const m = Number(mm);
  const y = Number(yyyy);
  const date = new Date(y, m - 1, d);
  if (
    yyyy.length !== 4 || y < 1900 ||
    date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d
  ) {
    return { error: 'Enter a valid date of birth (DD / MM / YYYY).' };
  }
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  if (date > cutoff) return { error: 'The customer must be at least 18 years old.' };
  return { value: `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function Field({
  label, value, onChangeText, hint, ...rest
}: { label: string; value: string; onChangeText: (t: string) => void; hint?: string } & TextInputProps) {
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
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// Stored DOBs are "YYYY-MM-DD" (sometimes a full ISO string) → DD / MM / YYYY boxes.
function dobParts(dob: string | null | undefined): { d: string; m: string; y: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob ?? ''));
  return match ? { y: match[1]!, m: match[2]!, d: match[3]! } : null;
}

export default function CreateCustomerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const resetBooking = useEmployeeBookingStore((s) => s.reset);
  const setBookingCustomer = useEmployeeBookingStore((s) => s.setCustomer);

  // Complete mode (#1): fill in an EXISTING customer's missing details (e.g. DL
  // and Aadhaar numbers) via the same walk-in complete endpoint, skipping the
  // phone/OTP steps. `next=back` returns to the screen that sent us here (the
  // walk-in summary after a 422 CUSTOMER_PROFILE_INCOMPLETE); otherwise the
  // booking flow starts for this customer.
  const params = useLocalSearchParams<{ mode?: string; publicId?: string; next?: string }>();
  const completePublicId = params.mode === 'complete' && params.publicId ? String(params.publicId) : null;
  const isComplete = !!completePublicId;

  const [step, setStep] = useState<Step>(isComplete ? 'PROFILE' : 'PHONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [customerPublicId, setCustomerPublicId] = useState(completePublicId ?? '');
  const [otpShown, setOtpShown] = useState('');
  const [otp, setOtp] = useState('');
  // true when initiate picked up an earlier, never-verified walk-in for this phone.
  const [resumed, setResumed] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [country, setCountry] = useState('India');
  const [altPhone, setAltPhone] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [aadhaar, setAadhaar] = useState('');

  // Same query (key + shape) as the customer detail screen, so it is usually cached.
  const {
    data: existing,
    isLoading: existingLoading,
    isError: existingError,
  } = useQuery<CustomerPrefill>({
    queryKey: ['employee', 'customer', completePublicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomer(completePublicId as string);
      return res.data?.data as CustomerPrefill;
    },
    enabled: isComplete,
    staleTime: 60_000,
    retry: false,
  });
  // The customer already has a real email (null = placeholder): read-only here,
  // and never resent — the server refuses a change (EMAIL_CHANGE_NOT_ALLOWED).
  const hasStoredEmail = isComplete && !!existing?.email;

  // The error box sits below the (long) profile form — bring it into view.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [error]);

  // Prefill once. The email is null for a walk-in placeholder, so the input
  // stays empty and a placeholder is never re-sent.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!existing || prefilledRef.current) return;
    prefilledRef.current = true;
    setName(existing.name ?? '');
    setEmail(existing.email ?? '');
    setPhone(existing.phone ?? '');
    const dob = dobParts(existing.dob);
    if (dob) {
      setDobDay(dob.d);
      setDobMonth(dob.m);
      setDobYear(dob.y);
    }
    setAddressLine1(existing.addressLine1 ?? '');
    setCity(existing.city ?? '');
    setStateName(existing.state ?? '');
    setZipCode(existing.zipCode ?? '');
    setCountry(existing.country || 'India');
    setDlNumber(existing.drivingLicenceNumber ?? '');
    setAadhaar(existing.aadhaarNumber ? formatAadhaarInput(existing.aadhaarNumber) : '');
  }, [existing]);

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
      const id: string | undefined = res.data?.customer_public_id;
      // Complete mode only falls back to OTP to verify THIS customer's phone.
      if (isComplete && id !== completePublicId) {
        setError('This phone number belongs to a different customer record.');
        return;
      }
      setCustomerPublicId(id ?? '');
      setResumed(res.data?.resumed === true);
      setOtpShown(String(res.data?.otp ?? ''));
      setOtp(String(res.data?.otp ?? '')); // dev: OTP is returned in the response
      setStep('OTP');
    } catch (err: any) {
      const data = err?.response?.data;
      const message: string = data?.message ?? 'Could not send OTP.';
      setError(message);
      // The phone already belongs to a customer: open them instead of dead-ending.
      if (data?.code === 'CUSTOMER_ALREADY_EXISTS' && data?.customer_public_id && !isComplete) {
        const existingId = String(data.customer_public_id);
        Alert.alert('Customer already exists', `${message.replace(/\.$/, '')}. Open their profile to continue.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open customer', onPress: () => router.replace(`/employee/customer/${existingId}`) },
        ]);
      }
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
    // Email is optional for walk-ins (#1): only checked when filled in.
    const emailValue = email.trim();
    if (emailValue && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailValue)) return setError('Enter a valid email.');
    const dob = parseDob(dobDay.trim(), dobMonth.trim(), dobYear.trim());
    if ('error' in dob) return setError(dob.error);
    const dlProblem = drivingLicenceError(dlNumber);
    if (dlProblem) return setError(dlProblem);
    const aadhaarProblem = aadhaarError(aadhaar);
    if (aadhaarProblem) return setError(aadhaarProblem);
    if (!addressLine1.trim() || !city.trim() || !stateName.trim() || !zipCode.trim() || !country.trim()) {
      return setError('Fill in the full address.');
    }
    setError(null);
    setBusy(true);
    try {
      const res = await employeeApi.walkinComplete({
        customer_public_id: customerPublicId,
        name: name.trim(),
        // Blank = omitted: the server keeps the stored email (or placeholder).
        ...(emailValue && !hasStoredEmail ? { email: emailValue } : {}),
        drivingLicenceNumber: normalizeDrivingLicence(dlNumber.trim()),
        aadhaarNumber: normalizeAadhaar(aadhaar.trim()),
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: stateName.trim(),
        country: country.trim(),
        zipCode: zipCode.trim(),
        dob: dob.value,
        ...(altPhone.trim() ? { alternatePhone: altPhone.trim() } : {}),
      });
      // Detail screen + search badge read these.
      qc.invalidateQueries({ queryKey: ['employee', 'customer', customerPublicId] });
      qc.invalidateQueries({ queryKey: ['employee', 'customer-search'] });
      // Saved, but something the counter can't set here is still missing
      // (e.g. an online customer without a phone number) — booking would 422.
      if (res.data?.isProfileCompleted === false) {
        setError(
          res.data?.message ??
            profileIncompleteMessage(res.data?.missingFields ?? [], 'staff'),
        );
        return;
      }
      const bookingCustomer = { publicId: customerPublicId, name: name.trim(), phone: phone.trim() || null };
      if (isComplete && params.next === 'back') {
        // Mid-booking: keep the vehicle, dates and KYC already chosen.
        setBookingCustomer(bookingCustomer);
        router.back();
        return;
      }
      resetBooking();
      setBookingCustomer(bookingCustomer);
      router.replace('/employee/booking/vehicles');
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      const message: string = data?.message ?? 'Could not save the customer.';
      // An earlier walk-in whose OTP was never verified: verify the phone first,
      // then this same form is submitted again. Older servers sent no code.
      const verificationPending =
        data?.code === 'VERIFICATION_PENDING' ||
        (status === 403 && !data?.code && /verif/i.test(message));
      if (isComplete && verificationPending && phone.trim()) {
        setError(message);
        Alert.alert('Verify the phone number', `${message} A code will be sent to ${phone.trim()}.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send OTP', onPress: () => { void sendOtp(); } },
        ]);
        return;
      }
      // New walk-in whose OTP did not stick: back to the phone step to resend it.
      if (!isComplete && verificationPending) setStep('PHONE');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = step === 'PHONE' ? 1 : step === 'OTP' ? 2 : 3;
  const headerTitle = isComplete ? 'Complete profile' : 'New Customer';
  const headerSubtitle = isComplete
    ? step === 'OTP' ? 'Verify the phone number' : 'Required before booking'
    : `Step ${stepIndex} of 3`;
  // What the server says is still missing on this customer (complete mode).
  const missingNote =
    isComplete && existing && existing.missingFields && existing.missingFields.length > 0
      ? profileIncompleteMessage(existing.missingFields, 'staff')
      : null;

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
          <Text style={styles.title}>{headerTitle}</Text>
          <Text style={styles.subtitle}>{headerSubtitle}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
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
            {resumed ? (
              <View style={styles.otpBanner}>
                <Ionicons name="refresh-outline" size={16} color={Colors.orange} />
                <Text style={styles.otpBannerText}>Resuming the earlier walk-in for this number.</Text>
              </View>
            ) : null}
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

        {step === 'PROFILE' && isComplete && existingLoading && (
          <ActivityIndicator style={styles.prefillLoader} color={Colors.orange} size="large" />
        )}

        {step === 'PROFILE' && !(isComplete && existingLoading) && (
          <>
            {isComplete && existingError ? (
              <View style={styles.noteBox}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.ink3} />
                <Text style={styles.noteText}>Could not load the saved details. Fill in every field to save the profile.</Text>
              </View>
            ) : missingNote ? (
              <View style={styles.noteBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.orange} />
                <Text style={styles.noteText}>{missingNote}</Text>
              </View>
            ) : null}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Customer details</Text>
              <Field label="Full name" value={name} onChangeText={setName} placeholder="Customer name" autoCapitalize="words" />
              <Field
                label="Email (optional)"
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                // A real stored email is the customer's sign-in: only they can change it.
                editable={!hasStoredEmail}
                style={hasStoredEmail ? [styles.input, styles.inputLocked] : styles.input}
                hint={
                  hasStoredEmail
                    ? "The customer's sign-in email. It can't be changed at the counter."
                    : 'Leave blank if the customer has no email.'
                }
              />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Date of birth</Text>
                <View style={styles.dobRow}>
                  <TextInput
                    style={[styles.input, styles.dobPart]}
                    value={dobDay}
                    onChangeText={(t) => setDobDay(t.replace(/\D/g, ''))}
                    placeholder="DD"
                    placeholderTextColor={Colors.ink4}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <TextInput
                    style={[styles.input, styles.dobPart]}
                    value={dobMonth}
                    onChangeText={(t) => setDobMonth(t.replace(/\D/g, ''))}
                    placeholder="MM"
                    placeholderTextColor={Colors.ink4}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <TextInput
                    style={[styles.input, styles.dobYear]}
                    value={dobYear}
                    onChangeText={(t) => setDobYear(t.replace(/\D/g, ''))}
                    placeholder="YYYY"
                    placeholderTextColor={Colors.ink4}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                </View>
                <Text style={styles.fieldHint}>Customer must be 18 or older.</Text>
              </View>
              <Field label="Alternate phone (optional)" value={altPhone} onChangeText={setAltPhone} placeholder="Optional" keyboardType="phone-pad" />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Identity</Text>
              <Text style={styles.cardSub}>Required to create a booking.</Text>
              <Field
                label="Driving Licence number *"
                value={dlNumber}
                onChangeText={setDlNumber}
                placeholder="KA01 20110012345"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={24}
              />
              <Field
                label="Aadhaar number *"
                value={aadhaar}
                onChangeText={(t) => setAadhaar(formatAadhaarInput(t))}
                placeholder="1234 5678 9012"
                keyboardType="number-pad"
                maxLength={14}
              />
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
          style={[styles.cta, (busy || (isComplete && existingLoading)) && styles.ctaDisabled]}
          onPress={step === 'PHONE' ? sendOtp : step === 'OTP' ? verifyOtp : completeProfile}
          disabled={busy || (isComplete && existingLoading)}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.ctaText}>
              {step === 'PHONE'
                ? 'Send OTP'
                : step === 'OTP'
                  ? 'Verify'
                  : isComplete ? 'Save & continue' : 'Create & continue'}
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
  fieldHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  dobRow: { flexDirection: 'row', gap: 8 },
  dobPart: { flex: 1, textAlign: 'center' },
  dobYear: { flex: 1.6, textAlign: 'center' },
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
  inputLocked: {
    color: Colors.ink3,
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

  prefillLoader: { marginTop: 60 },
  noteBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.hairline },
  noteText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, flex: 1, lineHeight: 18 },

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
