import { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

export interface Option {
  id: string;
  label: string;
}

export interface FilterValue {
  branch: string | null;
  category: string | null;
  sort: string | null;
}

const SORT_OPTIONS: Option[] = [
  { id: 'price_low_to_high', label: 'Price: Low to High' },
  { id: 'price_high_to_low', label: 'Price: High to Low' },
];

interface Props {
  visible: boolean;
  branches?: Option[];
  categories?: Option[];
  showSort?: boolean;
  value: FilterValue;
  onApply: (v: FilterValue) => void;
  onClose: () => void;
}

export default function FilterSheet({
  visible,
  branches,
  categories,
  showSort = true,
  value,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<FilterValue>(value);

  // Re-sync the draft whenever the sheet is (re)opened.
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible]);

  const toggle = (key: keyof FilterValue, id: string) =>
    setDraft((d) => ({ ...d, [key]: d[key] === id ? null : id }));

  const clearAll = () => setDraft({ branch: null, category: null, sort: null });

  const renderChips = (key: keyof FilterValue, options: Option[]) => (
    <View style={styles.chipWrap}>
      {options.map((opt) => {
        const active = draft[key] === opt.id;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => toggle(key, opt.id)}
            activeOpacity={0.8}
          >
            {active && <Ionicons name="checkmark" size={13} color={Colors.white} />}
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Filters</Text>
            <TouchableOpacity onPress={clearAll} hitSlop={8}>
              <Text style={styles.clear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {branches && branches.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Branch</Text>
                {renderChips('branch', branches)}
              </>
            )}
            {categories && categories.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Category</Text>
                {renderChips('category', categories)}
              </>
            )}
            {showSort && (
              <>
                <Text style={styles.sectionLabel}>Sort by</Text>
                {renderChips('sort', SORT_OPTIONS)}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.applyBtnText}>Apply filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '82%',
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ink4,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  clear: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginTop: 18,
    marginBottom: 10,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  applyBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white, letterSpacing: 0.2 },
});
