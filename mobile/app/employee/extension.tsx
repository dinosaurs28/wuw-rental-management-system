import { useState } from 'react';
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
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

type Phase = 'select' | 'evaluated' | 'collect' | 'done';

const inr = (v: number) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PRESETS = [1, 2, 3, 7]; // extra days

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function ExtensionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bookingId, endAt, make, model } = useLocalSearchParams<{
    bookingId: string; endAt: string; make?: string; model?: string;
  }>();

  const [phase, setPhase] = useState<Phase>('select');
  const [extraDays, setExtraDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // evaluate result
  const [extensionPublicId, setExtensionPublicId] = useState<string | null>(null);
  const [additionalAmount, setAdditionalAmount] = useState(0);
  const [newEndAt, setNewEndAt] = useState<string | null>(null);

  // collect
  const [method, setMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [onlineRef, setOnlineRef] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const baseEnd = endAt ? new Date(endAt) : null;
  const computedNewEnd = baseEnd ? new Date(baseEnd.getTime() + extraDays * 86_400_000) : null;

  const evaluate = async () => {
    if (!bookingId || !computedNewEnd) return;
    setBusy(true); setError(null);
    try {
      const res = await employeeApi.evaluateExtension({
        bookingPublicId: bookingId,
        newEndAt: computedNewEnd.toISOString(),
      });
      const d = res.data?.data;
      setExtensionPublicId(d?.extensionPublicId ?? null);
      setAdditionalAmount(Number(d?.pricing?.additionalAmount ?? 0));
      setNewEndAt(d?.requestedEndAt ?? computedNewEnd.toISOString());
      setPhase('evaluated');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not evaluate the extension.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!extensionPublicId) return;
    setBusy(true); setError(null);
    try {
      const res = await employeeApi.commitExtension({
        extensionPublicId,
        resolutionType: 'SAME_VEHICLE',
        idempotencyKey: `ext-${bookingId}-${extensionPublicId}`,
      });
      const d = res.data?.data;
      // Deferred-session branches add the charge to the pickup session — skip collect.
      if (d?.usePaymentSession) {
        setDoneMsg('Extension committed. The additional charge was added to the pickup payment session.');
        setPhase('done');
      } else {
        setPhase('collect');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not commit the extension.');
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    if (!extensionPublicId) return;
    if (method === 'ONLINE' && !onlineRef.trim()) {
      setError('Enter the online payment reference.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const res = await employeeApi.collectExtension(extensionPublicId, {
        method,
        ...(method === 'ONLINE' ? { onlineTransactionRef: onlineRef.trim() } : {}),
      });
      const payment = res.data?.data?.payment;
      setDoneMsg(
        payment === 'confirmed'
          ? 'Payment confirmed and the extension is finalised.'
          : 'Cash recorded. The extension awaits manager confirmation.',
      );
      setPhase('done');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not collect the extension payment.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'done') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Extension done</Text>
          <Text style={styles.successSub}>{doneMsg}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Extend Booking</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {(make || model) && <Text style={styles.vehicle}>{make} {model}</Text>}

        {baseEnd && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Current return</Text>
              <Text style={styles.value}>{fmt(baseEnd.toISOString())}</Text>
            </View>
            {computedNewEnd && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>New return</Text>
                  <Text style={[styles.value, { color: Colors.orange }]}>{fmt(computedNewEnd.toISOString())}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {phase === 'select' && (
          <>
            <Text style={styles.sectionLabel}>Extend by</Text>
            <View style={styles.presetRow}>
              {PRESETS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.preset, extraDays === d && styles.presetActive]}
                  onPress={() => setExtraDays(d)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.presetText, extraDays === d && styles.presetTextActive]}>
                    +{d}d
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {phase !== 'select' && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Additional amount</Text>
              <Text style={styles.amount}>{inr(additionalAmount)}</Text>
            </View>
          </View>
        )}

        {phase === 'collect' && additionalAmount > 0 && (
          <>
            <Text style={styles.sectionLabel}>Collect payment</Text>
            <View style={styles.card}>
              <View style={styles.methodRow}>
                {(['CASH', 'ONLINE'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.methodBtn, method === m && styles.methodBtnActive]}
                    onPress={() => setMethod(m)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                      {m === 'CASH' ? 'Cash' : 'Online'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {method === 'ONLINE' && (
                <TextInput
                  style={styles.input}
                  value={onlineRef}
                  onChangeText={setOnlineRef}
                  placeholder="Online transaction reference"
                  placeholderTextColor={Colors.ink4}
                />
              )}
            </View>
          </>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {phase === 'select' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={evaluate} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Evaluate</Text>}
          </TouchableOpacity>
        )}
        {phase === 'evaluated' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={commit} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Confirm extension</Text>}
          </TouchableOpacity>
        )}
        {phase === 'collect' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={collect} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : (
              <Text style={styles.primaryBtnText}>{additionalAmount > 0 ? `Collect ${inr(additionalAmount)}` : 'Complete'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  content: { paddingHorizontal: 20, gap: 12, paddingBottom: 40 },
  vehicle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  value: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  amount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  presetRow: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  presetActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  presetText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  presetTextActive: { color: Colors.white },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },
  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.ink, marginTop: 10,
  },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30' },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, backgroundColor: Colors.bg },
  primaryBtn: { backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#10b98115', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8 },
  successSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
});
