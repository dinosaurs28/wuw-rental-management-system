import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { priceDifferenceOf, type SwapPickerVehicle } from '../../types/vehicleSwap';
import { SwapCandidateList, swapInr } from './SwapParts';

// Shared replacement-vehicle picker for the pickup swap, the mid-rental swap
// and the extension's "swap to another vehicle" option: a summary row that
// opens a ~75%-height bottom sheet with a make / model search. The pick inside
// the sheet is a draft until "Select vehicle".

// Case-insensitive, multi-word: every word must appear in make / model / reg / category.
export function filterSwapCandidates<T extends SwapPickerVehicle>(vehicles: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return vehicles;
  return vehicles.filter((v) => {
    const hay = `${v.make} ${v.model} ${v.regNo} ${v.categoryName ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export default function SwapVehiclePicker<T extends SwapPickerVehicle>({
  vehicles,
  selectedId,
  onSelect,
  disabled,
}: {
  vehicles: T[];
  selectedId: string | number | null;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftId, setDraftId] = useState<string | number | null>(selectedId);

  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const filtered = useMemo(() => filterSwapCandidates(vehicles, query), [vehicles, query]);
  const draft = vehicles.find((v) => v.id === draftId) ?? null;

  // A reload can drop the draft car (taken meanwhile).
  useEffect(() => {
    if (draftId != null && !vehicles.some((v) => v.id === draftId)) setDraftId(null);
  }, [vehicles]);

  const openSheet = () => {
    setDraftId(selectedId);
    setQuery('');
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);
  const confirm = () => {
    if (draft) onSelect(draft);
    setOpen(false);
  };

  const thumb = selected?.images?.[0]?.url ?? null;
  const selDiff = priceDifferenceOf(selected?.priceDifference);

  return (
    <>
      <TouchableOpacity
        style={[styles.field, selected && styles.fieldActive]}
        onPress={openSheet}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={selected ? 'Change replacement vehicle' : 'Choose replacement vehicle'}
      >
        {selected ? (
          thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="car-outline" size={18} color={Colors.ink4} />
            </View>
          )
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="search" size={18} color={Colors.ink4} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {selected ? (
            <>
              <Text style={styles.name} numberOfLines={1}>{selected.make} {selected.model}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {selected.regNo}{selected.categoryName ? ` · ${selected.categoryName}` : ''}
                {selDiff != null && selDiff > 0 ? ` · +${swapInr(selDiff)}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.name}>Choose replacement vehicle</Text>
              <Text style={styles.sub}>{vehicles.length} available · search by make or model</Text>
            </>
          )}
        </View>
        <Text style={styles.change}>{selected ? 'Change' : 'Select'}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={closeSheet}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={closeSheet}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          {/* Spans the screen below the status bar, so with the keyboard up (iOS:
              KAV padding; Android: a resized window) the sheet shrinks to fit
              instead of sliding off the top — the header and search stay in
              view and only the list gets shorter. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.kav, { paddingTop: insets.top + 8 }]}
            pointerEvents="box-none"
          >
            <View style={[styles.sheet, { height: Math.round(height * 0.75) }]}>
              <View style={styles.handle} />
              <View style={styles.header}>
                <Text style={styles.title}>Select vehicle</Text>
                <TouchableOpacity onPress={closeSheet} hitSlop={10} accessibilityLabel="Close">
                  <Ionicons name="close" size={22} color={Colors.ink} />
                </TouchableOpacity>
              </View>

              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={Colors.ink4} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search make or model"
                  placeholderTextColor={Colors.ink4}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={16} color={Colors.ink4} />
                  </TouchableOpacity>
                )}
              </View>

              <FlatList
                data={filtered}
                keyExtractor={(v) => String(v.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                style={{ flex: 1 }}
                renderItem={({ item }) => (
                  <SwapCandidateList vehicles={[item]} selectedId={draftId} onSelect={(v) => setDraftId(v.id)} />
                )}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {query.trim() ? `No vehicle matches "${query.trim()}".` : 'No vehicles to show.'}
                  </Text>
                }
              />

              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.confirmBtn, !draft && styles.confirmBtnDisabled]}
                  onPress={confirm}
                  disabled={!draft}
                  activeOpacity={0.85}
                >
                  <Text style={styles.confirmText}>
                    {draft ? `Select ${draft.make} ${draft.model}` : 'Select a vehicle'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.hairline, backgroundColor: Colors.bg, marginBottom: 8,
  },
  fieldActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  thumb: { width: 48, height: 40, borderRadius: 8, backgroundColor: Colors.surface },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  change: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange, paddingRight: 4 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  // ~75% tall; flexShrink lets it give way to the keyboard (the list shrinks).
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, flexShrink: 1,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.ink },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.bg, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.hairline, paddingHorizontal: 12, marginBottom: 12,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink },
  listContent: { paddingBottom: 8 },
  empty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, textAlign: 'center', marginTop: 32 },
  footer: { paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 28 : 16 },
  confirmBtn: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
