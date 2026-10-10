import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeCustomersApi } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/counterErrors';
import {
  BLACKLIST_REASON_MAX,
  BLACKLIST_REASON_MIN,
  type BlacklistResult,
} from '../../../types/customers';

type Mode = 'blacklist' | 'remove';

interface Props {
  visible: boolean;
  mode: Mode;
  customerId: string;
  customerName: string;
  onClose: () => void;
  /** Done: the server's message, and for a blacklist its result (open rents). */
  onDone: (message: string, result?: BlacklistResult) => void;
  /** 409: someone else changed the blacklist meanwhile — reload the customer. */
  onStale: (message: string) => void;
}

// Blacklist (reason required) or remove the blacklist (optional note) — the
// same rules and audit trail as the branch manager's Customers tab. The sheet
// is the confirmation step: nothing changes until its red / orange button.
export function BlacklistSheet({ visible, mode, customerId, customerName, onClose, onDone, onStale }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setError(null);
  }, [visible]);

  const isBlacklist = mode === 'blacklist';
  const len = text.trim().length;
  const valid = isBlacklist ? len >= BLACKLIST_REASON_MIN && len <= BLACKLIST_REASON_MAX : len <= BLACKLIST_REASON_MAX;

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = text.trim();
      if (isBlacklist) {
        const res = await employeeCustomersApi.blacklist(customerId, trimmed);
        onDone(res.data.message || 'Customer blacklisted.', res.data.data);
      } else {
        const res = await employeeCustomersApi.unblacklist(customerId, trimmed || undefined);
        onDone(res.data.message || 'Blacklist removed.');
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const message = apiErrorMessage(
        err,
        isBlacklist ? 'Could not blacklist this customer.' : 'Could not remove the blacklist.',
      );
      if (code === 'CUSTOMER_ALREADY_BLACKLISTED' || code === 'CUSTOMER_NOT_BLACKLISTED') onStale(message);
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.kav, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {isBlacklist ? `Blacklist ${customerName}` : 'Remove the blacklist?'}
              </Text>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.ink} />
              </TouchableOpacity>
            </View>

            <Text style={styles.body}>
              {isBlacklist
                ? "They won't be able to make new bookings at any branch. Existing bookings are not cancelled. A reason is required and is recorded in the audit log."
                : `${customerName} will be able to book again. This is recorded in the audit log.`}
            </Text>

            <Text style={styles.sectionLabel}>{isBlacklist ? 'Reason' : 'Note (optional)'}</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(t) => {
                setText(t.slice(0, BLACKLIST_REASON_MAX));
                setError(null);
              }}
              placeholder={isBlacklist ? `Reason (${BLACKLIST_REASON_MIN}–${BLACKLIST_REASON_MAX} characters)` : 'Note (optional)'}
              placeholderTextColor={Colors.ink4}
              multiline
              maxLength={BLACKLIST_REASON_MAX}
              editable={!submitting}
            />
            <Text style={styles.counter}>
              {len}/{BLACKLIST_REASON_MAX}
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={close} disabled={submitting} activeOpacity={0.85}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  isBlacklist ? styles.confirmDanger : styles.confirmOrange,
                  (!valid || submitting) && styles.confirmDisabled,
                ]}
                onPress={submit}
                disabled={!valid || submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.confirmText}>{isBlacklist ? 'Blacklist customer' : 'Remove blacklist'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, gap: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.ink2, lineHeight: 19 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 4,
  },
  input: {
    minHeight: 96, textAlignVertical: 'top', fontFamily: Fonts.body, fontSize: 14, color: Colors.ink,
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.body, fontSize: 11.5, color: Colors.ink4, marginTop: -4 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.availNoneSoft, borderRadius: 12, padding: 12,
  },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.bg,
  },
  cancelText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  confirmBtn: { flex: 1.4, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14 },
  confirmDanger: { backgroundColor: Colors.availNone },
  confirmOrange: { backgroundColor: Colors.orange },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
