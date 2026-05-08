import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';

export interface UploadedPhoto {
  publicId: string;
  url: string;
}

interface Props {
  photos: UploadedPhoto[];
  onUpload: (formData: FormData) => Promise<UploadedPhoto>;
  onRemove?: (photo: UploadedPhoto) => void;
  /** Tag to include in FormData; identifies which slot the upload belongs to. */
  fileNamePrefix?: string;
  maxPhotos?: number;
  disabled?: boolean;
  /** Tile size in px. Pass `'fill'` for tiles to fill their container's width as a square. */
  tileSize?: number | 'fill';
}

export default function PhotoUploader({
  photos,
  onUpload,
  onRemove,
  fileNamePrefix = 'photo',
  maxPhotos = 8,
  disabled = false,
  tileSize = 84,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<UploadedPhoto | null>(null);

  const reachedMax = photos.length >= maxPhotos;

  const pickFrom = async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', `Please allow ${source} access to upload photos.`);
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'images',
            quality: 0.7,
            allowsEditing: false,
            allowsMultipleSelection: maxPhotos - photos.length > 1,
            selectionLimit: maxPhotos - photos.length,
          });

    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      for (const asset of result.assets) {
        const mimeType = asset.mimeType ?? 'image/jpeg';
        const extMap: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/heic': 'heic',
          'image/webp': 'webp',
        };
        const ext = extMap[mimeType] ?? asset.uri.split('.').pop() ?? 'jpg';
        const fileName = `${fileNamePrefix}_${Date.now()}.${ext}`;

        const form = new FormData();
        form.append('file', { uri: asset.uri, name: fileName, type: mimeType } as any);
        await onUpload(form);
      }
    } catch (err: any) {
      Alert.alert('Upload failed', err.response?.data?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const promptSource = () => {
    if (reachedMax) {
      Alert.alert('Limit reached', `Maximum ${maxPhotos} photos.`);
      return;
    }
    Alert.alert('Add photo', '', [
      { text: 'Camera', onPress: () => pickFrom('camera') },
      { text: 'Photo library', onPress: () => pickFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const fill = tileSize === 'fill';
  const tileStyle = fill
    ? { width: '100%' as const, aspectRatio: 1 }
    : { width: tileSize as number, height: tileSize as number };
  const gridStyle = fill ? styles.gridFill : styles.grid;

  return (
    <View>
      <View style={gridStyle}>
        {photos.map((p) => (
          <TouchableOpacity
            key={p.publicId}
            style={[styles.thumbWrap, tileStyle]}
            onPress={() => setPreview(p)}
            activeOpacity={0.85}
          >
            <Image source={{ uri: p.url }} style={styles.thumb} />
            {onRemove && !disabled && (
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onRemove(p);
                }}
                hitSlop={6}
              >
                <Ionicons name="close" size={12} color={Colors.white} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}

        {!reachedMax && !disabled && (
          <TouchableOpacity
            style={[styles.thumbWrap, styles.addTile, tileStyle]}
            onPress={promptSource}
            disabled={uploading}
            activeOpacity={0.7}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={Colors.orange} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={22} color={Colors.ink3} />
                <Text style={styles.addText}>Add</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {photos.length > 0 && (
        <Text style={styles.countText}>
          {photos.length} of {maxPhotos} photos
        </Text>
      )}

      <Modal
        visible={!!preview}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.previewOverlay}>
          <TouchableWithoutFeedback onPress={() => setPreview(null)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          {preview && <Image source={{ uri: preview.url }} style={styles.previewImg} resizeMode="contain" />}
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreview(null)} hitSlop={10}>
            <Ionicons name="close" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const TILE = 84;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridFill: {
    width: '100%',
  },
  thumbWrap: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0ee',
    position: 'relative',
  },
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
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    borderStyle: 'dashed',
    backgroundColor: Colors.surface,
    gap: 4,
  },
  addText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 11,
    color: Colors.ink3,
  },
  countText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink3,
    marginTop: 8,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImg: {
    width: '92%',
    height: '70%',
  },
  previewClose: {
    position: 'absolute',
    top: 50,
    right: 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
