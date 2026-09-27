import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';
import CameraCapture, { type CapturedSize } from './CameraCapture';

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
  // Returns the uploaded { fileId, url } for the captured image.
  upload: (formData: FormData) => Promise<{ fileId: string; url: string }>;
  genericLabel?: string;
  // Number of shots taken but not yet in `value` (still uploading, or failed
  // and awaiting retry). Lets the screen hold its submit until they land.
  onPendingChange?: (count: number) => void;
}

// A shot that has been taken but isn't in `value` yet.
interface PendingShot {
  key: string;
  uri: string;
  width: number;
  label?: string;
  failed: boolean;
}

export default function PhotoCaptureSection({
  fields,
  allowGeneric = true,
  value,
  onChange,
  upload,
  genericLabel = 'Add photo',
  onPendingChange,
}: Props) {
  // Camera-only on purpose: no gallery, and no confirm step after the shot.
  // A labeled slot opens a single shot; the generic tile stays open for many.
  const [camera, setCamera] = useState<{ label?: string; multiple: boolean } | null>(null);
  const [pending, setPending] = useState<PendingShot[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  // Uploads finish in the background and can overlap, so always build the next
  // list from the latest value rather than the one captured by the closure.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    onPendingChange?.(pending.length);
  }, [pending.length]);

  const failedCount = pending.filter((p) => p.failed).length;
  const uploadingCount = pending.length - failedCount;

  useEffect(() => {
    if (failedCount === 0) setUploadError(null);
  }, [failedCount]);

  const commit = (next: CapturedPhoto[]) => {
    valueRef.current = next;
    onChange(next);
  };

  const startUpload = async (shot: PendingShot) => {
    try {
      // Raw camera output is 3–8 MB and is rejected by the reverse proxy
      // before it reaches the API — always downscale first.
      const file = await prepareImageForUpload(
        { uri: shot.uri, width: shot.width, mimeType: 'image/jpeg' },
        `photo_${shot.key}`,
      );
      const { fileId, url } = await upload(toUploadForm(file));
      if (!mounted.current) return;
      // Replace any existing photo for a labeled slot; append for generic.
      const current = valueRef.current;
      commit(
        shot.label
          ? [...current.filter((p) => p.label !== shot.label), { fileId, url, label: shot.label }]
          : [...current, { fileId, url }],
      );
      setPending((list) => list.filter((p) => p.key !== shot.key));
    } catch (err: any) {
      if (!mounted.current) return;
      setPending((list) => list.map((p) => (p.key === shot.key ? { ...p, failed: true } : p)));
      setUploadError(uploadErrorMessage(err));
    }
  };

  const onShot = (uri: string, size: CapturedSize) => {
    seq.current += 1;
    const shot: PendingShot = {
      key: `${Date.now()}_${seq.current}`,
      uri,
      width: size.width,
      label: camera?.label,
      failed: false,
    };
    setPending((list) => [...list, shot]);
    startUpload(shot);
  };

  const retry = (shot: PendingShot) => {
    const again = { ...shot, failed: false };
    setPending((list) => list.map((p) => (p.key === shot.key ? again : p)));
    startUpload(again);
  };

  const discard = (key: string) => setPending((list) => list.filter((p) => p.key !== key));

  const remove = (fileId: string) => commit(valueRef.current.filter((p) => p.fileId !== fileId));

  const genericPhotos = value.filter((p) => !p.label);
  const genericPending = pending.filter((p) => !p.label);

  const renderPending = (shot: PendingShot) => (
    <View key={shot.key} style={styles.thumbWrap}>
      <Image source={{ uri: shot.uri }} style={styles.thumb} resizeMethod="resize" />
      {shot.failed ? (
        <TouchableOpacity
          style={[styles.shotOverlay, styles.shotOverlayFailed]}
          onPress={() => retry(shot)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
        >
          <Ionicons name="refresh" size={18} color={Colors.white} />
          <Text style={styles.shotOverlayText}>Retry</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.shotOverlay}>
          <ActivityIndicator size="small" color={Colors.white} />
        </View>
      )}
      {shot.failed && (
        <TouchableOpacity style={styles.removeBtn} onPress={() => discard(shot.key)} hitSlop={6}>
          <Ionicons name="close" size={13} color={Colors.white} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.wrap}>
      {/* Config-driven labeled slots */}
      {fields && fields.length > 0 && (
        <View style={styles.slotGrid}>
          {fields.map((f) => {
            const shot = value.find((p) => p.label === f.name);
            const inFlight = pending.find((p) => p.label === f.name);
            return (
              <View key={f.name} style={styles.slot}>
                <View style={styles.slotHeader}>
                  <Text style={styles.slotLabel} numberOfLines={1}>{f.name}</Text>
                  {f.required && !shot && <Text style={styles.req}>required</Text>}
                </View>
                {shot ? (
                  <View style={styles.thumbWrap}>
                    <Image source={{ uri: shot.url }} style={styles.thumb} resizeMethod="resize" />
                    <TouchableOpacity style={styles.removeBtn} onPress={() => remove(shot.fileId)} hitSlop={6}>
                      <Ionicons name="close" size={13} color={Colors.white} />
                    </TouchableOpacity>
                  </View>
                ) : inFlight ? (
                  renderPending(inFlight)
                ) : (
                  <TouchableOpacity
                    style={styles.addTile}
                    onPress={() => setCamera({ label: f.name, multiple: false })}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="camera-outline" size={22} color={Colors.ink3} />
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
              <Image source={{ uri: p.url }} style={styles.thumb} resizeMethod="resize" />
              <TouchableOpacity style={styles.removeBtn} onPress={() => remove(p.fileId)} hitSlop={6}>
                <Ionicons name="close" size={13} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ))}
          {genericPending.map(renderPending)}
          <TouchableOpacity
            style={styles.addTile}
            onPress={() => setCamera({ multiple: true })}
            activeOpacity={0.8}
          >
            <Ionicons name="camera-outline" size={22} color={Colors.ink3} />
            <Text style={styles.addTileText}>{genericLabel}</Text>
          </TouchableOpacity>
        </View>
      )}

      {failedCount > 0 ? (
        <Text style={styles.statusError}>
          {failedCount === 1 ? "1 photo didn't upload" : `${failedCount} photos didn't upload`}
          {` — tap Retry, or remove ${failedCount === 1 ? 'it' : 'them'}.`}
          {uploadError ? ` ${uploadError}` : ''}
        </Text>
      ) : uploadingCount > 0 ? (
        <Text style={styles.status}>
          Uploading {uploadingCount} photo{uploadingCount > 1 ? 's' : ''}…
        </Text>
      ) : null}

      <CameraCapture
        visible={!!camera}
        multiple={camera?.multiple}
        title={camera?.label ?? (fields && fields.length > 0 ? 'More photos' : 'Photos')}
        onCapture={onShot}
        onClose={() => setCamera(null)}
      />
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
  shotOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  shotOverlayFailed: { backgroundColor: 'rgba(220,53,69,0.72)' },
  shotOverlayText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.white },
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
  status: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  statusError: { fontFamily: Fonts.body, fontSize: 12, color: '#dc3545', lineHeight: 17 },
});
