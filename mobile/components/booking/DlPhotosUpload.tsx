import { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';
import { describeKycPhotoSides, kycPhotosState, type KycPhotoSide, type KycPhotoType } from '../../lib/kycPhotos';
import DlPhotosSheet, { dlPairCompletedByUpload } from '../ui/DlPhotosSheet';
import type { KycDocument } from '../../types/api';

type DlPhotoSide = KycPhotoSide;

const SIDE_LABEL: Record<DlPhotoSide, string> = { FRONT: 'Front', BACK: 'Back' };

/** Per-document copy: the licence (Oct 17 2026) and the Aadhaar (Oct 25 2026). */
const COPY: Record<KycPhotoType, { hint: Record<DlPhotoSide, string>; short: string; failed: string; okText: string }> = {
  DL: {
    hint: { FRONT: 'Photo and licence number', BACK: 'Address / vehicle classes' },
    short: 'licence',
    failed: 'Could not upload the licence photo.',
    okText: 'Attached to this booking. Bring your original licence to pickup.',
  },
  AADHAAR: {
    hint: { FRONT: 'Photo and Aadhaar number', BACK: 'Address side' },
    short: 'Aadhaar',
    failed: 'Could not upload the Aadhaar photo.',
    okText: 'Both sides of your Aadhaar are on file.',
  },
};

interface Props {
  /** The customer's KYC documents (['kyc'] query). */
  docs: KycDocument[] | undefined;
  /** When set, tapping upload runs this instead (e.g. the profile is incomplete). */
  onBlocked?: () => void;
  /** The document to upload: the driving licence (default) or the Aadhaar. */
  type?: KycPhotoType;
}

/**
 * Checkout step: both driving licence photos (Oct 17 2026) and both Aadhaar
 * photos (Oct 25 2026) are required to book — one of these per document.
 * Uploads either side inline — a side staff rejected is replaced — and
 * refreshes the ['kyc'] query; the parent blocks payment until
 * requiredKycPhotosState(docs).ok and attaches the DL front.
 */
export default function DlPhotosUpload({ docs, onBlocked, type = 'DL' }: Props) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState<DlPhotoSide | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dl = kycPhotosState(type, docs);
  const copy = COPY[type];

  const upload = async (side: DlPhotoSide) => {
    if (onBlocked) {
      onBlocked();
      return;
    }
    // quality 1: prepareImageForUpload re-encodes anyway (see the profile tab)
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, allowsEditing: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setUploading(side);
    try {
      const file = await prepareImageForUpload(asset, `kyc_${type.toLowerCase()}_${side.toLowerCase()}_${Date.now()}`);
      const completesPair = dlPairCompletedByUpload(docs, type, side);
      await userApi.uploadKyc(toUploadForm(file, { type, side }));
      await queryClient.invalidateQueries({ queryKey: ['kyc'] });
      if (completesPair) setSheetOpen(true);
    } catch (err: any) {
      Alert.alert('Upload failed', uploadErrorMessage(err, copy.failed));
      if (err?.response?.status === 409) void queryClient.invalidateQueries({ queryKey: ['kyc'] });
    } finally {
      setUploading(null);
    }
  };

  return (
    <View style={[styles.card, !dl.ok && styles.cardMissing]}>
      <DlPhotosSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
      <View style={styles.slots}>
        {(['FRONT', 'BACK'] as DlPhotoSide[]).map((side) => {
          const doc = side === 'FRONT' ? dl.front : dl.back;
          const rejected = dl.rejectedSides.includes(side);
          const busy = uploading === side;
          return (
            <View key={side} style={styles.slot}>
              <View style={styles.slotTop}>
                <Text style={styles.slotLabel}>{SIDE_LABEL[side]}</Text>
                {doc ? (
                  <View style={styles.doneRow}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.availGood} />
                    <Text style={styles.doneText}>{doc.status === 'APPROVED' ? 'Verified' : 'Uploaded'}</Text>
                  </View>
                ) : null}
              </View>
              {doc?.file?.url ? (
                <Image source={{ uri: doc.file.url }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Text style={[styles.hint, rejected && styles.hintRejected]}>
                    {rejected ? 'Rejected — upload a clearer photo' : copy.hint[side]}
                  </Text>
                </View>
              )}
              {!doc ? (
                <TouchableOpacity
                  style={[styles.uploadBtn, !!uploading && styles.uploadBtnBusy]}
                  onPress={() => upload(side)}
                  disabled={!!uploading}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Upload ${copy.short} ${SIDE_LABEL[side].toLowerCase()}`}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <>
                      <Ionicons name={rejected ? 'refresh' : 'cloud-upload-outline'} size={14} color={Colors.white} />
                      <Text style={styles.uploadBtnText}>{rejected ? 'Replace' : 'Upload'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={[styles.footer, dl.ok ? styles.footerOk : styles.footerMissing]}>
        {dl.ok
          ? copy.okText
          : `Upload the ${describeKycPhotoSides(dl.missingSides)} of your ${copy.short} to continue.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 12,
    gap: 10,
  },
  cardMissing: { borderColor: Colors.orange + '66' },
  slots: { flexDirection: 'row', gap: 10 },
  slot: { flex: 1, gap: 8 },
  slotTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneText: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.availGood },
  thumb: { width: '100%', height: 84, borderRadius: 10, backgroundColor: Colors.bg },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, textAlign: 'center' },
  hintRejected: { color: Colors.availNone },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 10,
  },
  uploadBtnBusy: { opacity: 0.7 },
  uploadBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.white },
  footer: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17 },
  footerOk: { color: Colors.availGood },
  footerMissing: { color: '#b45309' },
});
