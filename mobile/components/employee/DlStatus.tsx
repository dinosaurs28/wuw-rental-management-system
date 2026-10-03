import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { apiErrorMessage } from '../../lib/counterErrors';
import { fmtIstDateTime } from '../../lib/dates';
import {
  DL_SELECTABLE_STATUSES,
  DL_STATUS_LABELS,
  canEditDlStatus,
  dlChoiceBody,
  dlChoiceProblem,
  dlStatusLabel,
  type DlCollectionStatus,
  type DlStatusFields,
  type UpdateDlStatusResult,
} from '../../lib/dlStatus';

// Original driving licence status (#3): the pickup selector, the badge for
// queue rows, and the detail card with its "Change" action.

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const OPTION_HINTS: Record<DlCollectionStatus, { icon: IoniconName; hint: string }> = {
  COLLECTED: { icon: 'id-card-outline', hint: "The branch keeps the customer's original licence until the car is back." },
  NOT_COLLECTED: { icon: 'person-outline', hint: 'The customer keeps their licence.' },
  DEPOSIT: { icon: 'wallet-outline', hint: 'Legacy record: the customer left something else instead.' },
};

const LOOK: Record<DlCollectionStatus | 'NONE', { fg: string; bg: string; icon: IoniconName }> = {
  COLLECTED: { fg: Colors.availGood, bg: Colors.availGoodSoft, icon: 'checkmark-circle' },
  DEPOSIT: { fg: Colors.availLow, bg: Colors.availLowSoft, icon: 'wallet' },
  NOT_COLLECTED: { fg: Colors.ink2, bg: '#0a0a0a0d', icon: 'remove-circle-outline' },
  NONE: { fg: Colors.ink3, bg: '#0a0a0a0d', icon: 'help-circle-outline' },
};

// ── Selector ───────────────────────────────────────────────────────────────

interface SelectorProps {
  value: DlCollectionStatus | null;
  onChange: (value: DlCollectionStatus) => void;
  disabled?: boolean;
}

/** Two-option choice (Collected / Not collected); nothing pre-selected. */
export function DlStatusSelector({ value, onChange, disabled }: SelectorProps) {
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {DL_SELECTABLE_STATUSES.map((s) => {
        const active = value === s;
        const { icon, hint } = OPTION_HINTS[s];
        return (
          <TouchableOpacity
            key={s}
            style={[styles.option, active && styles.optionActive, disabled && styles.disabled]}
            onPress={() => onChange(s)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled }}
          >
            <View style={[styles.optionIcon, active && styles.optionIconActive]}>
              <Ionicons name={icon} size={18} color={active ? Colors.orange : Colors.ink3} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{DL_STATUS_LABELS[s]}</Text>
              <Text style={styles.optionHint}>{hint}</Text>
            </View>
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? Colors.orange : Colors.ink4}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Badge + queue row line ─────────────────────────────────────────────────

export function DlStatusBadge({ status }: { status: DlCollectionStatus | null | undefined }) {
  const look = LOOK[status ?? 'NONE'];
  return (
    <View style={[styles.badge, { backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={12} color={look.fg} />
      <Text style={[styles.badgeText, { color: look.fg }]}>{dlStatusLabel(status)}</Text>
    </View>
  );
}

interface LineProps {
  status: DlCollectionStatus | null | undefined;
  note?: string | null;
  // false: render nothing while the status is still unrecorded (e.g. pickups not done yet).
  showUnrecorded?: boolean;
}

/** The DL badge (and deposit note) for a queue row. Nothing on servers without the field. */
export function DlStatusLine({ status, note, showUnrecorded = true }: LineProps) {
  if (status === undefined) return null;
  if (!status && !showUnrecorded) return null;
  return (
    <View style={styles.line}>
      <DlStatusBadge status={status} />
      {status === 'DEPOSIT' && note ? (
        <Text style={styles.lineNote} numberOfLines={1}>{note}</Text>
      ) : null}
    </View>
  );
}

// ── Detail card with the change action ─────────────────────────────────────

type CardContext = 'pickup' | 'return';

const HINTS: Record<CardContext, Record<DlCollectionStatus | 'NONE', string | null>> = {
  pickup: {
    COLLECTED: 'The branch holds the original licence.',
    NOT_COLLECTED: 'The customer kept their licence.',
    DEPOSIT: null,
    NONE: 'No DL status recorded yet.',
  },
  return: {
    COLLECTED: 'Hand the original licence back to the customer.',
    NOT_COLLECTED: 'The customer kept their licence. Nothing to hand back.',
    DEPOSIT: 'Hand back what the customer left.',
    NONE: 'No DL status was recorded at pickup.',
  },
};

interface CardProps {
  booking: { publicId: string; status: string } & DlStatusFields;
  // 'return' phrases it as what to hand back at the drop.
  context?: CardContext;
  onUpdated?: (result: UpdateDlStatusResult | undefined) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The booking's DL status with the deposit note, and — while the booking is
 * CONFIRMED or PICKED_UP — a "Change" action that saves through
 * PATCH /employee/bookings/:publicId/dl-status.
 */
export function DlStatusCard({ booking, context = 'pickup', onUpdated, style }: CardProps) {
  const qc = useQueryClient();
  const mountedRef = useRef(true);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<DlCollectionStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server returned, shown until the refetched booking catches up.
  const [saved, setSaved] = useState<UpdateDlStatusResult | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Fresh booking data from the parent replaces the saved copy.
  useEffect(() => {
    setSaved(null);
  }, [booking.dlStatus, booking.dlDepositNote, booking.dlStatusUpdatedAt]);

  // Servers older than #3 don't send the field — don't guess.
  if (booking.dlStatus === undefined && !saved) return null;

  const current = saved ?? booking;
  const status = current.dlStatus ?? null;
  const depositNote = current.dlDepositNote ?? null;
  const updatedAt = current.dlStatusUpdatedAt ?? null;
  const editable = canEditDlStatus(saved?.status ?? booking.status);
  const hint = HINTS[context][status ?? 'NONE'];

  const unchanged = choice === status;
  const canSave = !!choice && !saving && !dlChoiceProblem(choice) && !unchanged;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employee', 'pickup', booking.publicId] });
    qc.invalidateQueries({ queryKey: ['employee', 'return', booking.publicId] });
    qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
    qc.invalidateQueries({
      queryKey: ['employee', 'returns'],
      predicate: (q) => q.queryKey[2] !== 'overdue',
    });
  };

  const startEdit = () => {
    // An old DEPOSIT row starts unselected: pick Collected / Not collected.
    setChoice(status === 'DEPOSIT' ? null : status);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!choice || saving) return;
    const problem = dlChoiceProblem(choice);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await employeeApi.updateDlStatus(booking.publicId, dlChoiceBody(choice));
      const data = res.data?.data as UpdateDlStatusResult | undefined;
      if (!mountedRef.current) return;
      if (data) setSaved(data);
      setEditing(false);
      refresh();
      onUpdated?.(data);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(apiErrorMessage(err, "Couldn't update the DL status. Please try again."));
      // 409 DL_STATUS_LOCKED / 404: the booking moved on — reload so the card follows.
      const code = err?.response?.status;
      if (code === 409 || code === 404) {
        setEditing(false);
        refresh();
        onUpdated?.(undefined);
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadLeft}>
          <Ionicons name="id-card-outline" size={16} color={Colors.ink3} />
          <Text style={styles.cardTitle}>Driving licence</Text>
        </View>
        {!editing && <DlStatusBadge status={status} />}
      </View>

      {editing && editable ? (
        <>
          <View style={styles.editBody}>
            <DlStatusSelector
              value={choice}
              onChange={(v) => { setChoice(v); setError(null); }}
              disabled={saving}
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.actionBtn, saving && styles.disabled]}
              onPress={cancelEdit}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary, !canSave && styles.disabled]}
              onPress={save}
              disabled={!canSave}
              activeOpacity={0.8}
            >
              {saving
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={[styles.actionText, styles.actionTextPrimary]}>Save</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {status === 'DEPOSIT' && depositNote ? (
            <View style={styles.depositBox}>
              <Text style={styles.depositLabel}>
                {context === 'return' ? 'Old DL deposit: return it' : 'Old DL deposit held'}
              </Text>
              <Text style={styles.depositText}>{depositNote}</Text>
            </View>
          ) : null}
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          {updatedAt ? <Text style={styles.meta}>Updated {fmtIstDateTime(updatedAt)}</Text> : null}
          {error && <Text style={styles.error}>{error}</Text>}
          {editable && (
            <TouchableOpacity style={styles.changeBtn} onPress={startEdit} hitSlop={8} activeOpacity={0.8}>
              <Ionicons name="create-outline" size={14} color={Colors.orange} />
              <Text style={styles.changeText}>{status ? 'Change' : 'Record status'}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },

  // Selector
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.bg,
  },
  optionActive: { borderColor: Colors.orange, backgroundColor: '#ff6a1f0d' },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  optionIconActive: { borderColor: '#ff6a1f40' },
  optionText: { flex: 1 },
  optionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  optionHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2, lineHeight: 16 },

  noteWrap: { marginTop: 4, gap: 8 },
  noteLabelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  noteLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  noteInput: {
    minHeight: 64,
    textAlignVertical: 'top',
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  noteCounter: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink4, textAlign: 'right' },
  requiredTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: '#e53e3e',
    backgroundColor: '#e53e3e10',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  // Badge / row line
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineNote: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginBottom: 4,
    gap: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  depositBox: {
    backgroundColor: Colors.availLowSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9770630',
    padding: 12,
    gap: 2,
  },
  depositLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.availLow },
  depositText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink, lineHeight: 20 },
  hint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, lineHeight: 18 },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  changeText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },

  editBody: { marginTop: 2 },
  editActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  actionBtnPrimary: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  actionText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  actionTextPrimary: { color: Colors.white },
});
