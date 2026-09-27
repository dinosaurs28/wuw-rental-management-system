import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  handleShiftRequired,
  isValidUtr,
  promptOpenShift,
} from '../../lib/counterErrors';
import UtrInput from '../../components/employee/UtrInput';

// Opened from the pickup screen (CONFIRMED booking) and the drop screen
// (PICKED_UP — car already out). Either way the extra charge is collected
// right here: commit always sends collectNow, then collect runs immediately.
type Phase = 'select' | 'review' | 'done';
type Method = 'CASH' | 'UPI';

const inr = (v: number) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PRESETS = [1, 2, 3, 7]; // extra days

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function ExtensionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { bookingId, endAt, make, model } = useLocalSearchParams<{
    bookingId: string; endAt: string; make?: string; model?: string;
  }>();

  const [phase, setPhase] = useState<Phase>('select');
  const [extraDays, setExtraDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // evaluate result — the extension is PENDING_PAYMENT server-side from here on
  const [extensionPublicId, setExtensionPublicId] = useState<string | null>(null);
  const [additionalAmount, setAdditionalAmount] = useState(0);
  const [newEndAt, setNewEndAt] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);

  // collect
  const [method, setMethod] = useState<Method>('CASH');
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState<string | undefined>();
  const [doneMsg, setDoneMsg] = useState('');

  // The booking's current return. Refreshed after cancelling a pending
  // extension, whose commit had already moved it.
  const [currentEnd, setCurrentEnd] = useState<string | null>(endAt ?? null);
  const baseEnd = currentEnd ? new Date(currentEnd) : null;
  const extendFrom = (base: Date) => new Date(base.getTime() + extraDays * 86_400_000);
  const computedNewEnd = baseEnd ? extendFrom(baseEnd) : null;
  const shownNewEnd = newEndAt ?? computedNewEnd?.toISOString() ?? null;

  // An evaluated/committed extension blocks any new one until it is paid or
  // cancelled, so leaving mid-way offers to cancel it instead of stranding it.
  const unpaid = !!extensionPublicId && phase !== 'done';
  usePreventRemove(unpaid, ({ data }) => {
    Alert.alert(
      'Cancel this extension?',
      `It hasn't been paid yet. Cancelling keeps the current return time${baseEnd ? ` (${fmt(baseEnd.toISOString())})` : ''}.`,
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Cancel extension',
          style: 'destructive',
          onPress: async () => {
            try {
              await employeeApi.cancelExtension(extensionPublicId!, 'Cancelled at the counter before payment');
              navigation.dispatch(data.action);
            } catch (err: any) {
              Alert.alert('Could not cancel', apiErrorMessage(err, 'Please try again.'));
            }
          },
        },
      ],
    );
  });

  const evaluate = async (baseIso: string | null = currentEnd) => {
    if (!bookingId || !baseIso) return;
    const requestedEnd = extendFrom(new Date(baseIso));
    setBusy(true); setError(null);
    try {
      // Collecting needs an open cash shift. Check before evaluate creates the
      // pending extension, so staff aren't left holding one they can't collect.
      try {
        const shift = await employeeApi.getActiveShift();
        if (!shift.data?.data) {
          promptOpenShift();
          return;
        }
      } catch { /* can't tell — the server still enforces it at collect */ }

      const res = await employeeApi.evaluateExtension({
        bookingPublicId: bookingId,
        newEndAt: requestedEnd.toISOString(),
      });
      const d = res.data?.data;
      setExtensionPublicId(d?.extensionPublicId ?? null);
      setAdditionalAmount(Number(d?.pricing?.additionalAmount ?? 0));
      setNewEndAt(d?.requestedEndAt ?? requestedEnd.toISOString());
      setPhase('review');
    } catch (err: any) {
      const message = apiErrorMessage(err, 'Could not evaluate the extension.');
      setError(message);
      // An earlier extension was committed but never paid and blocks new ones.
      // Cash already collected (PAYMENT_COLLECTED) is for a manager to confirm
      // or reject — only an unpaid one may be cancelled here.
      const pending = err?.response?.data;
      const pendingId: string | undefined = pending?.pendingExtensionPublicId;
      if (
        pending?.code === 'EXTENSION_PENDING' &&
        pending?.pendingExtensionStatus === 'PENDING_PAYMENT' &&
        pendingId
      ) {
        Alert.alert('Unpaid extension pending', message, [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel the pending extension',
            style: 'destructive',
            onPress: async () => {
              setBusy(true); setError(null);
              try {
                await employeeApi.cancelExtension(pendingId, 'Unpaid extension replaced at the counter');
              } catch (cancelErr: any) {
                setError(apiErrorMessage(cancelErr, 'Could not cancel the pending extension.'));
                setBusy(false);
                return;
              }
              // Cancelling restored the booking's previous return time.
              let base = currentEnd;
              try {
                const fresh: string | undefined = (await employeeApi.getPickupDetails(bookingId)).data?.data?.endAt;
                if (fresh) { base = fresh; setCurrentEnd(fresh); }
              } catch { /* keep the known return time */ }
              await evaluate(base);
            },
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  // Back to the presets: the quote is released so a new one can be evaluated.
  const changeDuration = async () => {
    if (!extensionPublicId || committed) return;
    setBusy(true); setError(null);
    try {
      await employeeApi.cancelExtension(extensionPublicId, 'Duration changed at the counter');
      setExtensionPublicId(null);
      setNewEndAt(null);
      setAdditionalAmount(0);
      setUtrError(undefined);
      setPhase('select');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not change the extension.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmAndCollect = async () => {
    if (!extensionPublicId) return;
    const upi = additionalAmount > 0 && method === 'UPI';
    if (upi && !isValidUtr(utr)) {
      setUtrError("Enter the 12-digit UTR from the customer's UPI app.");
      return;
    }
    setBusy(true); setError(null); setUtrError(undefined);
    try {
      if (!committed) {
        const res = await employeeApi.commitExtension({
          extensionPublicId,
          resolutionType: 'SAME_VEHICLE',
          idempotencyKey: `ext-${bookingId}-${extensionPublicId}`,
          collectNow: true,
        });
        setCommitted(true);
        const committedAmount = Number(res.data?.data?.additionalAmount ?? additionalAmount);
        if (Math.abs(committedAmount - additionalAmount) >= 0.01) {
          // Never collect a different amount from the one on screen.
          setAdditionalAmount(committedAmount);
          setError(`The extension price changed to ${inr(committedAmount)}. Confirm it with the customer, then collect.`);
          return;
        }
      }

      const res = await employeeApi.collectExtension(extensionPublicId, {
        method: upi ? 'ONLINE' : 'CASH',
        ...(upi ? { onlineTransactionRef: cleanUtr(utr) } : {}),
      });
      const payment = res.data?.data?.payment;
      setDoneMsg(
        payment === 'confirmed'
          ? 'UPI payment recorded and the extension is confirmed.'
          : additionalAmount > 0
            ? 'Cash recorded. The extension is final once a manager confirms the cash.'
            : 'The extension awaits manager confirmation.',
      );
      setPhase('done');
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      const code = counterErrorCode(err);
      if (code === 'INVALID_UTR' || code === 'DUPLICATE_UTR') {
        setUtrError(apiErrorMessage(err, 'Check the UTR number.'));
      } else {
        setError(apiErrorMessage(err, committed ? 'Could not collect the extension payment.' : 'Could not confirm the extension.'));
      }
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
          {shownNewEnd && (
            <View style={styles.newEndPill}>
              <Ionicons name="calendar-outline" size={14} color={Colors.orange} />
              <Text style={styles.newEndPillText}>New return · {fmt(shownNewEnd)}</Text>
            </View>
          )}
          <Text style={styles.successSub}>{doneMsg}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.successBtn]} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const collectLabel = additionalAmount > 0
    ? `${committed ? 'Collect' : 'Confirm & collect'} ${inr(additionalAmount)}${method === 'UPI' ? ' via UPI' : ' cash'}`
    : 'Confirm extension';

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8} disabled={busy}>
          <Ionicons name="arrow-back" size={22} color={busy ? Colors.ink4 : Colors.ink} />
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
            {shownNewEnd && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>New return</Text>
                  <Text style={[styles.value, styles.newEnd]}>{fmt(shownNewEnd)}</Text>
                </View>
                <Text style={styles.extendNote}>+{extraDays} day{extraDays !== 1 ? 's' : ''}, same return time</Text>
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

        {phase === 'review' && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Additional amount</Text>
              <Text style={styles.amount}>{inr(additionalAmount)}</Text>
            </View>
            {!committed && (
              <TouchableOpacity onPress={changeDuration} disabled={busy} hitSlop={8} style={styles.changeLink}>
                <Text style={styles.changeLinkText}>Change duration</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {phase === 'review' && additionalAmount > 0 && (
          <>
            <Text style={styles.sectionLabel}>Collect payment</Text>
            <View style={styles.card}>
              <View style={styles.methodRow}>
                {(['CASH', 'UPI'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.methodBtn, method === m && styles.methodBtnActive]}
                    onPress={() => { setMethod(m); setError(null); }}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={m === 'CASH' ? 'wallet-outline' : 'keypad-outline'}
                      size={16}
                      color={method === m ? Colors.white : Colors.ink3}
                    />
                    <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                      {m === 'CASH' ? 'Cash' : 'UPI (UTR)'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {method === 'UPI' && (
                <>
                  <Text style={styles.upiHint}>
                    Ask the customer to pay {inr(additionalAmount)} to the shop's UPI QR, then enter the UTR.
                  </Text>
                  <UtrInput
                    value={utr}
                    onChangeText={(t) => { setUtr(t); setUtrError(undefined); }}
                    error={utrError}
                  />
                </>
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
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => evaluate()} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Check price</Text>}
          </TouchableOpacity>
        )}
        {phase === 'review' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={confirmAndCollect} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>{collectLabel}</Text>}
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  value: { flexShrink: 1, textAlign: 'right', fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  newEnd: { fontSize: 15, color: Colors.orange },
  extendNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 6, textAlign: 'right' },
  amount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  changeLink: { alignSelf: 'flex-start', marginTop: 10 },
  changeLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  presetRow: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  presetActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  presetText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  presetTextActive: { color: Colors.white },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },
  upiHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19, marginTop: 12 },
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
  successBtn: { alignSelf: 'stretch' },
  newEndPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orangeSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  newEndPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
});
