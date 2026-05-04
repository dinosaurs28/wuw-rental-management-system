import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

type StepIcon = React.ComponentProps<typeof Ionicons>['name'];
const STEPS: { icon: StepIcon; title: string; desc: string }[] = [
  { icon: 'document-text-outline', title: 'Check your trips', desc: 'View full details in My Trips.' },
  { icon: 'call-outline', title: 'Host will contact you', desc: 'Expect a message before pickup.' },
  { icon: 'key-outline', title: 'Pickup', desc: 'Bring your license on the day.' },
];

export default function Confirmation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { holdId } = useLocalSearchParams<{ holdId?: string }>();

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 32 }]}>
      {/* Success illustration */}
      <View style={styles.illustrationContainer}>
        <LinearGradient
          colors={['#fff3ec', '#ffe8db']}
          style={styles.illustration}
        >
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={36} color={Colors.white} />
          </View>
        </LinearGradient>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>
          You're all{'\n'}
          <Text style={styles.titleAccent}>set.</Text>
        </Text>
        <Text style={styles.subtitle}>
          Your booking is confirmed. The host will get in touch shortly.
        </Text>

        {holdId && (
          <View style={styles.refCard}>
            <Text style={styles.refLabel}>Booking reference</Text>
            <Text style={styles.refValue} numberOfLines={1} ellipsizeMode="middle">
              {holdId}
            </Text>
          </View>
        )}

        <View style={styles.steps}>
          {STEPS.map((step) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepIconWrap}>
                <Ionicons name={step.icon} size={18} color={Colors.ink2} />
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>{step.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, paddingHorizontal: 24 },
  illustrationContainer: { marginTop: 24, marginBottom: 32 },
  illustration: {
    height: 180,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  illustrationEmoji: { fontSize: 48, opacity: 0.3, position: 'absolute', top: 20, right: 24 },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  checkIcon: { fontSize: 32, color: Colors.white },
  content: { flex: 1 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 38,
    color: Colors.ink,
    letterSpacing: -1.2,
    lineHeight: 44,
    marginBottom: 12,
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
    marginBottom: 24,
  },
  refCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 28,
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
    letterSpacing: 0.5,
  },
  steps: { gap: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1, paddingTop: 2 },
  stepTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  stepDesc: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    marginTop: 2,
    lineHeight: 19,
  },
  actions: { gap: 12, paddingTop: 16 },
  primaryBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  ghostBtnText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: Colors.ink2,
  },
});
