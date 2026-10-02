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
  // X2 — a licence PHOTO is optional (pickup needs the DL number on the profile
  // and the original card), so these two never read as a blocker.
  none: {
    eyebrow: 'OPTIONAL', eyebrowColor: Colors.ink3, icon: 'card-outline',
    title: 'Licence photo', sub: 'Uploading a photo of your driving licence is optional. Bring the original licence to pickup.', cta: 'Upload photo',
  },
  rejected: {
    eyebrow: 'OPTIONAL', eyebrowColor: Colors.availLow, icon: 'alert-circle-outline',
    title: 'Licence photo not accepted', sub: 'Your licence photo couldn’t be verified. You can re-upload it — it isn’t needed for pickup. Bring the original licence.', cta: 'Re-upload',
  },
};

// Licence photo card for upcoming trips, driven by real KYC DL status.
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
