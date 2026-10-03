import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../constants/colors';
import DateRangePicker from '../ui/DateRangePicker';
import TimeFieldPicker from '../ui/TimeFieldPicker';
import PackagePicker from '../booking/PackagePicker';
import { BranchHoursLine, TimesNotice } from '../booking/BranchHours';
import { useBranchSchedule } from '../../hooks/useBranchSchedule';
import { bookingWindowLastDay, timeLabel, timeOf, withTime } from '../../lib/dates';
import { MAX_BOOKING_DAYS } from '../../lib/bookingWindow';
import {
  closedDayText,
  isClosedDay,
  noPickupTimesLeft,
  rangeHoursLine,
  slotsWithinHours,
} from '../../lib/branchSchedule';
import {
  customerPackageChoices,
  fitPackageRange,
  initialPackageRange,
  latestPackagePickup,
  packageRangeEnd,
  packageTimesNotice,
  refreshPackageRange,
  type PackageRange,
} from '../../lib/packages';

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

function fmtD(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Sixt-style dark search box: pickup branch row, one combined
// "12 Jul | 6:05 PM – 13 Jul | 6:05 PM" row, the package chips and a large
// orange CTA.
export default function SearchCard({
  branches,
  branch,
  onBranchChange,
  initialStart,
  initialEnd,
  ctaLabel = 'Show offers',
  onSubmit,
}: Props) {
  // Customers book a pickup + a PACKAGE (BRIEF4 P1): "12 hours" or "1 day" …
  // "15 days". The return is pickup + the package — shown, never picked.
  const [pkg, setPkg] = useState(() => initialPackageRange(initialStart, initialEnd));
  const start = pkg.start;
  const end = packageRangeEnd(pkg);

  // The branch's office hours (#2) and the 15-day limit (#15): pickers only
  // offer accepted pickups, a pickup outside them moves back in, and a package
  // whose return the branch wouldn't take becomes the nearest one it would.
  const { data: schedule } = useBranchSchedule(branch?.publicId);
  const fit = useCallback((r: PackageRange) => fitPackageRange(r, { config: schedule }), [schedule]);
  useEffect(() => {
    setPkg((r) => fit(r));
  }, [fit, pkg]);
  const notice = packageTimesNotice(schedule, pkg);
  const choices = customerPackageChoices(start, schedule);

  // The home tab stays mounted, so the shown pickup can slip into the past.
  // While this screen is focused — on focus, on return to the foreground and
  // every 15s — move a past pickup to the next 5-minute mark (the package and
  // so the return follow it). A pickup still in the future is left untouched.
  useFocusEffect(
    useCallback(() => {
      const refresh = () => setPkg((r) => refreshPackageRange(r));
      refresh();
      const timer = setInterval(refresh, 15_000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, []),
  );

  const [branchOpen, setBranchOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);

  const submit = () => {
    if (!branch) {
      setBranchOpen(true);
      return;
    }
    // The card may have sat open past its pickup time — bump it first.
    const next = fit(pkg);
    setPkg(next);
    onSubmit({
      branchId: branch.publicId,
      branchName: branch.name,
      start: next.start.toISOString(),
      end: packageRangeEnd(next).toISOString(),
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

      {/* Dates & times — "12 Jul | 6:05 PM – 13 Jul | 6:05 PM"; the return
          follows from the package (read-only) */}
      <View style={styles.row}>
        <Ionicons name="calendar-outline" size={19} color={Colors.white} />
        <View style={styles.dateSeg}>
          <TouchableOpacity onPress={() => setDateOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{fmtD(start)}</Text>
          </TouchableOpacity>
          <Text style={styles.sep}>|</Text>
          <TouchableOpacity onPress={() => setPickupOpen(true)} hitSlop={6}>
            <Text style={styles.rowValue}>{timeLabel(timeOf(start))}</Text>
          </TouchableOpacity>
          <Text style={styles.dash}>–</Text>
          <Text style={styles.rowValueFixed} accessibilityLabel={`Return ${fmtD(end)} ${timeLabel(timeOf(end))}`}>
            {fmtD(end)} <Text style={styles.sep}>|</Text> {timeLabel(timeOf(end))}
          </Text>
        </View>
      </View>

      {/* Package (P1): 12 hours or whole days, up to the 15-day window + branch hours (#2) */}
      <View style={styles.extras}>
        <PackagePicker
          tone="dark"
          choices={choices}
          selectedHours={pkg.hours}
          onSelect={(hours) => setPkg((r) => ({ ...r, hours }))}
        />
        <BranchHoursLine tone="dark" text={rangeHoursLine(schedule, start, end)} />
        <TimesNotice tone="dark" notice={notice} />
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
        pickupOnly
        returnFor={(p) => packageRangeEnd({ start: p, hours: pkg.hours })}
        onConfirm={(s) => setPkg((r) => ({ ...r, start: withTime(s, timeOf(r.start)) }))}
        onClose={() => setDateOpen(false)}
        maxStartDay={bookingWindowLastDay()}
        isDayClosed={schedule ? (d) => isClosedDay(schedule, d) : undefined}
        noPickupTimes={schedule ? (d) => noPickupTimesLeft(schedule, d) : undefined}
        note={`Bookings open up to ${MAX_BOOKING_DAYS} days ahead`}
      />
      <TimeFieldPicker
        visible={pickupOpen}
        value={timeOf(start)}
        slots={slotsWithinHours(start, schedule, 'pickup', { before: latestPackagePickup() })}
        emptyText={closedDayText(schedule, start)}
        title="Pickup time"
        onSelect={(t) => setPkg((r) => ({ ...r, start: withTime(r.start, t) }))}
        onClose={() => setPickupOpen(false)}
      />
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
  // The return — computed from the package, not a control.
  rowValueFixed: { fontFamily: Fonts.bodyMedium, fontSize: 17, color: Colors.onDarkMuted, letterSpacing: -0.2, flexShrink: 1 },
  dateSeg: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sep: { fontFamily: Fonts.body, fontSize: 16, color: Colors.onDarkMuted },
  dash: { fontFamily: Fonts.body, fontSize: 16, color: Colors.onDarkMuted, marginHorizontal: 2 },
  underline: { height: 1, backgroundColor: Colors.hairlineOnDark, marginLeft: 34 },
  extras: { marginLeft: 34, paddingBottom: 16, gap: 10 },

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
