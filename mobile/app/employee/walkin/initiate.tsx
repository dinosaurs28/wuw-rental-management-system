import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import Toast from '../../../components/ui/Toast';

const RESEND_SECONDS = 60;

export default function WalkinInitiate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const otpRef = useRef<TextInput>(null);

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [customerPublicId, setCustomerPublicId] = useState<string | null>(null);
  const [receivedOtp, setReceivedOtp] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' | 'info' } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const validatePhone = () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) {
      setPhoneError('Enter a valid 10-digit phone number');
      return null;
    }
    setPhoneError(null);
    return cleaned;
  };

  const handleSendOtp = async () => {
    const cleaned = validatePhone();
    if (!cleaned) return;

    setSending(true);
    try {
      const res = await employeeApi.walkinInitiate({ phone: cleaned });
      setCustomerPublicId(res.data.customer_public_id);
      setReceivedOtp(res.data.otp ? String(res.data.otp) : null);
      setOtpSent(true);
      setCooldown(RESEND_SECONDS);
      setToast({ title: 'OTP sent', message: 'Share the code with the customer.', type: 'success' });
      setTimeout(() => otpRef.current?.focus(), 250);
    } catch (err: any) {
      setToast({
        title: 'Could not send OTP',
        message: err.response?.data?.message ?? 'Something went wrong.',
        type: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || sending) return;
    setOtp('');
    setOtpError(null);
    await handleSendOtp();
  };

  const handleVerify = async () => {
    if (!customerPublicId) return;
    if (otp.length !== 6) {
      setOtpError('Enter the 6-digit OTP');
      return;
    }
    setOtpError(null);
    setVerifying(true);
    try {
      await employeeApi.walkinVerify({ customer_public_id: customerPublicId, otp });
      router.replace({
        pathname: '/employee/walkin/profile',
        params: {
          customerPublicId,
          phone,
          ...(next ? { next } : {}),
        },
      } as any);
    } catch (err: any) {
      setToast({
        title: 'Invalid OTP',
        message: err.response?.data?.message ?? 'Please try again.',
        type: 'error',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Toast
        visible={!!toast}
        title={toast?.title ?? ''}
        message={toast?.message}
        type={toast?.type ?? 'error'}
        onDismiss={() => setToast(null)}
      />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Walk-in</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Verify customer phone</Text>
          <Text style={styles.subtitle}>
            We'll send a 6-digit code to confirm the customer's number.
          </Text>

          <View style={styles.section}>
            <Text style={styles.label}>Phone number</Text>
            <View style={[styles.phoneRow, phoneError && styles.rowError, otpSent && styles.disabled]}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>+91</Text>
              </View>
              <View style={styles.sep} />
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                keyboardType="number-pad"
                placeholder="10-digit number"
                placeholderTextColor={Colors.ink4}
                editable={!otpSent}
                maxLength={10}
                returnKeyType="done"
                onSubmitEditing={!otpSent ? handleSendOtp : undefined}
              />
            </View>
            {phoneError ? <Text style={styles.error}>{phoneError}</Text> : null}
          </View>

          {otpSent && receivedOtp ? (
            <View style={styles.otpCard}>
              <Text style={styles.otpCardTitle}>One-Time Password</Text>
              <Text style={styles.otpCardSub}>Share this code with the customer.</Text>
              <View style={styles.otpCodeWrap}>
                <Text style={styles.otpCodeText}>{receivedOtp}</Text>
              </View>
            </View>
          ) : null}

          {otpSent ? (
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Enter OTP</Text>
                <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || sending} hitSlop={8}>
                  <Text style={[styles.resend, (cooldown > 0 || sending) && styles.resendDisabled]}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.inputRow, otpError && styles.rowError]}>
                <TextInput
                  ref={otpRef}
                  style={styles.input}
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="6-digit code"
                  placeholderTextColor={Colors.ink4}
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                />
              </View>
              {otpError ? <Text style={styles.error}>{otpError}</Text> : null}
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.cta,
              ((!otpSent && sending) || (otpSent && verifying)) && styles.ctaBusy,
            ]}
            onPress={otpSent ? handleVerify : handleSendOtp}
            disabled={otpSent ? verifying : sending}
            activeOpacity={0.85}
          >
            {(otpSent ? verifying : sending) ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.ctaText}>{otpSent ? 'Verify OTP' : 'Send OTP'}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 24 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginBottom: 24,
    lineHeight: 20,
  },
  section: { gap: 6, marginBottom: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, letterSpacing: 0.2 },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  prefix: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: Colors.bg,
  },
  prefixText: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.ink2 },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.hairline },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  inputRow: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
    letterSpacing: 4,
  },
  rowError: { borderColor: '#e53e3e' },
  disabled: { opacity: 0.6 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },
  resend: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  resendDisabled: { color: Colors.ink4 },
  otpCard: {
    backgroundColor: Colors.orangeSoft,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.orange + '33',
  },
  otpCardTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  otpCardSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  otpCodeWrap: {
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  otpCodeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: 8,
  },
  cta: {
    marginTop: 16,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});
