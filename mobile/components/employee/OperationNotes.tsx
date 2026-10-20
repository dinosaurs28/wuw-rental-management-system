import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { fmtIstDateTime } from '../../lib/dates';

// Fleet pickup / drop notes (Oct 20 2026): the optional note written at the
// pickup and at the drop. OperationNoteInput is the field; OperationNotesCard
// shows the saved notes (pickup, mid-rental swaps, drop). Staff only.

/** Most characters a note may have (same limit as the server). */
export const OPERATION_NOTE_MAX = 1000;

export interface OperationNoteView {
  note: string;
  writtenBy: string | null;
  writtenAt: string;
  editedBy: string | null;
  editedAt: string | null;
}

export interface SwapNoteView {
  swapPublicId: string;
  swappedAt: string;
  swappedBy: string | null;
  fromRegNo: string;
  toRegNo: string;
  reason: string;
  reasonNotes: string | null;
  originalVehicleNotes: string | null;
}

export interface OperationNotesView {
  pickup: OperationNoteView | null;
  drop: OperationNoteView | null;
  swaps: SwapNoteView[];
}

/** The note as sent: trimmed, blank = null (no note / clears it). */
export const noteForRequest = (text: string): string | null => {
  const t = text.trim();
  return t ? t : null;
};

export const noteTooLong = (text: string) => text.trim().length > OPERATION_NOTE_MAX;

export function OperationNoteInput({
  label,
  value,
  onChange,
  editable = true,
  style,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const length = value.trim().length;
  const over = length > OPERATION_NOTE_MAX;
  return (
    <View style={[styles.inputWrap, style]}>
      <Text style={styles.inputLabel}>
        {label} <Text style={styles.optional}>(optional)</Text>
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline
        maxLength={OPERATION_NOTE_MAX + 200}
        placeholder="Anything the branch manager or the next person should know"
        placeholderTextColor={Colors.ink4}
        style={[styles.input, !editable && styles.disabled, over && styles.inputError]}
        accessibilityLabel={label}
      />
      <Text style={[styles.counter, over && styles.counterError]}>
        {length}/{OPERATION_NOTE_MAX}
      </Text>
    </View>
  );
}

function NoteBlock({ title, note }: { title: string; note: OperationNoteView }) {
  return (
    <View style={styles.block}>
      <Text style={styles.meta}>
        {title} from {note.writtenBy ?? 'staff'}, {fmtIstDateTime(note.writtenAt)}
        {note.editedAt ? ` · edited${note.editedBy ? ` by ${note.editedBy}` : ''} ${fmtIstDateTime(note.editedAt)}` : ''}
      </Text>
      <Text style={styles.text}>{note.note}</Text>
    </View>
  );
}

/** The saved notes; renders nothing when there are none to show. */
export function OperationNotesCard({
  notes,
  show = ['pickup', 'swaps', 'drop'],
  title = 'Fleet notes',
  style,
}: {
  notes: OperationNotesView | null | undefined;
  show?: Array<'pickup' | 'drop' | 'swaps'>;
  title?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const pickup = show.includes('pickup') ? notes?.pickup ?? null : null;
  const drop = show.includes('drop') ? notes?.drop ?? null : null;
  const swaps = show.includes('swaps') ? notes?.swaps ?? [] : [];
  if (!pickup && !drop && swaps.length === 0) return null;
  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <Ionicons name="document-text-outline" size={16} color={Colors.availLow} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {pickup ? <NoteBlock title="Pickup note" note={pickup} /> : null}
      {swaps.map((s) => (
        <View key={s.swapPublicId} style={styles.block}>
          <Text style={styles.meta}>
            Swap {s.fromRegNo} → {s.toRegNo}
            {s.swappedBy ? ` by ${s.swappedBy}` : ''}, {fmtIstDateTime(s.swappedAt)}
          </Text>
          {s.reasonNotes ? <Text style={styles.text}>{s.reasonNotes}</Text> : null}
          {s.originalVehicleNotes ? (
            <Text style={styles.text}>
              <Text style={styles.muted}>{s.fromRegNo} condition: </Text>
              {s.originalVehicleNotes}
            </Text>
          ) : null}
        </View>
      ))}
      {drop ? <NoteBlock title="Drop note" note={drop} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { gap: 6 },
  inputLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  optional: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  input: {
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  inputError: { borderColor: Colors.availNone },
  disabled: { opacity: 0.6 },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  counterError: { color: Colors.availNone },

  card: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9770633',
    backgroundColor: Colors.availLowSoft,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  block: { gap: 3 },
  meta: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  text: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink, lineHeight: 20 },
  muted: { color: Colors.ink3 },
});
