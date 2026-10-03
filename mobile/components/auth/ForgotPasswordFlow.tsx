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
import Toast from '../ui/Toast';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Colors, Fonts } from '../../constants/colors';
import { authApi } from '../../lib/api';

// Self-service reset shared by the customer and Fleet screens. SMS is the
// default channel: identifier (mobile or email) -> 6-digit code sent by SMS to
// the phone on the account -> new password. Email (emailed 6-digit code) stays
// as the alternative. Both backends answer the request step with a generic 200.
type Channel = 'SMS' | 'EMAIL';
type Step = 'request' | 'reset';

type Api = {
  smsForgotPassword: (identifier: string) => Promise<any>;
  smsResetPassword: (identifier: string, otp: string, password: string) => Promise<any>;
  forgotPassword: (email: string) => Promise<any>;
  resetPassword: (email: string, otp: string, password: string) => Promise<any>;
};

type Props = {
  api: Api;
  signInRoute: string;
  emailLabel: string;
  emailPlaceholder: string;
};

const identifierSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your mobile number or email'),
});
type IdentifierForm = z.infer<typeof identifierSchema>;

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

export default function ForgotPasswordFlow({ api, signInRoute, emailLabel, emailPlaceholder }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [channel, setChannel] = useState<Channel>('SMS');
  const [step, setStep] = useState<Step>('request');
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  // Backend sends at most one code per resendAfterSeconds (60 s) per account.
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(10);
  const [emailOff, setEmailOff] = useState(false);
  const [toast, setToast] = useState<
    { title: string; message?: string; type?: 'error' | 'success' } | null
  >(null);

  const idForm = useForm<IdentifierForm>({ resolver: zodResolver(identifierSchema) });
  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  // Informational only: never blocks the UI (a failed call changes nothing).
  useEffect(() => {
    let alive = true;
    authApi
      .passwordResetChannels()
      .then((r) => {
        if (alive && r.data?.email === false) setEmailOff(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  const send = (to: string) =>
    channel === 'SMS' ? api.smsForgotPassword(to) : api.forgotPassword(to);

  const onRequest = async (to: string) => {
    setLoading(true);
    try {
      const res = await send(to);
      setTarget(to);
      setExpiresIn(res.data?.expiresInMinutes ?? 10);
      setCooldown(res.data?.resendAfterSeconds ?? 60);
      resetForm.reset({ otp: '', password: '' });
      setStep('reset');
      setToast(
        channel === 'SMS'
          ? {
              title: 'Check your messages',
              message: 'If an account matches, we’ve sent a 6-digit code by SMS to its mobile number.',
              type: 'success',
            }
          : {
              title: 'Check your email',
              message: `If an account exists for ${to}, we’ve sent a 6-digit reset code.`,
              type: 'success',
            },
      );
    } catch (err: any) {
      setToast({ title: 'Could not send code', message: errMsg(err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const onReset = async (data: ResetForm) => {
    setLoading(true);
    try {
      if (channel === 'SMS') await api.smsResetPassword(target, data.otp, data.password);
      else await api.resetPassword(target, data.otp, data.password);
      setToast({
        title: 'Password updated',
        message: 'Sign in with your new password.',
        type: 'success',
      });
      setTimeout(() => router.replace(signInRoute as never), 1400);
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
      const res = await send(target);
      setCooldown(res.data?.resendAfterSeconds ?? 60);
      setToast({
        title: 'Code resent',
        message: channel === 'SMS' ? 'We’ve sent a new code by SMS.' : `Sent again to ${target}.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({ title: 'Could not resend', message: errMsg(err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const switchChannel = (c: Channel) => {
    if (c === channel) return;
    setChannel(c);
    setStep('request');
  };

  const subtitle =
    step === 'request'
      ? channel === 'SMS'
        ? 'Enter your registered mobile number or email and we’ll text a 6-digit reset code to the mobile number on your account.'
        : 'Enter your email and we’ll send you a 6-digit reset code.'
      : channel === 'SMS'
        ? `Enter the code we sent by SMS (valid for ${expiresIn} minutes) and choose a new password. Only the most recent code works.`
        : `Enter the code sent to ${target} (valid for ${expiresIn} minutes) and choose a new password. Only the most recent code works.`;

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
            onPress={() => (step === 'reset' ? setStep('request') : router.back())}
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
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          {step === 'request' ? (
            <>
              <View style={styles.form}>
                {channel === 'SMS' ? (
                  <Input
                    control={idForm.control}
                    name="identifier"
                    label="Mobile number or email"
                    placeholder="98765 43210 or you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="off"
                    error={idForm.formState.errors.identifier?.message}
                  />
                ) : (
                  <Input
                    control={emailForm.control}
                    name="email"
                    label={emailLabel}
                    placeholder={emailPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    error={emailForm.formState.errors.email?.message}
                  />
                )}
                {channel === 'EMAIL' && emailOff && (
                  <Text style={styles.note}>
                    Email reset may be unavailable right now — if you don’t get an email, use the SMS code instead.
                  </Text>
                )}
              </View>
              <Button
                title={channel === 'SMS' ? 'Send code by SMS' : 'Send reset code'}
                onPress={
                  channel === 'SMS'
                    ? idForm.handleSubmit((d) => onRequest(d.identifier))
                    : emailForm.handleSubmit((d) => onRequest(d.email))
                }
                loading={loading}
              />
              <TouchableOpacity
                style={styles.resendRow}
                onPress={() => switchChannel(channel === 'SMS' ? 'EMAIL' : 'SMS')}
              >
                <Text style={styles.resendText}>
                  <Text style={styles.resendLink}>
                    {channel === 'SMS' ? 'Use email instead' : 'Use SMS code instead'}
                  </Text>
                </Text>
              </TouchableOpacity>
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
              {channel === 'SMS' && (
                <>
                  <Text style={[styles.note, { textAlign: 'center', marginTop: 12 }]}>
                    No SMS? Check the number, or use your email address instead — the code still goes to the mobile number on your account.
                  </Text>
                  <TouchableOpacity style={styles.resendRow} onPress={() => switchChannel('EMAIL')}>
                    <Text style={styles.resendLink}>Use email instead</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          <TouchableOpacity style={styles.switchRow} onPress={() => router.replace(signInRoute as never)}>
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
  note: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, lineHeight: 19 },
  resendRow: { marginTop: 20, alignItems: 'center' },
  resendText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  resendLink: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
  switchRow: { marginTop: 24, alignItems: 'center' },
  switchText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  switchLink: { fontFamily: Fonts.bodySemiBold, color: Colors.orange },
});
