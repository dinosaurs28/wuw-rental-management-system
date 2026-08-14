import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm, Controller, useController } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import Input from '../../../components/ui/Input';
import Toast from '../../../components/ui/Toast';

const NOW_YEAR = new Date().getFullYear();
const MAX_YEAR = NOW_YEAR - 18;
const MIN_YEAR = 1925;
const ALL_YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => String(MIN_YEAR + i));
const ALL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 48;

const isPlaceholderEmail = (e: string | null | undefined) =>
  !e || /^walkin_.*@temp\.com$/i.test(e);

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  dob: z.string().min(1, 'Date of birth is required').refine((val) => {
    const d = new Date(val);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return d <= cutoff;
  }, 'Customer must be at least 18 years old'),
  addressLine1: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  country: z.string().min(1, 'Country is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  alternatePhone: z
    .string()
    .length(10, 'Must be exactly 10 digits')
    .regex(/^\d+$/, 'Digits only')
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

function WheelPicker({
  data,
  selectedIndex,
  onSelect,
}: {
  data: string[];
  selectedIndex: number;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<FlatList>(null);

  useEffect(() => {
    const idx = Math.max(0, Math.min(selectedIndex, data.length - 1));
    const timer = setTimeout(() => {
      ref.current?.scrollToIndex({ index: idx, animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [selectedIndex, data.length]);

  return (
    <View style={{ flex: 1, height: ITEM_H * 5 }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: ITEM_H * 2,
          left: 4,
          right: 4,
          height: ITEM_H,
          backgroundColor: Colors.bg,
          borderRadius: 10,
        }}
      />
      <FlatList
        ref={ref}
        data={data}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
        renderItem={({ item }) => (
          <View style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 17, color: Colors.ink }}>{item}</Text>
          </View>
        )}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View style={{ height: ITEM_H * 2 }} />}
        ListFooterComponent={<View style={{ height: ITEM_H * 2 }} />}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          onSelect(Math.max(0, Math.min(index, data.length - 1)));
        }}
      />
    </View>
  );
}

function DatePickerField({
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
  const { field } = useController({ control, name });
  const [open, setOpen] = useState(false);

  const parseValue = (v: string) => {
    if (!v) return { yi: MAX_YEAR - 1995, mi: 0, di: 0 };
    const [y, m, d] = v.split('-').map(Number);
    return {
      yi: Math.max(0, Math.min((y || MIN_YEAR) - MIN_YEAR, ALL_YEARS.length - 1)),
      mi: Math.max(0, Math.min((m || 1) - 1, 11)),
      di: Math.max(0, (d || 1) - 1),
    };
  };

  const init = parseValue(field.value);
  const [selYear, setSelYear] = useState(init.yi);
  const [selMonth, setSelMonth] = useState(init.mi);
  const [selDay, setSelDay] = useState(init.di);

  useEffect(() => {
    if (field.value) {
      const { yi, mi, di } = parseValue(field.value);
      setSelYear(yi);
      setSelMonth(mi);
      setSelDay(di);
    }
  }, [field.value]);

  const daysInMonth = new Date(MIN_YEAR + selYear, selMonth + 1, 0).getDate();
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0')),
    [daysInMonth],
  );
  const clampedDay = Math.min(selDay, daysInMonth - 1);

  const confirm = () => {
    const y = MIN_YEAR + selYear;
    const m = selMonth + 1;
    const d = clampedDay + 1;
    field.onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    setOpen(false);
  };

  const displayText = field.value
    ? (() => {
        const d = new Date(field.value + 'T00:00:00');
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      })()
    : null;

  return (
    <View style={dp.wrapper}>
      <Text style={dp.label}>{label}</Text>
      <TouchableOpacity
        style={[dp.btn, error && dp.btnError]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <Text style={[dp.btnText, !displayText && dp.placeholder]}>
          {displayText ?? 'Select date of birth'}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={Colors.ink3} />
      </TouchableOpacity>
      {error ? <Text style={dp.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />
          <View style={dp.sheet}>
            <View style={dp.sheetHeader}>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={dp.cancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={dp.sheetTitle}>Date of birth</Text>
              <TouchableOpacity onPress={confirm} hitSlop={12}>
                <Text style={dp.done}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={dp.colLabels}>
              <Text style={[dp.colLabel, { flex: 1 }]}>Day</Text>
              <Text style={[dp.colLabel, { flex: 1 }]}>Month</Text>
              <Text style={[dp.colLabel, { flex: 1 }]}>Year</Text>
            </View>
            <View style={dp.wheels}>
              <WheelPicker key={daysInMonth} data={days} selectedIndex={clampedDay} onSelect={setSelDay} />
              <WheelPicker data={ALL_MONTHS} selectedIndex={selMonth} onSelect={setSelMonth} />
              <WheelPicker data={ALL_YEARS} selectedIndex={selYear} onSelect={setSelYear} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

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

interface CustomerDetail {
  name: string;
  email: string;
  phone: string | null;
  dob: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  alternatePhone?: string | null;
  isProfileCompleted: boolean;
}

export default function WalkinProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customerPublicId, phone, next } = useLocalSearchParams<{
    customerPublicId: string;
    phone?: string;
    next?: string;
  }>();

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);

  const { data: existing, isLoading } = useQuery<CustomerDetail | null>({
    queryKey: ['employee', 'walkin', 'customer', customerPublicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomer(customerPublicId as string);
      return (res.data?.data ?? null) as CustomerDetail | null;
    },
    enabled: !!customerPublicId,
    staleTime: 0,
    retry: false,
  });

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: existing
      ? {
          name: existing.name && existing.name !== 'Walk-in Customer' ? existing.name : '',
          email: isPlaceholderEmail(existing.email) ? '' : existing.email,
          dob: existing.dob ? existing.dob.split('T')[0] : '',
          addressLine1: existing.addressLine1 ?? '',
          city: existing.city ?? '',
          state: existing.state ?? '',
          country: existing.country || 'India',
          zipCode: existing.zipCode ?? '',
          alternatePhone: existing.alternatePhone ?? '',
        }
      : undefined,
  });

  const onSubmit = async (data: FormData) => {
    if (!customerPublicId) return;
    setSubmitting(true);
    try {
      await employeeApi.walkinComplete({
        customer_public_id: customerPublicId as string,
        name: data.name,
        email: data.email,
        dob: data.dob,
        addressLine1: data.addressLine1,
        city: data.city,
        state: data.state,
        country: data.country,
        zipCode: data.zipCode,
        alternatePhone: data.alternatePhone || undefined,
      });
      router.replace({
        pathname: '/employee/walkin/kyc/[publicId]',
        params: {
          publicId: customerPublicId as string,
          ...(next ? { next } : {}),
        },
      } as any);
    } catch (err: any) {
      setToast({
        title: 'Could not save profile',
        message: err.response?.data?.message ?? 'Something went wrong.',
        type: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

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
        <Text style={styles.headerTitle}>Customer Details</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {phone ? (
            <View style={styles.phoneStrip}>
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <Text style={styles.phoneStripText}>+91 {phone} verified</Text>
            </View>
          ) : null}

          <Text style={styles.section}>Basic Info</Text>
          <View style={styles.card}>
            <Input
              control={control}
              name="name"
              label="Full name"
              placeholder="Jane Smith"
              autoCapitalize="words"
              error={errors.name?.message}
            />
            <Input
              control={control}
              name="email"
              label="Email"
              placeholder="jane@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              error={errors.email?.message}
            />
            <PhoneInput
              control={control}
              name="alternatePhone"
              label="Alternate phone (optional)"
              error={errors.alternatePhone?.message}
            />
            <DatePickerField
              control={control}
              name="dob"
              label="Date of birth"
              error={errors.dob?.message}
            />
          </View>

          <Text style={styles.section}>Address</Text>
          <View style={styles.card}>
            <Input
              control={control}
              name="addressLine1"
              label="Address"
              placeholder="123 Main Street"
              error={errors.addressLine1?.message}
            />
            <Input
              control={control}
              name="city"
              label="City"
              placeholder="Bengaluru"
              error={errors.city?.message}
            />
            <Input
              control={control}
              name="state"
              label="State"
              placeholder="Karnataka"
              error={errors.state?.message}
            />
            <Input
              control={control}
              name="country"
              label="Country"
              placeholder="India"
              error={errors.country?.message}
            />
            <Input
              control={control}
              name="zipCode"
              label="ZIP / PIN code"
              placeholder="560001"
              keyboardType="number-pad"
              error={errors.zipCode?.message}
            />
          </View>

          <TouchableOpacity
            style={[styles.cta, submitting && styles.ctaBusy]}
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.ctaText}>Continue to KYC</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

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
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  phoneStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  phoneStripText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#065f46' },
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
  cta: {
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
  ctaBusy: { opacity: 0.7 },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

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

const dp = StyleSheet.create({
  wrapper: { gap: 6 },
  label: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, letterSpacing: 0.2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
  },
  btnError: { borderColor: '#e53e3e' },
  btnText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink },
  placeholder: { color: Colors.ink4 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  sheetTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  cancel: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },
  done: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.orange },
  colLabels: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  colLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  wheels: { flexDirection: 'row', paddingHorizontal: 12, gap: 4 },
});
