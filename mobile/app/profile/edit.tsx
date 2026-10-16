import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import Input from '../../components/ui/Input';
import Toast from '../../components/ui/Toast';
import { ageInputSchema, formatAgeInput, joinProfileFieldLabels } from '../../lib/identity';

// ─── Zod schema ──────────────────────────────────────────────────────────────
const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().length(10, 'Must be exactly 10 digits').regex(/^\d+$/, 'Digits only'),
  // Replaces the date of birth (Oct 2026): whole years, 18–99, sent as a number.
  age: ageInputSchema,
  addressLine1: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  country: z.string().min(1, 'Country is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  alternatePhone: z.string().length(10, 'Must be exactly 10 digits').regex(/^\d+$/, 'Digits only').optional().or(z.literal('')),
  // No DL / Aadhaar numbers since Oct 2026 — staff take the DL number at pickup.
});

type FormData = z.infer<typeof schema>;
type FormField = keyof FormData;
const FORM_FIELDS: readonly string[] = Object.keys(schema.shape);

// ─── PhoneInput ───────────────────────────────────────────────────────────────
function PhoneInput({
  control,
  name,
  label,
  error,
}: {
  control: any;
  name: any;
  label: string;
  error?: string;
}) {
  return (
    <View style={ph.wrapper}>
      <Text style={ph.label}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={[ph.row, error && ph.rowError]}>
            <View style={ph.prefix}>
              <Text style={ph.prefixText}>+91</Text>
            </View>
            <View style={ph.sep} />
            <TextInput
              style={ph.input}
              onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 10))}
              onBlur={onBlur}
              value={value}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="10-digit number"
              placeholderTextColor={Colors.ink4}
            />
          </View>
        )}
      />
      {error ? <Text style={ph.error}>{error}</Text> : null}
    </View>
  );
}

// ─── EditProfile screen ───────────────────────────────────────────────────────
export default function EditProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data as import('../../types/api').UserProfile,
  });

  const { control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: profile ? {
      name: profile.name ?? user?.name ?? '',
      phone: profile.phone ?? '',
      age: profile.age != null ? String(profile.age) : '',
      addressLine1: profile.addressLine1 ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      country: profile.country ?? 'India',
      zipCode: profile.zipCode ?? '',
      alternatePhone: profile.alternatePhone ?? '',
    } : undefined,
  });

  // Fields the server still needs before this customer can book (#1).
  const missingText = joinProfileFieldLabels(profile?.missingFields ?? []);

  const mutation = useMutation({
    // The age goes as a number; stored DL / Aadhaar numbers and dob are kept.
    mutationFn: (data: FormData) => userApi.updateProfile({ ...data, age: Number(data.age) } as any),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      updateUser({ name: variables.name });
      setToast({ title: 'Profile updated', type: 'success' });
      setTimeout(() => router.back(), 1200);
    },
    onError: (err: any) => {
      // 400 VALIDATION_ERROR: put each issue under its input (path[0] = field).
      const issues: any[] = Array.isArray(err.response?.data?.errors) ? err.response.data.errors : [];
      for (const issue of issues) {
        const field = issue?.path?.[0];
        if (typeof field === 'string' && FORM_FIELDS.includes(field) && issue?.message) {
          setError(field as FormField, { type: 'server', message: String(issue.message) });
        }
      }
      setToast({
        title: 'Update failed',
        message: err.response?.data?.message ?? 'Something went wrong.',
        type: 'error',
      });
    },
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Toast visible={!!toast} title={toast?.title ?? ''} message={toast?.message} type={toast?.type ?? 'error'} onDismiss={() => setToast(null)} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {missingText ? (
            <View style={styles.missingBanner}>
              <Ionicons name="alert-circle-outline" size={18} color="#d97706" />
              <Text style={styles.missingText}>To book a vehicle, add your {missingText}.</Text>
            </View>
          ) : null}

          <Text style={styles.section}>Basic Info</Text>
          <View style={styles.card}>
            <Input control={control} name="name" label="Full name" placeholder="Jane Smith" autoCapitalize="words" error={errors.name?.message} />
            <PhoneInput control={control} name="phone" label="Phone" error={errors.phone?.message} />
            <PhoneInput control={control} name="alternatePhone" label="Alternate phone (optional)" error={errors.alternatePhone?.message} />
            <Controller
              control={control}
              name="age"
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={ph.wrapper}>
                  <Text style={ph.label}>Age *</Text>
                  <View style={[ph.row, errors.age && ph.rowError]}>
                    <TextInput
                      style={ph.input}
                      onChangeText={(t) => onChange(formatAgeInput(t))}
                      onBlur={onBlur}
                      value={value}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="25"
                      placeholderTextColor={Colors.ink4}
                    />
                  </View>
                  {errors.age?.message ? <Text style={ph.error}>{errors.age.message}</Text> : null}
                </View>
              )}
            />
          </View>

          <Text style={styles.section}>Address</Text>
          <View style={styles.card}>
            <Input control={control} name="addressLine1" label="Address" placeholder="123 Main Street" error={errors.addressLine1?.message} />
            <Input control={control} name="city" label="City" placeholder="Bengaluru" error={errors.city?.message} />
            <Input control={control} name="state" label="State" placeholder="Karnataka" error={errors.state?.message} />
            <Input control={control} name="country" label="Country" placeholder="India" error={errors.country?.message} />
            <Input control={control} name="zipCode" label="ZIP / PIN code" placeholder="560001" keyboardType="number-pad" error={errors.zipCode?.message} />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!isDirty || mutation.isPending) && styles.saveBtnDisabled]}
            onPress={handleSubmit((data) => mutation.mutate(data))}
            disabled={!isDirty || mutation.isPending}
            activeOpacity={0.85}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Stylesheets ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
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
  section: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 20,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 14,
  },
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 14,
    padding: 12,
  },
  missingText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#92400e', lineHeight: 18 },
  saveBtn: {
    marginTop: 28,
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
  saveBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  saveBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

// Phone input styles
const ph = StyleSheet.create({
  wrapper: { gap: 6 },
  label: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, letterSpacing: 0.2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  rowError: { borderColor: '#e53e3e' },
  prefix: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: Colors.bg,
  },
  prefixText: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.ink2 },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.hairline },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  error: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },
});
