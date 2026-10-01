import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Toast from '../../components/ui/Toast';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

// Three-step self-service reset: email → OTP → new password. The email is
// captured in step 1 and carried through, so the OTP + password step submits
// { email, otp, password } to the reset endpoint.
type Step = 'email' | 'reset';

const emailSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});
type EmailForm = z.infer<typeof emailSchema>;

const resetSchema = z.object({
  otp: z
    .string()
    .length(6, 'Enter the 6-digit code')
    .regex(/^\d+$/, 'Code must be 6 digits'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .regex(/[A-Z]/, 'Add at least one uppercase letter')
    .regex(/[^a-zA-Z0-9]/, 'Add at least one special character'),
});
type ResetForm = z.infer<typeof resetSchema>;

export default function EmployeeForgotPassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  // Backend sends at most one code per resendAfterSeconds (60 s) per account.
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(10);
  const [toast, setToast] = useState<
    { title: string; message?: string; type?: 'error' | 'success' } | null
  >(null);

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const errMsg = (err: any) =>
    err.response?.data?.message ??
    (err.code === 'ECONNREFUSED' || err.message?.includes('Network')
      ? 'Cannot reach server. Check your connection.'
      : 'Something went wrong. Please try again.');

  // Step 1 — request the code. Backend always returns 200 (no enumeration),
  // so on success we move to the OTP step regardless.
  const onRequest = async (data: EmailForm) => {
    setLoading(true);
    try {
      const res = await employeeApi.forgotPassword(data.email);
      setEmail(data.email);
      setExpiresIn(res.data?.expiresInMinutes ?? 10);
      setCooldown(res.data?.resendAfterSeconds ?? 60);
      setStep('reset');
      setToast({
        title: 'Check your email',
        message: `If an account exists for ${data.email}, we’ve sent a 6-digit reset code.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({ title: 'Could not send code', message: errMsg(err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify code + set new password.
  const onReset = async (data: ResetForm) => {
    setLoading(true);
    try {
      await employeeApi.resetPassword(email, data.otp, data.password);
      setToast({
        title: 'Password updated',
        message: 'Sign in with your new password.',
        type: 'success',
      });
      setTimeout(() => router.replace('/(auth)/employee-sign-in'), 1400);
    } catch (err: any) {
      setToast({ title: 'Reset failed', message: errMsg(err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (loading || cooldown > 0) return;
    setLoading(true);
    try {
      const res = await employeeApi.forgotPassword(email);
      setCooldown(res.data?.resendAfterSeconds ?? 60);
      setToast({ title: 'Code resent', message: `Sent again to ${email}.`, type: 'success' });
    } catch (err: any) {
      setToast({ title: 'Could not resend', message: errMsg(err), type: 'error' });
    } finally {
      setLoading(false);
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.inner,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 80 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => (step === 'reset' ? setStep('email') : router.back())}
            style={styles.back}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>
              Reset{'\n'}
              <Text style={styles.titleAccent}>password.</Text>
            </Text>
            <Text style={styles.subtitle}>
              {step === 'email'
                ? 'Enter your email and we’ll send you a 6-digit reset code.'
                : `Enter the code sent to ${email} (valid for ${expiresIn} minutes) and choose a new password. Only the most recent code works.`}
            </Text>
          </View>

          {step === 'email' ? (
            <>
              <View style={styles.form}>
                <Input
                  control={emailForm.control}
                  name="email"
                  label="Work Email"
                  placeholder="you@company.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  error={emailForm.formState.errors.email?.message}
                />
              </View>
              <Button title="Send reset code" onPress={emailForm.handleSubmit(onRequest)} loading={loading} />
            </>
          ) : (
            <>
              <View style={styles.form}>
                <Input
                  control={resetForm.control}
                  name="otp"
                  label="6-digit code"
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  error={resetForm.formState.errors.otp?.message}
                />
                <Input
                  control={resetForm.control}
                  name="password"
                  label="New password"
                  placeholder="Min 6 chars, 1 uppercase, 1 special"
                  secureTextEntry
                  autoComplete="password-new"
                  error={resetForm.formState.errors.password?.message}
                />
              </View>
              <Button title="Update password" onPress={resetForm.handleSubmit(onReset)} loading={loading} />
              <TouchableOpacity style={styles.resendRow} onPress={resend} disabled={loading || cooldown > 0}>
                <Text style={styles.resendText}>
                  Didn’t get it?{' '}
                  <Text style={styles.resendLink}>
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </Text>
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.switchRow} onPress={() => router.replace('/(auth)/employee-sign-in')}>
            <Text style={styles.switchText}>
              Remembered it? <Text style={styles.switchLink}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  inner: { paddingHorizontal: 24, flexGrow: 1 },
  back: { marginBottom: 32, width: 36, height: 36, justifyContent: 'center' },
  titleBlock: { marginBottom: 36 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 38,
    color: Colors.ink,
    lineHeight: 44,
    letterSpacing: -1.2,
  },
  titleAccent: { fontFamily: Fonts.displayItalic, color: Colors.orange },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    marginTop: 10,
    lineHeight: 22,
  },
  form: { gap: 16, marginBottom: 28 },
  resendRow: { marginTop: 20, alignItems: 'center' },
  resendText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  resendLink: { fontFamily: Fonts.bodySemiBold, color: Colors.orange },
  switchRow: { marginTop: 24, alignItems: 'center' },
  switchText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  switchLink: { fontFamily: Fonts.bodySemiBold, color: Colors.orange },
});
