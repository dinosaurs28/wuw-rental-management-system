import {
  Dimensions,
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

const { height } = Dimensions.get('window');

export interface Branch {
  publicId: string;
  name: string;
}

interface Props {
  visible: boolean;
  branches: Branch[];
  selectedId?: string | null;
  onSelect: (branch: Branch) => void;
  onClose: () => void;
}

export default function BranchPicker({
  visible,
  branches,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <TouchableWithoutFeedback>
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <Text style={styles.title}>Select branch</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={Colors.ink2} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={branches}
              keyExtractor={(b) => b.publicId}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const active = item.publicId === selectedId;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => {
                      onSelect(item);
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color={active ? Colors.orange : Colors.ink3}
                      />
                    </View>
                    <Text style={[styles.rowText, active && styles.rowTextActive]}>
                      {item.name}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark" size={20} color={Colors.orange} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No branches available</Text>
                </View>
              }
            />
          </View>
        </TouchableWithoutFeedback>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: height * 0.7,
    overflow: 'hidden',
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ink4,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  listContent: { paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 14,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: '#ff6a1f12',
    borderColor: '#ff6a1f33',
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: Colors.ink,
  },
  rowTextActive: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  separator: { height: 2 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
});
