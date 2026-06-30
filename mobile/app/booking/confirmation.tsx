import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

type StepIcon = React.ComponentProps<typeof Ionicons>['name'];
const STEPS: { icon: StepIcon; title: string; desc: string }[] = [
  { icon: 'document-text-outline', title: 'Check your booking',  desc: 'Full details are saved in My Trips.' },
  { icon: 'card-outline',          title: 'Verify your licence', desc: 'Add your driving licence ahead of pickup day.' },
  { icon: 'key-outline',           title: 'Collect your car',    desc: 'Bring your driving licence on pickup day.' },
];

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDateTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function inr(v?: string) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? `₹${n.toLocaleString('en-IN')}` : null;
}

export default function Confirmation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { holdId, make, model, start, end, total, deposit, payNow, remaining, flow, coupon } =
    useLocalSearchParams<{
      holdId?: string;
      make?: string;
      model?: string;
      start?: string;
      end?: string;
      total?: string;
      deposit?: string;
      payNow?: string;
      remaining?: string;
      flow?: string;
      coupon?: string;
    }>();

  const isAdvance = flow === 'ADVANCE' && Number(remaining) > 0;
  const vehicleName = [make, model].filter(Boolean).join(' ');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Success illustration — green check (universal "confirmed") */}
        <LinearGradient colors={['#eafaf0', '#d7f5e3']} style={styles.illustration}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={36} color={Colors.white} />
          </View>
        </LinearGradient>

        {/* Heading */}
        <Text style={styles.title}>
          You're all{'\n'}
          <Text style={styles.titleAccent}>set.</Text>
        </Text>
        <Text style={styles.subtitle}>
          Your reservation is confirmed — all the details are saved in My Trips.
        </Text>

        {/* Booking summary */}
        {(vehicleName || holdId) && (
          <View style={styles.summaryCard}>
            {vehicleName ? <Text style={styles.summaryVehicle}>{vehicleName}</Text> : null}
            {(start || end) && (
              <View style={styles.summaryDates}>
                <Ionicons name="calendar-outline" size={14} color={Colors.ink3} />
                <Text style={styles.summaryDatesText}>
                  {fmtDateTime(start)}{end ? `  →  ${fmtDateTime(end)}` : ''}
                </Text>
              </View>
            )}

            <View style={styles.summaryDivider} />

            {coupon ? (
              <SummaryRow label="Coupon applied" value={coupon} accent />
            ) : null}
            {inr(deposit) ? <SummaryRow label="Deposit (refundable)" value={inr(deposit)!} /> : null}
            {inr(total) ? <SummaryRow label="Booking total" value={inr(total)!} /> : null}
            {inr(payNow) ? (
              <SummaryRow label={isAdvance ? 'Paid now (advance)' : 'Paid'} value={inr(payNow)!} bold />
            ) : null}
            {isAdvance && inr(remaining) ? (
              <SummaryRow label="Due at pickup" value={inr(remaining)!} />
            ) : null}
          </View>
        )}

        {/* Booking reference */}
        {holdId && (
          <View style={styles.refCard}>
            <Text style={styles.refLabel}>Booking reference</Text>
            <Text style={styles.refValue} numberOfLines={1} ellipsizeMode="middle">
              {holdId}
            </Text>
          </View>
        )}

        {/* Next steps */}
        <Text style={styles.sectionLabel}>What's next</Text>
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepLeft}>
                <View style={styles.stepIconWrap}>
                  <Ionicons name={step.icon} size={18} color={Colors.ink2} />
                </View>
                {i < STEPS.length - 1 && <View style={styles.stepLine} />}
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>{step.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Fixed bottom actions */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/trips')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>View my trips</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => router.replace('/(tabs)')}
          activeOpacity={0.8}
        >
          <Text style={styles.ghostBtnText}>Back to Browse</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryRow({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryRowLabel}>{label}</Text>
      <Text style={[styles.summaryRowValue, bold && styles.summaryRowValueBold, accent && styles.summaryRowValueAccent]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  summaryVehicle: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  summaryDates: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  summaryDatesText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  summaryDivider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  summaryRowLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  summaryRowValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  summaryRowValueBold: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink, letterSpacing: -0.3 },
  summaryRowValueAccent: { color: Colors.orange, fontFamily: Fonts.bodySemiBold },

  scroll: { paddingHorizontal: 24, paddingBottom: 24 },

  illustration: {
    height: 160,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 28,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.availGood,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },

  title: {
    fontFamily: Fonts.display,
    fontSize: 36,
    color: Colors.ink,
    letterSpacing: -1.2,
    lineHeight: 42,
    marginBottom: 10,
  },
  titleAccent: {
    fontFamily: Fonts.displayItalic,
    color: Colors.orange,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    lineHeight: 22,
    marginBottom: 20,
  },

  refCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  refLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  refValue: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: 0.3,
  },

  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 16,
  },

  steps: { gap: 0 },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepLeft: { alignItems: 'center', width: 36 },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: Colors.hairline,
    marginVertical: 4,
    minHeight: 16,
  },
  stepText: { flex: 1, paddingBottom: 20, paddingTop: 2 },
  stepTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  stepDesc: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    marginTop: 2,
    lineHeight: 19,
  },

  actions: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 10,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  primaryBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    color: Colors.ink3,
  },
});
