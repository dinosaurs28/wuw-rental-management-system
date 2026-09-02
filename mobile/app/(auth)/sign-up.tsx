import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from '../../components/ui/Toast';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { LEGAL_URLS } from '../../constants/links';
import type { User } from '../../types/api';
import { Ionicons } from '@expo/vector-icons';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
});
type FormData = z.infer<typeof schema>;

/**
 * A guest sent here mid-flow carries where they were headed. Only an internal
 * app path may be resumed — never a scheme, host or anything we'd hand to the
 * router unchecked.
 */
function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://') || /[\s\\]/.test(value)) return null;
  return value;
}

export default function SignUp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useAuthStore((s) => s.signIn);
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const target = safeReturnTo(returnTo);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      await authApi.signUp(data.name, data.email, data.password);
      // Email signups are auto-verified, so an immediate sign-in returns a token —
      // log the user straight in instead of bouncing them to the sign-in screen.
      try {
        const res = await authApi.signIn(data.email, data.password);
        const payload = res.data?.data as (User & { accessToken?: string }) | undefined;
        if (payload?.accessToken) {
          const { accessToken, ...user } = payload;
          await signIn(accessToken, user as User);
          // Resume whatever the guest was doing, falling back to the fleet.
          router.replace((target ?? '/(tabs)') as any);
          return;
        }
      } catch {
        // auto sign-in failed (e.g. unverified / transient) — fall back to manual sign-in below
      }
      setToast({ title: 'Account created!', message: 'Sign in to get started.', type: 'success' });
      setTimeout(
        () =>
          router.replace({
            pathname: '/(auth)/sign-in',
            params: target ? { returnTo: target } : {},
          }),
        1800,
      );
    } catch (err: any) {
      setToast({
        title: 'Sign up failed',
        message: err.response?.data?.message ?? 'Something went wrong. Please try again.',
        type: 'error',
      });
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
        {/* Never a dead end — a guest with nothing behind them goes to the fleet. */}
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          style={styles.back}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>
            Create your{'\n'}
            <Text style={styles.titleAccent}>account.</Text>
          </Text>
          <Text style={styles.subtitle}>
            Join WUW and access our curated fleet.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            control={control}
            name="name"
            label="Full name"
            placeholder="Jane Smith"
            autoCapitalize="words"
            autoComplete="name"
            error={errors.name?.message}
          />
          <Input
            control={control}
            name="email"
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email?.message}
          />
          <Input
            control={control}
            name="password"
            label="Password"
            placeholder="Min 6 chars, 1 uppercase, 1 special"
            secureTextEntry
            autoComplete="new-password"
            error={errors.password?.message}
          />
        </View>

        <Button
          title="Create account"
          onPress={handleSubmit(onSubmit)}
          loading={loading}
        />

        <Text style={styles.terms}>
          By continuing you agree to our{' '}
          <Text
            style={styles.termsLink}
            onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}
          >
            Terms
          </Text>{' '}&{' '}
          <Text
            style={styles.termsLink}
            onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.privacy)}
          >
            Privacy Policy
          </Text>.
        </Text>

        <TouchableOpacity
          style={styles.switchRow}
          onPress={() =>
            router.replace({
              pathname: '/(auth)/sign-in',
              params: target ? { returnTo: target } : {},
            })
          }
        >
          <Text style={styles.switchText}>
            Already have an account?{' '}
            <Text style={styles.switchLink}>Sign in</Text>
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
  backIcon: { fontSize: 24, color: Colors.ink },
  titleBlock: { marginBottom: 36 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 38,
    color: Colors.ink,
    lineHeight: 44,
    letterSpacing: -1.2,
  },
  titleAccent: {
    fontFamily: Fonts.displayItalic,
    color: Colors.orange,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    marginTop: 10,
    lineHeight: 22,
  },
  form: { gap: 16, marginBottom: 28 },
  terms: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  termsLink: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink2,
  },
  switchRow: { marginTop: 20, alignItems: 'center' },
  switchText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
  },
  switchLink: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.orange,
  },
});
