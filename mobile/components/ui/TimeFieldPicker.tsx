import { useMemo } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { GRID_SLOTS, withSelectedSlot, type TimeSlot } from '../../lib/dates';

interface Props {
  visible: boolean;
  value: string; // "HH:mm"
  // Allowed times from timeSlotsFor() (past times already dropped for today);
  // defaults to the full 30-minute grid.
  slots?: TimeSlot[];
  title?: string;
  // Shown when no time is left (e.g. the branch is closed that day).
  emptyText?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function TimeFieldPicker({ visible, value, slots = GRID_SLOTS, title, emptyText, onSelect, onClose }: Props) {
  // An off-grid current value (e.g. 6:05 PM) stays listed and selected; the
  // list opens scrolled to it, or to the next later time.
  const data = useMemo(() => withSelectedSlot(slots, value), [slots, value]);
  const at = data.findIndex((s) => s.value >= value);
  const scrollIndex = at >= 0 ? at : data.length - 1;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title ?? 'Select time'}</Text>
          <FlatList
            data={data}
            keyExtractor={(s) => s.value}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            initialScrollIndex={data.length ? scrollIndex : undefined}
            getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
            ListEmptyComponent={<Text style={styles.empty}>{emptyText ?? 'No times left on this day. Pick another date.'}</Text>}
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <TouchableOpacity
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => { onSelect(item.value); onClose(); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rowText, active && styles.rowTextActive]}>{item.label}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={Colors.orange} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.ink4, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  title: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink, letterSpacing: -0.3, paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 16 },
  row: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  rowActive: { backgroundColor: Colors.orangeSoft },
  rowText: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.ink2 },
  rowTextActive: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, paddingHorizontal: 4, paddingVertical: 16 },
});
