import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from '../../components/ui/Toast';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Fonts } from '../../constants/colors';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { Ionicons } from '@expo/vector-icons';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { User } from '../../types/api';

WebBrowser.maybeCompleteAuthSession();

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

export default function SignUp() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);

  const [, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.params?.id_token;
    if (!idToken) {
      setToast({ title: 'Google sign-in failed', message: 'No id_token returned by Google.' });
      setGoogleLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await authApi.googleSignIn(idToken);
        const { accessToken, ...user } = res.data.data as User & { accessToken: string };
        await signIn(accessToken, user);
        router.replace('/(tabs)');
      } catch (err: any) {
        setToast({
          title: 'Google sign-in failed',
          message: err.response?.data?.message ?? 'Could not complete Google sign-in.',
        });
      } finally {
        setGoogleLoading(false);
      }
    })();
  }, [googleResponse]);

  const handleGoogle = async () => {
    if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
      setToast({
        title: 'Google sign-in unavailable',
        message: 'Google OAuth is not configured for this build.',
      });
      return;
    }
    setGoogleLoading(true);
    const result = await promptGoogle();
    if (result.type !== 'success') {
      setGoogleLoading(false);
    }
  };

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      await authApi.signUp(data.name, data.email, data.password);
      setToast({ title: 'Account created!', message: 'Sign in to get started.', type: 'success' });
      setTimeout(() => router.replace('/(auth)/sign-in'), 1800);
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
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
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

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.googleBtn}
          onPress={handleGoogle}
          disabled={googleLoading}
          activeOpacity={0.85}
        >
          {googleLoading ? (
            <ActivityIndicator size="small" color={Colors.ink} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={Colors.ink} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.terms}>
          By continuing you agree to our{' '}
          <Text style={styles.termsLink}>Terms</Text> &{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>.
        </Text>

        <TouchableOpacity
          style={styles.switchRow}
          onPress={() => router.replace('/(auth)/sign-in')}
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.hairline,
  },
  dividerText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.ink3,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  googleBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
