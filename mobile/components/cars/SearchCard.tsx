import { useEffect, useState } from 'react';
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
import TimeFieldPicker, { timeLabel } from '../ui/TimeFieldPicker';

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
  defaultBranchId?: string | null;
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

export default function SearchCard({ branches, defaultBranchId, initialStart, initialEnd, ctaLabel = 'Show vehicles', onSubmit }: Props) {
  const [branch, setBranch] = useState<Branch | null>(null);
  const [start, setStart] = useState<Date>(() => (initialStart ? new Date(initialStart) : new Date(Date.now() + 86_400_000)));
  const [end, setEnd] = useState<Date>(() => (initialEnd ? new Date(initialEnd) : new Date(Date.now() + 2 * 86_400_000)));
  const [pickupTime, setPickupTime] = useState('10:00');
  const [returnTime, setReturnTime] = useState('10:00');

  const [branchOpen, setBranchOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  // Track the controlled default branch (so tapping a branch chip on Home keeps the
  // card in sync), falling back to the first branch only when nothing is selected.
  useEffect(() => {
    if (branches.length === 0) return;
    setBranch((prev) => {
      if (defaultBranchId) {
        const match = branches.find((b) => b.publicId === defaultBranchId);
        if (match) return match;
      }
      return prev ?? branches[0];
    });
  }, [branches, defaultBranchId]);

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

  return (
    <View style={styles.card}>
      {/* Branch */}
      <TouchableOpacity style={styles.row} onPress={() => setBranchOpen(true)} activeOpacity={0.7}>
        <Ionicons name="location-outline" size={18} color={Colors.ink} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>BRANCH</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{branch?.name ?? 'Select a branch'}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={Colors.ink3} />
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Dates */}
      <TouchableOpacity style={styles.row} onPress={() => setDateOpen(true)} activeOpacity={0.7}>
        <Ionicons name="calendar-outline" size={18} color={Colors.ink} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>DATES</Text>
          <Text style={styles.rowValue}>{fmtD(start)} — {fmtD(end)}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={Colors.ink3} />
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* Times */}
      <View style={styles.timeRow}>
        <TouchableOpacity style={styles.timeField} onPress={() => setPickupOpen(true)} activeOpacity={0.7}>
          <Text style={styles.rowLabel}>PICKUP</Text>
          <Text style={styles.rowValue}>{timeLabel(pickupTime)}</Text>
        </TouchableOpacity>
        <View style={styles.timeDivider} />
        <TouchableOpacity style={styles.timeField} onPress={() => setReturnOpen(true)} activeOpacity={0.7}>
          <Text style={styles.rowLabel}>RETURN</Text>
          <Text style={styles.rowValue}>{timeLabel(returnTime)}</Text>
        </TouchableOpacity>
      </View>

      {/* CTA */}
      <TouchableOpacity style={styles.cta} onPress={submit} activeOpacity={0.88}>
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </TouchableOpacity>

      {/* Branch picker */}
      <Modal visible={branchOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setBranchOpen(false)}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={() => setBranchOpen(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choose a branch</Text>
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
                    onPress={() => { setBranch(item); setBranchOpen(false); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="location-outline" size={16} color={active ? Colors.orange : Colors.ink3} />
                    <Text style={[styles.branchRowText, active && styles.branchRowTextActive]}>{item.name}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={Colors.orange} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

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
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13 },
  rowBody: { flex: 1 },
  rowLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 9.5, color: Colors.ink3, letterSpacing: 1, marginBottom: 2 },
  rowValue: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink, letterSpacing: -0.2 },
  divider: { height: 1, backgroundColor: Colors.hairline, marginHorizontal: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeField: { flex: 1, paddingHorizontal: 24, paddingVertical: 13 },
  timeDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.hairline, marginVertical: 8 },
  cta: { backgroundColor: Colors.orange, borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white, letterSpacing: 0.2 },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: Colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 28, maxHeight: '70%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.ink4, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  sheetTitle: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink, letterSpacing: -0.3, paddingHorizontal: 20, marginBottom: 8 },
  sheetList: { paddingHorizontal: 16 },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 14, borderRadius: 12 },
  branchRowActive: { backgroundColor: Colors.orangeSoft },
  branchRowText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.ink2 },
  branchRowTextActive: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
});
