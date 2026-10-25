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
    title: 'Licence & Aadhaar verified', sub: 'Your driving licence and Aadhaar are on file.',
  },
  pending: {
    eyebrow: 'UNDER REVIEW', eyebrowColor: Colors.availLow, icon: 'time-outline',
    title: 'Documents under review', sub: 'We’ll verify your driving licence and Aadhaar shortly.',
  },
  // Both licence photos (Oct 17 2026) and both Aadhaar photos (Oct 25 2026) are
  // required: new bookings can't be made without them; an older booking's
  // photos are captured at pickup if missing.
  none: {
    eyebrow: 'REQUIRED', eyebrowColor: Colors.orange, icon: 'card-outline',
    title: 'Licence & Aadhaar photos', sub: 'Upload both sides of your driving licence and your Aadhaar card. Bring the original licence to pickup.', cta: 'Upload photos',
  },
  rejected: {
    eyebrow: 'ACTION NEEDED', eyebrowColor: Colors.availLow, icon: 'alert-circle-outline',
    title: 'Photo not accepted', sub: 'A licence or Aadhaar photo couldn’t be verified. Upload a clearer photo, and bring the original licence to pickup.', cta: 'Re-upload',
  },
};

// Licence + Aadhaar photo card for upcoming trips, driven by real KYC status.
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
