import { useState } from 'react';
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
import DateRangePicker from '../ui/DateRangePicker';
import TimeFieldPicker from '../ui/TimeFieldPicker';

export interface SearchQuery {
  branchId: string;
  branchName: string;
  start: string; // ISO
  end: string; // ISO
}

interface Branch {
  publicId: string;
  name: string;
}

interface Props {
  branches: Branch[];
  /** controlled branch — single source of truth shared with the screen */
  branch: Branch | null;
  onBranchChange: (b: Branch) => void;
  initialStart?: string;
  initialEnd?: string;
  ctaLabel?: string;
  onSubmit: (q: SearchQuery) => void;
}

function combine(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
}
function fmtD(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Sixt-style dark search box: pickup branch row, one combined
// "12 Jul | 12:00 – 15 Jul | 12:00" row, and a large orange CTA.
export default function SearchCard({
  branches,
  branch,
  onBranchChange,
  initialStart,
  initialEnd,
  ctaLabel = 'Show offers',
  onSubmit,
}: Props) {
  const [start, setStart] = useState<Date>(() => (initialStart ? new Date(initialStart) : new Date(Date.now() + 86_400_000)));
  const [end, setEnd] = useState<Date>(() => (initialEnd ? new Date(initialEnd) : new Date(Date.now() + 2 * 86_400_000)));
  const [pickupTime, setPickupTime] = useState('10:00');
  const [returnTime, setReturnTime] = useState('10:00');

  const [branchOpen, setBranchOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  const submit = () => {
    if (!branch) {
      setBranchOpen(true);
      return;
    }
    onSubmit({
      branchId: branch.publicId,
      branchName: branch.name,
      start: combine(start, pickupTime).toISOString(),
      end: combine(end, returnTime).toISOString(),
    });
  };

  const branchPicker = (
    <Modal visible={branchOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setBranchOpen(false)}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={() => setBranchOpen(false)}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Pick-up branch</Text>
          <FlatList
            data={branches}
            keyExtractor={(b) => b.publicId}
            style={styles.sheetList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = item.publicId === branch?.publicId;
              return (
                <TouchableOpacity
                  style={[styles.branchRow, active && styles.branchRowActive]}
                  onPress={() => { onBranchChange(item); setBranchOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="location-outline" size={16} color={active ? Colors.orange : Colors.onDarkMuted} />
                  <Text style={[styles.branchRowText, active && styles.branchRowTextActive]}>{item.name}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={Colors.orange} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.card}>
      {/* Pick-up branch */}
      <TouchableOpacity style={styles.row} onPress={() => setBranchOpen(true)} activeOpacity={0.7}>
        <Ionicons name="location-outline" size={20} color={Colors.white} />
        <Text style={styles.rowValue} numberOfLines={1}>
          {branch?.name ?? 'Select a branch'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.onDarkMuted} />
      </TouchableOpacity>
      <View style={styles.underline} />

      {/* Dates & times — "12 Jul | 12:00 – 15 Jul | 12:00" */}
      <View style={styles.row}>
        <Ionicons name="calendar-outline" size={19} color={Colors.white} />
        <View style={styles.dateSeg}>
          <TouchableOpacity onPress={() => setDateOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{fmtD(start)}</Text>
          </TouchableOpacity>
          <Text style={styles.sep}>|</Text>
          <TouchableOpacity onPress={() => setPickupOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{pickupTime}</Text>
          </TouchableOpacity>
          <Text style={styles.dash}>–</Text>
          <TouchableOpacity onPress={() => setDateOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{fmtD(end)}</Text>
          </TouchableOpacity>
          <Text style={styles.sep}>|</Text>
          <TouchableOpacity onPress={() => setReturnOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{returnTime}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.underline} />

      {/* CTA */}
      <TouchableOpacity style={styles.cta} onPress={submit} activeOpacity={0.88}>
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </TouchableOpacity>

      {branchPicker}
      <DateRangePicker
        visible={dateOpen}
        startDate={start}
        endDate={end}
        onConfirm={(s, e) => { setStart(s); setEnd(e); }}
        onClose={() => setDateOpen(false)}
      />
      <TimeFieldPicker visible={pickupOpen} value={pickupTime} title="Pickup time" onSelect={setPickupTime} onClose={() => setPickupOpen(false)} />
      <TimeFieldPicker visible={returnOpen} value={returnTime} title="Return time" onSelect={setReturnTime} onClose={() => setReturnOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(24,26,31,0.97)',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  rowValue: { fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.white, letterSpacing: -0.2, flexShrink: 1 },
  dateSeg: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sep: { fontFamily: Fonts.body, fontSize: 16, color: Colors.onDarkMuted },
  dash: { fontFamily: Fonts.body, fontSize: 16, color: Colors.onDarkMuted, marginHorizontal: 2 },
  underline: { height: 1, backgroundColor: Colors.hairlineOnDark, marginLeft: 34 },

  cta: {
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 22,
  },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.white, letterSpacing: 0.1 },

  // Branch picker sheet (dark)
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: Colors.surfaceDark, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 28, maxHeight: '70%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  sheetTitle: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.white, letterSpacing: -0.3, paddingHorizontal: 20, marginBottom: 8 },
  sheetList: { paddingHorizontal: 16 },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 14, borderRadius: 12 },
  branchRowActive: { backgroundColor: 'rgba(255,106,31,0.14)' },
  branchRowText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.onDark },
  branchRowTextActive: { fontFamily: Fonts.bodySemiBold, color: Colors.white },
});
