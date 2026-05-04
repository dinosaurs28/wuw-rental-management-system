import { useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

const { width: SW } = Dimensions.get('window');
const H_PAD = 16;
const CELL = Math.floor((SW - H_PAD * 2) / 7);
const CIRCLE = Math.round(CELL * 0.82);
const BAND_V = Math.round(CELL * 0.12); // vertical inset for the range band

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function sod(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function sameDay(a: Date, b: Date) { return a.getTime() === b.getTime(); }
function fmtShort(d: Date) { return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; }

interface Props {
  visible: boolean;
  startDate: Date;
  endDate: Date;
  onConfirm: (start: Date, end: Date) => void;
  onClose: () => void;
}

export default function DateRangePicker({ visible, startDate, endDate, onConfirm, onClose }: Props) {
  const today = sod(new Date());

  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(startDate.getFullYear(), startDate.getMonth(), 1),
  );
  const [tempStart, setTempStart] = useState(() => sod(startDate));
  const [tempEnd, setTempEnd] = useState(() => sod(endDate));
  const [picking, setPicking] = useState<'start' | 'end'>('start');

  const cells = useMemo<(number | null)[]>(() => {
    const y = displayMonth.getFullYear();
    const m = displayMonth.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [displayMonth]);

  const handleDay = (day: number) => {
    const d = sod(new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day));
    if (d < today) return;
    if (picking === 'start') {
      setTempStart(d);
      setTempEnd(new Date(d.getTime() + 86_400_000));
      setPicking('end');
    } else {
      if (d <= tempStart) {
        setTempStart(d);
        setTempEnd(new Date(d.getTime() + 86_400_000));
      } else {
        setTempEnd(d);
      }
    }
  };

  const prevMonth = () => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1));
  const nextMonth = () => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1));
  const nights = Math.round((tempEnd.getTime() - tempStart.getTime()) / 86_400_000);
  const sameStartEnd = sameDay(tempStart, tempEnd);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Date pills */}
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, picking === 'start' && styles.pillActive]}
              onPress={() => setPicking('start')}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={14} color={picking === 'start' ? Colors.white : Colors.ink3} />
              <View>
                <Text style={[styles.pillSub, picking === 'start' && styles.pillSubActive]}>PICKUP</Text>
                <Text style={[styles.pillDate, picking === 'start' && styles.pillDateActive]}>{fmtShort(tempStart)}</Text>
              </View>
            </TouchableOpacity>

            <Ionicons name="arrow-forward" size={14} color={Colors.ink4} />

            <TouchableOpacity
              style={[styles.pill, picking === 'end' && styles.pillActive]}
              onPress={() => setPicking('end')}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={14} color={picking === 'end' ? Colors.white : Colors.ink3} />
              <View>
                <Text style={[styles.pillSub, picking === 'end' && styles.pillSubActive]}>RETURN</Text>
                <Text style={[styles.pillDate, picking === 'end' && styles.pillDateActive]}>{fmtShort(tempEnd)}</Text>
              </View>
            </TouchableOpacity>
          </View>

          <Text style={styles.nightsLabel}>
            {picking === 'start'
              ? 'Select pickup date'
              : nights > 0
              ? `${nights} night${nights !== 1 ? 's' : ''} · tap return date`
              : 'Select return date'}
          </Text>

          {/* Month nav */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={prevMonth} style={styles.navBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={Colors.ink} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{MONTHS[displayMonth.getMonth()]} {displayMonth.getFullYear()}</Text>
            <TouchableOpacity onPress={nextMonth} style={styles.navBtn} hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          {/* Week headers */}
          <View style={styles.weekRow}>
            {DAYS.map(d => (
              <Text key={d} style={styles.weekDay}>{d}</Text>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={styles.grid}>
            {cells.map((day, i) => {
              if (!day) return <View key={`e-${i}`} style={styles.cell} />;

              const d = sod(new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day));
              const isPast = d < today;
              const isStart = sameDay(d, tempStart);
              const isEnd = sameDay(d, tempEnd);
              const inRange = !sameStartEnd && d > tempStart && d < tempEnd;
              const col = i % 7;
              const isFirstInRow = col === 0;
              const isLastInRow = col === 6;

              // Band segments: left half, right half, or full
              const showLeftBand = (isEnd && !isStart && !isFirstInRow) || (inRange && !isFirstInRow);
              const showRightBand = (isStart && !isEnd && !isLastInRow) || (inRange && !isLastInRow);
              const showFullBand = inRange;
              // Override: in-range cells show full band via left+right, handled below

              return (
                <TouchableOpacity
                  key={day}
                  onPress={() => !isPast && handleDay(day)}
                  activeOpacity={isPast ? 1 : 0.75}
                  style={styles.cell}
                >
                  {/* Range band — full for in-range */}
                  {showFullBand && (
                    <View style={[
                      styles.bandFull,
                      isFirstInRow && styles.bandRoundLeft,
                      isLastInRow && styles.bandRoundRight,
                    ]} />
                  )}
                  {/* Half-bands for start/end edges */}
                  {!showFullBand && showLeftBand && <View style={styles.bandLeft} />}
                  {!showFullBand && showRightBand && <View style={styles.bandRight} />}

                  {/* Circle for start/end */}
                  {(isStart || isEnd) ? (
                    <View style={[styles.circle, isStart ? styles.circleStart : styles.circleEnd]}>
                      <Text style={styles.circleText}>{day}</Text>
                    </View>
                  ) : (
                    <Text style={[
                      styles.cellText,
                      isPast && styles.cellTextPast,
                      inRange && styles.cellTextInRange,
                    ]}>
                      {day}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Confirm */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => { onConfirm(tempStart, tempEnd); onClose(); }}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmText}>Confirm {nights} night{nights !== 1 ? 's' : ''}</Text>
              <Ionicons name="checkmark" size={16} color={Colors.white} />
            </TouchableOpacity>
          </View>
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
    paddingBottom: 36,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.ink4,
    alignSelf: 'center',
    marginTop: 10, marginBottom: 18,
  },

  pillRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: H_PAD, gap: 8, marginBottom: 4,
  },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14,
    padding: 13, borderWidth: 1.5, borderColor: Colors.hairline,
  },
  pillActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  pillSub: { fontFamily: Fonts.bodyMedium, fontSize: 9, color: Colors.ink3, letterSpacing: 0.9, marginBottom: 2 },
  pillSubActive: { color: 'rgba(255,255,255,0.55)' },
  pillDate: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink },
  pillDateActive: { color: Colors.white },

  nightsLabel: {
    fontFamily: Fonts.bodyMedium, fontSize: 12,
    color: Colors.orange, textAlign: 'center', marginBottom: 14,
  },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: H_PAD, marginBottom: 10,
  },
  navBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline,
    alignItems: 'center', justifyContent: 'center',
  },
  monthTitle: { fontFamily: Fonts.displayBold, fontSize: 16, color: Colors.ink, letterSpacing: -0.3 },

  weekRow: { flexDirection: 'row', paddingHorizontal: H_PAD, marginBottom: 2 },
  weekDay: {
    width: CELL, textAlign: 'center',
    fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3,
  },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: H_PAD, marginBottom: 16,
  },
  cell: {
    width: CELL, height: CELL,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'visible',
  },

  // Range bands — sit behind the circle
  bandFull: {
    position: 'absolute',
    top: BAND_V, bottom: BAND_V,
    left: 0, right: 0,
    backgroundColor: Colors.orangeSoft,
  },
  bandLeft: {
    position: 'absolute',
    top: BAND_V, bottom: BAND_V,
    left: 0, right: CELL / 2,
    backgroundColor: Colors.orangeSoft,
  },
  bandRight: {
    position: 'absolute',
    top: BAND_V, bottom: BAND_V,
    left: CELL / 2, right: 0,
    backgroundColor: Colors.orangeSoft,
  },
  bandRoundLeft: { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  bandRoundRight: { borderTopRightRadius: 999, borderBottomRightRadius: 999 },

  // Start / end circles
  circle: {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE,
    alignItems: 'center', justifyContent: 'center',
  },
  circleStart: { backgroundColor: Colors.orange },
  circleEnd: { backgroundColor: Colors.ink },
  circleText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },

  cellText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  cellTextPast: { color: Colors.ink4 },
  cellTextInRange: { color: Colors.orange, fontFamily: Fonts.bodySemiBold },

  footer: { paddingHorizontal: H_PAD },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 15,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  confirmText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white, letterSpacing: 0.2 },
});
