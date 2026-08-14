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
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Toast from '../../components/ui/Toast';
import type { User } from '../../types/api';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function EmployeeSignIn() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const insets = useSafeAreaInsets();
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
      const res = await employeeApi.login(data.email, data.password);
      const { token, user } = res.data as { token: string; user: User };
      await signIn(token, user);
      router.replace('/(employee)/dashboard');
    } catch (err: any) {
      const serverMsg = err.response?.data?.message;
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
      const isNetwork = !err.response && (err.code === 'ECONNREFUSED' || err.message?.includes('Network'));
      const msg = serverMsg
        ?? (isTimeout
          ? 'Server is taking too long to respond. Try again in a moment.'
          : isNetwork
          ? 'Cannot reach the server. Check your internet and try again.'
          : 'Invalid credentials. Please try again.');
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
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>

          {/* Badge */}
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark-outline" size={14} color={Colors.orange} />
            <Text style={styles.badgeText}>Staff Portal</Text>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>
              Employee{'\n'}
              <Text style={styles.titleAccent}>login.</Text>
            </Text>
            <Text style={styles.subtitle}>Sign in with your employee credentials.</Text>
          </View>

          <View style={styles.form}>
            <Input
              control={control}
              name="email"
              label="Work Email"
              placeholder="you@company.com"
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
          </View>

          <Button
            title="Sign in to Portal"
            onPress={handleSubmit(onSubmit)}
            loading={loading}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  inner: { paddingHorizontal: 24, flexGrow: 1 },
  back: { marginBottom: 28, width: 36, height: 36, justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,106,31,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,31,0.25)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  badgeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.orange,
    letterSpacing: 0.4,
  },
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
});
