import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import {
  EMPTY_QUEUE_FILTERS,
  activeFilterCount,
  hasTimeFilter,
  type QueueFilterState,
} from '../../store/queueFilters';
import type { QueueFilterOption, QueueFilterOptions } from '../../types/queue';

// Search-bar filters of the Fleet queues (client, Oct 20 2026): a filter sheet
// opened from the search field, and the active filters as removable chips under
// it. The vehicle choices come from the branch's fleet (GET /queue-filters).

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (s: string) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

const WHEN_FALLBACK: Record<string, string> = { today: 'Today', tomorrow: 'Tomorrow', overdue: 'Overdue' };

/** The time filter in words ("Today", "12 Oct – 15 Oct", "From 12 Oct"), or null. */
export function timeFilterLabel(f: QueueFilterState, options?: QueueFilterOptions | null): string | null {
  if (!hasTimeFilter(f)) return null;
  if (f.when !== 'range') return options?.when.find((w) => w.value === f.when)?.label ?? WHEN_FALLBACK[f.when!];
  if (f.from && f.to) return f.from === f.to ? dayLabel(f.from) : `${dayLabel(f.from)} – ${dayLabel(f.to)}`;
  return f.from ? `From ${dayLabel(f.from)}` : `Until ${dayLabel(f.to!)}`;
}

type ListKey = 'typeClass' | 'category' | 'groupKey' | 'tripType' | 'payment';

function optionsFor(key: ListKey, options?: QueueFilterOptions | null): QueueFilterOption[] {
  if (!options) return [];
  switch (key) {
    case 'typeClass': return options.typeClasses;
    case 'category': return options.categories;
    case 'groupKey': return options.groups;
    case 'tripType': return options.tripTypes;
    case 'payment': return options.payment;
  }
}

// A value the options don't list (e.g. options still loading): readable fallback
const fallbackLabel = (value: string) => value.replace(/__/g, ' ').replace(/_/g, ' ');

export interface ActiveChip {
  key: string;
  label: string;
  remove: (f: QueueFilterState) => QueueFilterState;
}

/** Every active filter value as a chip, in the sheet's order. */
export function activeChips(f: QueueFilterState, options?: QueueFilterOptions | null): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const time = timeFilterLabel(f, options);
  if (time) chips.push({ key: 'time', label: time, remove: (s) => ({ ...s, when: null, from: null, to: null }) });
  for (const key of ['typeClass', 'category', 'groupKey', 'tripType', 'payment'] as ListKey[]) {
    const list = optionsFor(key, options);
    for (const value of f[key] as string[]) {
      chips.push({
        key: `${key}:${value}`,
        label: list.find((o) => o.value === value)?.label ?? fallbackLabel(value),
        remove: (s) => ({ ...s, [key]: (s[key] as string[]).filter((v) => v !== value) }),
      });
    }
  }
  return chips;
}

/** The active filters in one line for the empty state ("Today · Two-wheeler"). */
export function filterSummary(f: QueueFilterState, options?: QueueFilterOptions | null): string {
  return activeChips(f, options).map((c) => c.label).join(' · ');
}

/** Filter button inside the search field, with the number of active values. */
export function QueueFilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      style={[styles.filterBtn, count > 0 && styles.filterBtnActive]}
      accessibilityLabel={count > 0 ? `Filters, ${count} on` : 'Filters'}
      activeOpacity={0.7}
    >
      <Ionicons name="options-outline" size={17} color={count > 0 ? Colors.orange : Colors.ink2} />
      {count > 0 ? (
        <View style={styles.filterBadge}>
          <Text style={styles.filterBadgeText}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/** Active filters as removable chips under the search field, then "Clear all". */
export function QueueFilterChips({
  filters,
  options,
  onChange,
}: {
  filters: QueueFilterState;
  options?: QueueFilterOptions | null;
  onChange: (f: QueueFilterState) => void;
}) {
  const chips = activeChips(filters, options);
  if (chips.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chipRow}>
      {chips.map((chip) => (
        <TouchableOpacity
          key={chip.key}
          style={styles.activeChip}
          onPress={() => onChange(chip.remove(filters))}
          activeOpacity={0.75}
          accessibilityLabel={`Remove filter ${chip.label}`}
        >
          <Text style={styles.activeChipText} numberOfLines={1}>{chip.label}</Text>
          <Ionicons name="close" size={13} color={Colors.orange} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={() => onChange(EMPTY_QUEUE_FILTERS)} hitSlop={6} activeOpacity={0.7} style={styles.clearAllChip}>
        <Text style={styles.clearAllText}>Clear all</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Chip({ label, count, selected, onPress }: { label: string; count?: number; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipOn]} onPress={onPress} activeOpacity={0.8}>
      {selected ? <Ionicons name="checkmark" size={13} color={Colors.white} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
      {count != null ? <Text style={[styles.chipCount, selected && styles.chipCountOn]}>{count}</Text> : null}
    </TouchableOpacity>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

/** Month grid for the custom date range: first tap = from, second = to. */
function RangeCalendar({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  const [month, setMonth] = useState(() => {
    const base = from ? parseYmd(from) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const cells = useMemo(() => {
    const first = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: first }, () => null),
      ...Array.from({ length: days }, (_, i) => ymd(new Date(month.getFullYear(), month.getMonth(), i + 1))),
    ];
  }, [month]);
  const today = ymd(new Date());
  const tap = (day: string) => {
    if (!from || (from && to)) onChange(day, null);
    else if (day < from) onChange(day, from);
    else onChange(from, day);
  };
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  return (
    <View style={styles.cal}>
      <View style={styles.calHead}>
        <TouchableOpacity onPress={() => shift(-1)} hitSlop={8} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={18} color={Colors.ink2} />
        </TouchableOpacity>
        <Text style={styles.calTitle}>{MONTHS[month.getMonth()]} {month.getFullYear()}</Text>
        <TouchableOpacity onPress={() => shift(1)} hitSlop={8} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={18} color={Colors.ink2} />
        </TouchableOpacity>
      </View>
      <View style={styles.calGrid}>
        {DOW.map((d) => (
          <Text key={d} style={styles.calDow}>{d}</Text>
        ))}
        {cells.map((day, i) => {
          if (!day) return <View key={`b${i}`} style={styles.calCell} />;
          const isEnd = day === from || day === to;
          const inRange = !!(from && to && day > from && day < to);
          return (
            <TouchableOpacity key={day} style={styles.calCell} onPress={() => tap(day)} activeOpacity={0.7}>
              <View style={[styles.calDay, inRange && styles.calDayIn, isEnd && styles.calDayEnd]}>
                <Text style={[styles.calDayText, day === today && styles.calToday, inRange && styles.calDayInText, isEnd && styles.calDayEndText]}>
                  {Number(day.slice(8))}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.calHint}>
        {from && to ? `${dayLabel(from)} – ${dayLabel(to)}` : from ? `From ${dayLabel(from)} — tap the last day` : 'Tap the first day'}
      </Text>
    </View>
  );
}

/** Bottom sheet with every filter; changes apply on "Show results". */
export function QueueFilterSheet({
  visible,
  phaseLabel,
  filters,
  options,
  optionsLoading,
  optionsError,
  onRetryOptions,
  onApply,
  onClose,
}: {
  visible: boolean;
  phaseLabel: string; // "pickup" | "return"
  filters: QueueFilterState;
  options?: QueueFilterOptions | null;
  optionsLoading: boolean;
  optionsError: boolean;
  onRetryOptions: () => void;
  onApply: (f: QueueFilterState) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<QueueFilterState>(filters);
  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible]);

  const toggle = (key: ListKey, value: string) =>
    setDraft((d) => {
      const list = d[key] as string[];
      return { ...d, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  const setWhen = (when: QueueFilterState['when']) =>
    setDraft((d) => (d.when === when ? { ...d, when: null, from: null, to: null } : { ...d, when, from: null, to: null }));

  const listSection = (key: ListKey, title: string, hint?: string) => {
    const list = optionsFor(key, options);
    if (list.length === 0) return null;
    return (
      <Section title={title} hint={hint}>
        {list.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            count={o.count}
            selected={(draft[key] as string[]).includes(o.value)}
            onPress={() => toggle(key, o.value)}
          />
        ))}
      </Section>
    );
  };
  const n = activeFilterCount(draft);

  return (
    <Modal transparent animationType="slide" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close filters">
              <Ionicons name="close" size={22} color={Colors.ink2} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            <Section title={phaseLabel === 'pickup' ? 'Pickup time' : 'Return time'} hint="replaces the day picked above">
              {(options?.when ?? []).map((w) => (
                <Chip key={w.value} label={w.label} selected={draft.when === w.value} onPress={() => setWhen(w.value)} />
              ))}
              <Chip label="Custom dates" selected={draft.when === 'range'} onPress={() => setWhen('range')} />
            </Section>
            {draft.when === 'range' ? (
              <RangeCalendar from={draft.from} to={draft.to} onChange={(from, to) => setDraft((d) => ({ ...d, from, to }))} />
            ) : null}

            {optionsLoading && !options ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color={Colors.orange} />
            ) : optionsError && !options ? (
              <TouchableOpacity onPress={onRetryOptions} style={styles.optionsError}>
                <Text style={styles.optionsErrorText}>Could not load the vehicle filters. Tap to retry.</Text>
              </TouchableOpacity>
            ) : (
              <>
                {listSection('typeClass', 'Vehicle type')}
                {listSection('category', 'Category')}
                {listSection('groupKey', 'Model', 'vehicles in the branch')}
                {listSection('tripType', 'Trip type')}
                {listSection('payment', 'Payment')}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => setDraft(EMPTY_QUEUE_FILTERS)}
              disabled={n === 0}
              style={styles.footerClear}
              activeOpacity={0.7}
            >
              <Text style={[styles.footerClearText, n === 0 && { color: Colors.ink4 }]}>Clear all</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => onApply(draft)} activeOpacity={0.85}>
              <Text style={styles.applyText}>{n > 0 ? `Show results · ${n} filter${n === 1 ? '' : 's'}` : 'Show results'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filterBtn: { padding: 4, borderRadius: 8 },
  filterBtnActive: { backgroundColor: Colors.orangeSoft },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 10, color: Colors.white },

  chipRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 12, alignItems: 'center' },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.orangeSoft,
    borderWidth: 1,
    borderColor: '#ff6a1f40',
  },
  activeChipText: { flexShrink: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.orange },
  clearAllChip: { paddingHorizontal: 6, paddingVertical: 6 },
  clearAllText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink2, textDecorationLine: 'underline' },

  container: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.ink4, marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  sheetTitle: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  body: { paddingHorizontal: 20 },

  section: { paddingTop: 14, gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sectionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, letterSpacing: 0.2 },
  sectionHint: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipOn: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextOn: { color: Colors.white },
  chipCount: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink4 },
  chipCountOn: { color: 'rgba(255,255,255,0.65)' },

  cal: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.hairline },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDow: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3, paddingVertical: 4 },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  calDay: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  calDayIn: { backgroundColor: Colors.orangeSoft, borderRadius: 8 },
  calDayEnd: { backgroundColor: Colors.ink },
  calDayText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink },
  calToday: { fontFamily: Fonts.bodyBold, color: Colors.orange },
  calDayInText: { color: Colors.ink },
  calDayEndText: { color: Colors.white },
  calHint: { marginTop: 6, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'center' },

  optionsError: { paddingVertical: 20 },
  optionsErrorText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange, textAlign: 'center' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  footerClear: { paddingVertical: 12, paddingHorizontal: 4 },
  footerClearText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  applyBtn: { flex: 1, height: 48, borderRadius: 14, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
