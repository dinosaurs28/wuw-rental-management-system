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

// 30-minute slots, "HH:mm" 24h values with 12h display labels.
export const TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? 0 : 30;
  const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const label = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  return { value, label };
});

export function timeLabel(value: string) {
  return TIME_SLOTS.find((s) => s.value === value)?.label ?? value;
}

interface Props {
  visible: boolean;
  value: string; // "HH:mm"
  title?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function TimeFieldPicker({ visible, value, title, onSelect, onClose }: Props) {
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
            data={TIME_SLOTS}
            keyExtractor={(s) => s.value}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            initialScrollIndex={Math.max(0, TIME_SLOTS.findIndex((s) => s.value === value))}
            getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
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
});
