import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

export type DLStatus = 'none' | 'pending' | 'approved' | 'rejected';

interface Props {
  status: DLStatus;
  onVerify: () => void;
}

const CONFIG: Record<DLStatus, {
  eyebrow: string; eyebrowColor: string; title: string; sub: string; cta?: string; icon: any;
}> = {
  approved: {
    eyebrow: 'VERIFIED', eyebrowColor: Colors.availGood, icon: 'checkmark-circle',
    title: 'Driver’s licence verified', sub: 'Your driving licence is on file.',
  },
  pending: {
    eyebrow: 'UNDER REVIEW', eyebrowColor: Colors.availLow, icon: 'time-outline',
    title: 'Licence under review', sub: 'We’ll verify your driving licence shortly.',
  },
  none: {
    eyebrow: 'ACTION NEEDED', eyebrowColor: Colors.orange, icon: 'shield-outline',
    title: 'Add your driving licence', sub: 'Add your driving licence ahead of your pickup day.', cta: 'Verify now',
  },
  rejected: {
    eyebrow: 'ACTION NEEDED', eyebrowColor: Colors.availNone, icon: 'alert-circle-outline',
    title: 'Licence needs attention', sub: 'Your licence couldn’t be verified — please re-upload it.', cta: 'Re-upload',
  },
};

// "Verify your driver's licence" card, driven by real KYC DL status.
export default function VerifyLicenseCard({ status, onVerify }: Props) {
  const c = CONFIG[status];
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name={c.icon} size={20} color={c.eyebrowColor} />
        <Text style={[styles.eyebrow, { color: c.eyebrowColor }]}>{c.eyebrow}</Text>
      </View>
      <Text style={styles.title}>{c.title}</Text>
      <Text style={styles.sub}>{c.sub}</Text>
      {c.cta ? (
        <TouchableOpacity style={styles.cta} onPress={onVerify} activeOpacity={0.88}>
          <Text style={styles.ctaText}>{c.cta}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  eyebrow: { fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  sub: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.ink3, marginTop: 5, lineHeight: 19 },
  cta: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
