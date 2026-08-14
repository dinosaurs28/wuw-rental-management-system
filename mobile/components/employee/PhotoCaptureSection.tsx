import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';

export interface CapturedPhoto {
  fileId: string;
  url: string;
  label?: string;
}

export interface CaptureField {
  name: string;
  required: boolean;
}

interface Props {
  // Config-driven labeled slots (e.g. "Front", "Odometer"). Omit for free-form.
  fields?: CaptureField[];
  // Whether to allow extra, unlabeled photos beyond the configured fields.
  allowGeneric?: boolean;
  value: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  // Returns the uploaded { fileId, url } for the picked image.
  upload: (formData: FormData) => Promise<{ fileId: string; url: string }>;
  genericLabel?: string;
}

export default function PhotoCaptureSection({
  fields,
  allowGeneric = true,
  value,
  onChange,
  upload,
  genericLabel = 'Add photo',
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library'): Promise<ImagePicker.ImagePickerAsset | null> => {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera access needed', 'Enable camera access to take photos.');
        return null;
      }
      // quality 1: prepareImageForUpload re-encodes anyway, so compressing
      // here only adds a second decode/encode pass.
      const r = await ImagePicker.launchCameraAsync({ quality: 1 });
      return r.canceled ? null : r.assets[0] ?? null;
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    return r.canceled ? null : r.assets[0] ?? null;
  };

  const capture = (slotKey: string, label?: string) => {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => run(slotKey, 'camera', label) },
      { text: 'Choose from gallery', onPress: () => run(slotKey, 'library', label) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const run = async (slotKey: string, source: 'camera' | 'library', label?: string) => {
    const asset = await pick(source);
    if (!asset) return;
    setBusy(slotKey);
    try {
      // Raw camera output is 3–8 MB and is rejected by the reverse proxy
      // before it reaches the API — always downscale first.
      const file = await prepareImageForUpload(asset, `photo_${Date.now()}`);
      const form = toUploadForm(file);
      const { fileId, url } = await upload(form);
      // Replace any existing photo for a labeled slot; append for generic.
      const next = label
        ? [...value.filter((p) => p.label !== label), { fileId, url, label }]
        : [...value, { fileId, url }];
      onChange(next);
    } catch (err: any) {
      Alert.alert('Upload failed', uploadErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = (fileId: string) => onChange(value.filter((p) => p.fileId !== fileId));

  const genericPhotos = value.filter((p) => !p.label);

  return (
    <View style={styles.wrap}>
      {/* Config-driven labeled slots */}
      {fields && fields.length > 0 && (
        <View style={styles.slotGrid}>
          {fields.map((f) => {
            const shot = value.find((p) => p.label === f.name);
            const key = `label:${f.name}`;
            return (
              <View key={f.name} style={styles.slot}>
                <View style={styles.slotHeader}>
                  <Text style={styles.slotLabel} numberOfLines={1}>{f.name}</Text>
                  {f.required && !shot && <Text style={styles.req}>required</Text>}
                </View>
                {shot ? (
                  <View style={styles.thumbWrap}>
                    <Image source={{ uri: shot.url }} style={styles.thumb} />
                    <TouchableOpacity style={styles.removeBtn} onPress={() => remove(shot.fileId)} hitSlop={6}>
                      <Ionicons name="close" size={13} color={Colors.white} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.addTile} onPress={() => capture(key, f.name)} disabled={busy === key} activeOpacity={0.8}>
                    {busy === key ? (
                      <ActivityIndicator size="small" color={Colors.orange} />
                    ) : (
                      <Ionicons name="camera-outline" size={22} color={Colors.ink3} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Generic photos */}
      {allowGeneric && (
        <View style={styles.genericGrid}>
          {genericPhotos.map((p) => (
            <View key={p.fileId} style={styles.thumbWrap}>
              <Image source={{ uri: p.url }} style={styles.thumb} />
              <TouchableOpacity style={styles.removeBtn} onPress={() => remove(p.fileId)} hitSlop={6}>
                <Ionicons name="close" size={13} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addTile} onPress={() => capture('generic')} disabled={busy === 'generic'} activeOpacity={0.8}>
            {busy === 'generic' ? (
              <ActivityIndicator size="small" color={Colors.orange} />
            ) : (
              <>
                <Ionicons name="add" size={22} color={Colors.ink3} />
                <Text style={styles.addTileText}>{genericLabel}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const TILE = 84;
const styles = StyleSheet.create({
  wrap: { gap: 12 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { width: TILE },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  slotLabel: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink2, flex: 1 },
  req: { fontFamily: Fonts.bodyMedium, fontSize: 9, color: '#dc3545' },
  genericGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: TILE, height: TILE, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    borderStyle: 'dashed',
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  addTileText: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.ink3 },
});
