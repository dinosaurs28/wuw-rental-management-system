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
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Toast from '../components/ui/Toast';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Colors, Fonts } from '../constants/colors';
import { userApi } from '../lib/api';
import { useAuthStore } from '../store/auth';

// Permanent account deletion. Google Play requires an in-app deletion path for
// any app offering in-app account creation, alongside the public web form at
// whatuwantrentals.com/legal/delete-account.
//
// The backend anonymises rather than drops rows: bookings and invoices are
// legally-required financial records and are retained, detached from the
// person. This screen states that plainly so the disclosure matches reality.
//
// The password is optional here because the client is not told which auth
// provider the account uses — Google-linked accounts have no password. If one
// is required and omitted, the backend replies 400 and the toast says so.

const CONFIRM_WORD = 'DELETE';

const schema = z.object({
  password: z.string().optional(),
  confirmText: z
    .string()
    .trim()
    .refine((v) => v.toUpperCase() === CONFIRM_WORD, {
      message: `Type ${CONFIRM_WORD} exactly to confirm`,
    }),
});
type Form = z.infer<typeof schema>;

const DELETED = [
  'Your name, email address and phone number',
  'Your address and date of birth',
  'All KYC documents, including your driving licence scans',
  'Your saved sign-in details',
];

export default function DeleteAccount() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<
    { title: string; message?: string; type?: 'error' | 'success' } | null
  >(null);

  const { control, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmText: '' },
    mode: 'onChange',
  });

  const confirmValue = useWatch({ control, name: 'confirmText' });
  const armed = (confirmValue ?? '').trim().toUpperCase() === CONFIRM_WORD;

  const onDelete = async (data: Form) => {
    setLoading(true);
    try {
      await userApi.deleteAccount(
        CONFIRM_WORD,
        data.password ? data.password : undefined,
      );

      // The account is gone — drop the local session and return to the entry
      // screen. signOut() clears the SecureStore token.
      await signOut();
      router.replace('/welcome');
    } catch (err: any) {
      const status = err.response?.status;
      const message =
        err.response?.data?.message ??
        (err.message?.includes('Network')
          ? 'Cannot reach server. Check your connection.'
          : 'Something went wrong. Please try again.');

      setToast({
        title:
          status === 409
            ? 'Active booking'
            : status === 401
              ? 'Incorrect password'
              : 'Could not delete account',
        message,
        type: 'error',
      });
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.back}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>

          <Text style={styles.title}>Delete account</Text>
          <Text style={styles.subtitle}>
            This is permanent and cannot be undone.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardHeading}>What gets deleted</Text>
            {DELETED.map((line) => (
              <View key={line} style={styles.bullet}>
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={Colors.availNone}
                />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardHeading}>What we must keep</Text>
            <View style={styles.bullet}>
              <Ionicons
                name="information-circle"
                size={16}
                color={Colors.ink3}
              />
              <Text style={styles.bulletText}>
                Past booking, invoice and payment records are retained as
                required by tax and accounting law. They are no longer linked to
                your personal details.
              </Text>
            </View>
          </View>

          <Text style={styles.note}>
            If you have an active or upcoming booking, complete or cancel it
            first — the account cannot be deleted while a rental is open.
          </Text>

          <Input
            control={control}
            name="password"
            label="Your password"
            placeholder="Leave blank if you signed in with Google"
            secureTextEntry
            autoCapitalize="none"
            error={formState.errors.password?.message}
          />

          <Input
            control={control}
            name="confirmText"
            label={`Type ${CONFIRM_WORD} to confirm`}
            placeholder={CONFIRM_WORD}
            autoCapitalize="characters"
            autoCorrect={false}
            error={formState.errors.confirmText?.message}
          />

          <Button
            title="Delete my account permanently"
            onPress={handleSubmit(onDelete)}
            loading={loading}
            disabled={!armed || loading}
            style={styles.deleteBtn}
          />

          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>Keep my account</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast
        visible={!!toast}
        title={toast?.title ?? ''}
        message={toast?.message}
        type={toast?.type ?? 'error'}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { paddingHorizontal: 24 },
  back: { width: 40, height: 40, justifyContent: 'center' },
  title: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.ink,
    marginTop: 12,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginTop: 6,
    marginBottom: 22,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  cardHeading: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    marginBottom: 10,
  },
  bullet: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bulletText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink2,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink3,
    marginBottom: 20,
  },
  deleteBtn: { backgroundColor: Colors.availNone, marginTop: 8 },
  cancel: { alignItems: 'center', paddingVertical: 16 },
  cancelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
});
