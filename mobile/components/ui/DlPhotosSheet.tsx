import { Modal, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { KycDocument, KycSide } from '../../types/api';

export const DL_PHOTOS_ALERT_MESSAGE =
  'Original DL and Safety Deposit will be collected during the vehicle pickup';

/** True when both DL sides (FRONT + BACK) are present in the document list. */
export function hasBothDlSides(docs: Pick<KycDocument, 'type' | 'side'>[] | undefined): boolean {
  if (!docs) return false;
  const sides = new Set(docs.filter((d) => d.type === 'DL').map((d) => d.side));
  return sides.has('FRONT') && sides.has('BACK');
}

/**
 * True only on the transition: the upload of `side` completes the DL pair that
 * was not complete before it (`before` = documents prior to the upload).
 */
export function dlPairCompletedByUpload(
  before: Pick<KycDocument, 'type' | 'side'>[] | undefined,
  type: string,
  side: KycSide,
): boolean {
  if (type !== 'DL' || hasBothDlSides(before)) return false;
  return hasBothDlSides([...(before ?? []), { type: 'DL', side } as Pick<KycDocument, 'type' | 'side'>]);
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Bottom sheet (about 40% of the screen) shown once a customer's DL photos are both uploaded. */
export default function DlPhotosSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={30} color={Colors.orange} />
          </View>
          <Text style={styles.title}>Licence photos received</Text>
          <Text style={styles.message}>{DL_PHOTOS_ALERT_MESSAGE}</Text>
          <TouchableOpacity style={styles.btn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.btnText}>Ok, Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    minHeight: '34%',
    maxHeight: '60%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
    gap: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 8 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange + '18',
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4, textAlign: 'center' },
  message: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  btn: { width: '100%', paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: Colors.orange, marginTop: 'auto' },
  btnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
