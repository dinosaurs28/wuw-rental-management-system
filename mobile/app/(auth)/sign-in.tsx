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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { Ionicons } from '@expo/vector-icons';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { User } from '../../types/api';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
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

export default function SignIn() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const insets = useSafeAreaInsets();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const target = safeReturnTo(returnTo);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string } | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await authApi.signIn(data.email, data.password);
      const payload = res.data?.data as (User & { accessToken?: string }) | undefined;
      // 201 (no accessToken) → the account exists but the email isn't verified yet.
      if (!payload?.accessToken) {
        setToast({
          title: 'Verify your account',
          message: 'Your account isn’t verified yet. Please complete verification with our team to continue.',
        });
        return;
      }
      const { accessToken, ...user } = payload;
      await signIn(accessToken, user as User);
      // Resume whatever the guest was doing, falling back to the fleet.
      router.replace((target ?? '/(tabs)') as any);
    } catch (err: any) {
      const msg = err.response?.data?.message
        ?? (err.code === 'ECONNREFUSED' || err.message?.includes('Network')
          ? 'Cannot reach server. Check your connection.'
          : 'Something went wrong. Please try again.');
      setToast({ title: 'Sign in failed', message: msg });
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
      type="error"
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
            Welcome{'\n'}
            <Text style={styles.titleAccent}>back.</Text>
          </Text>
          <Text style={styles.subtitle}>Sign in to your account to continue.</Text>
        </View>

        <View style={styles.form}>
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
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            error={errors.password?.message}
          />
          <TouchableOpacity
            style={styles.forgotRow}
            onPress={() => router.push('/(auth)/forgot-password')}
            hitSlop={8}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <Button
          title="Sign in"
          onPress={handleSubmit(onSubmit)}
          loading={loading}
        />

        <TouchableOpacity
          style={styles.switchRow}
          onPress={() =>
            router.replace({
              pathname: '/(auth)/sign-up',
              params: target ? { returnTo: target } : {},
            })
          }
        >
          <Text style={styles.switchText}>
            No account?{' '}
            <Text style={styles.switchLink}>Create one</Text>
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
  forgotRow: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.orange,
    letterSpacing: 0.1,
  },
  switchRow: { marginTop: 24, alignItems: 'center' },
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
