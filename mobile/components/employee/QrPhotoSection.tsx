import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';
import type {
  BookingQrPhotoData,
  CustomerQrPhotoData,
  QrPhoto,
  QrPhotoCustomer,
  QrPhotoSource,
} from '../../types/api';
import ImageViewer from '../ui/ImageViewer';
import CameraCapture, { type CapturedSize } from './CameraCapture';

// Customer QR code photo (#4): a photo of the QR the walk-in customer presents
// (Aadhaar secure QR, DigiLocker…). Stored as an image only — never decoded.
export const QR_PHOTO_LABEL = 'Customer QR code photo';
export const QR_PHOTO_HELPER = 'e.g. Aadhaar or DigiLocker QR';

export type QrPhotoTarget =
  | { kind: 'customer'; publicId: string } // customer's current photo (User.publicId)
  | { kind: 'booking'; bookingId: string }; // booking snapshot, else customer's current

// Both endpoints, normalised to one shape.
export interface QrPhotoState {
  customer: QrPhotoCustomer;
  qrPhoto: QrPhoto | null;
  // Booking level: where the photo came from. Customer level: always the
  // customer's current photo.
  source: QrPhotoSource;
  canReplace: boolean;
}

export const qrPhotoQueryKey = (target: QrPhotoTarget) =>
  target.kind === 'customer'
    ? ['employee', 'qr-photo', 'customer', target.publicId]
    : ['employee', 'qr-photo', 'booking', target.bookingId];

function normalise(target: QrPhotoTarget, data: CustomerQrPhotoData | BookingQrPhotoData): QrPhotoState {
  if (target.kind === 'booking') {
    const d = data as BookingQrPhotoData;
    return { customer: d.customer, qrPhoto: d.qrPhoto ?? null, source: d.source ?? null, canReplace: !!d.canReplace };
  }
  const d = data as CustomerQrPhotoData;
  return {
    customer: d.customer,
    qrPhoto: d.qrPhoto ?? null,
    source: d.qrPhoto ? 'CUSTOMER' : null,
    canReplace: true,
  };
}

/** The QR photo for a customer or booking. URLs are presigned for 15 minutes. */
export function useQrPhoto(target: QrPhotoTarget | null) {
  return useQuery<QrPhotoState>({
    queryKey: target ? qrPhotoQueryKey(target) : ['employee', 'qr-photo', 'none'],
    queryFn: async () => {
      const t = target!;
      const res = t.kind === 'customer'
        ? await employeeApi.getCustomerQrPhoto(t.publicId)
        : await employeeApi.getBookingQrPhoto(t.bookingId);
      return normalise(t, res.data?.data);
    },
    enabled: !!target,
    staleTime: 5 * 60_000,
    // Keep the presigned URL fresh while the screen stays open.
    refetchInterval: 12 * 60_000,
    retry: 1,
  });
}

function fmtCaptured(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// The server explains 400s (INVALID_IMAGE, IMAGE_TOO_SMALL…) and 409
// QR_PHOTO_FROZEN itself; the shared helper covers proxy 413s and timeouts.
function qrUploadError(err: any): string {
  const status = err?.response?.status;
  const message = err?.response?.data?.message;
  if (status && status !== 413 && typeof message === 'string' && message) return message;
  return uploadErrorMessage(err, 'Could not upload the QR code photo.');
}

interface PendingShot {
  uri: string;
  width: number;
  failed: boolean;
}

interface Props {
  target: QrPhotoTarget;
  // Fired with the current photo once it loads and whenever it changes.
  onChange?: (photo: QrPhoto | null) => void;
  // Walk-in flow: mark the card as required until a photo is on file.
  required?: boolean;
  // Customer details: allow clearing the customer's current photo.
  allowRemove?: boolean;
}

/**
 * Card that shows, captures (camera only) and replaces the customer QR code
 * photo. The screen renders its own section title (QR_PHOTO_LABEL).
 */
export default function QrPhotoSection({ target, onChange, required = false, allowRemove = false }: Props) {
  const qc = useQueryClient();
  const key = qrPhotoQueryKey(target);
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQrPhoto(target);

  const [camera, setCamera] = useState(false);
  const [pending, setPending] = useState<PendingShot | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const reloadedFor = useRef<string | null>(null);
  const mounted = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => () => { mounted.current = false; }, []);

  const photo = data?.qrPhoto ?? null;
  const canReplace = data?.canReplace ?? false;
  const uploading = !!pending && !pending.failed;

  // Report the server's view once known (the photo, or null), then on changes.
  const loaded = !!data;
  const photoId = photo?.publicId ?? null;
  useEffect(() => {
    if (loaded) onChangeRef.current?.(photo);
  }, [loaded, photoId]);

  // Other views of the same photo: the staff customer detail carries it, and a
  // new customer-level photo is what bookings without a snapshot now show.
  const invalidateRelated = (customerPublicId: string | undefined) => {
    if (customerPublicId) {
      qc.invalidateQueries({ queryKey: ['employee', 'customer', customerPublicId] });
      if (target.kind === 'booking') {
        qc.invalidateQueries({ queryKey: ['employee', 'qr-photo', 'customer', customerPublicId] });
      }
    }
    if (target.kind === 'customer') {
      qc.invalidateQueries({ queryKey: ['employee', 'qr-photo', 'booking'] });
    }
  };

  const post = (form: FormData) =>
    target.kind === 'customer'
      ? employeeApi.uploadCustomerQrPhoto(target.publicId, form)
      : employeeApi.uploadBookingQrPhoto(target.bookingId, form);

  const startUpload = async (shot: PendingShot) => {
    setPending({ ...shot, failed: false });
    setUploadError(null);
    try {
      const asset = { uri: shot.uri, width: shot.width, mimeType: 'image/jpeg' };
      let res;
      try {
        res = await post(toUploadForm(await prepareImageForUpload(asset, `qr_${Date.now()}`, 'qr')));
      } catch (err: any) {
        // The sharper QR profile can trip a tight proxy limit — retry once at
        // the standard size before giving up.
        if (err?.response?.status !== 413) throw err;
        res = await post(toUploadForm(await prepareImageForUpload(asset, `qr_${Date.now()}`, 'standard')));
      }
      if (!mounted.current) return;
      const next = normalise(target, res.data?.data);
      qc.setQueryData<QrPhotoState>(key, next);
      setPending(null);
      setBrokenUrl(null);
      invalidateRelated(next.customer?.publicId);
    } catch (err: any) {
      if (!mounted.current) return;
      setUploadError(qrUploadError(err));
      if (err?.response?.data?.code === 'QR_PHOTO_FROZEN') {
        // Picked up meanwhile: retrying can't succeed, so drop the shot and
        // reload to hide Retake.
        setPending(null);
        refetch();
        return;
      }
      setPending({ ...shot, failed: true });
    }
  };

  const onShot = (uri: string, size: CapturedSize) => {
    startUpload({ uri, width: size.width, failed: false });
  };

  const remove = () => {
    if (target.kind !== 'customer' || !photo) return;
    Alert.alert(
      'Remove QR code photo',
      "Remove this customer's QR code photo? Bookings that already captured it keep their copy.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              const res = await employeeApi.deleteCustomerQrPhoto(target.publicId);
              if (!mounted.current) return;
              const d = res.data?.data as CustomerQrPhotoData | undefined;
              qc.setQueryData<QrPhotoState>(key, (prev) => ({
                customer: d?.customer ?? prev!.customer,
                qrPhoto: null,
                source: null,
                canReplace: true,
              }));
              invalidateRelated(target.publicId);
            } catch (err: any) {
              Alert.alert('Could not remove', err?.response?.data?.message ?? 'Could not remove the QR code photo.');
              if (err?.response?.data?.code === 'QR_PHOTO_NOT_FOUND') refetch();
            } finally {
              if (mounted.current) setRemoving(false);
            }
          },
        },
      ],
    );
  };

  // A presigned URL that has (nearly) lapsed is refreshed before zooming.
  const openViewer = async () => {
    if (!photo) return;
    const ttlMs = Math.max(60, (photo.expiresIn || 900) - 60) * 1000;
    if (Date.now() - dataUpdatedAt > ttlMs) await refetch();
    if (mounted.current) setViewerOpen(true);
  };

  // The thumbnail failed (most likely an expired URL): refresh once per photo.
  const onThumbError = () => {
    if (!photo) return;
    setBrokenUrl(photo.url);
    if (reloadedFor.current === photo.publicId) return;
    reloadedFor.current = photo.publicId;
    refetch();
  };

  const busy = uploading || removing;
  const fromCustomer = target.kind === 'booking' && data?.source === 'CUSTOMER';

  const renderThumb = () => {
    if (pending) {
      return (
        <View style={styles.thumbWrap}>
          <Image source={{ uri: pending.uri }} style={styles.thumb} resizeMethod="resize" />
          {pending.failed ? (
            <TouchableOpacity
              style={[styles.overlay, styles.overlayFailed]}
              onPress={() => startUpload(pending)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry upload"
            >
              <Ionicons name="refresh" size={18} color={Colors.white} />
              <Text style={styles.overlayText}>Retry</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.overlay}>
              <ActivityIndicator size="small" color={Colors.white} />
            </View>
          )}
        </View>
      );
    }
    if (photo && brokenUrl !== photo.url) {
      return (
        <TouchableOpacity
          style={styles.thumbWrap}
          onPress={openViewer}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="View QR code photo"
        >
          <Image
            source={{ uri: photo.url }}
            style={styles.thumb}
            resizeMethod="resize"
            onError={onThumbError}
          />
          <View style={styles.zoomBadge}>
            <Ionicons name="expand-outline" size={11} color={Colors.white} />
          </View>
        </TouchableOpacity>
      );
    }
    if (photo) {
      return (
        <TouchableOpacity
          style={[styles.thumbWrap, styles.emptyTile]}
          onPress={() => { reloadedFor.current = null; setBrokenUrl(null); refetch(); }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Reload QR code photo"
        >
          <Ionicons name="image-outline" size={22} color={Colors.ink4} />
          <Text style={styles.emptyTileText}>Reload</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.thumbWrap, styles.emptyTile]}
        onPress={() => setCamera(true)}
        disabled={!canReplace || busy}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Capture QR code photo"
      >
        <Ionicons name="qr-code-outline" size={24} color={Colors.ink3} />
      </TouchableOpacity>
    );
  };

  const statusTitle = pending
    ? pending.failed ? 'Upload failed' : 'Uploading…'
    : photo
      ? fromCustomer ? "Customer's current QR photo" : 'Captured'
      : 'Not captured';

  return (
    <View style={styles.card}>
      <View style={styles.helperRow}>
        <Ionicons name="qr-code-outline" size={15} color={Colors.ink3} />
        <Text style={styles.helper}>{QR_PHOTO_HELPER}</Text>
        {required && !photo && (
          <View style={styles.reqPill}>
            <Text style={styles.reqText}>Required</Text>
          </View>
        )}
        {!!photo && !pending && <Ionicons name="checkmark-circle" size={16} color="#059669" />}
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} />
      ) : isError && !data ? (
        <View style={styles.loadError}>
          <Text style={styles.loadErrorText}>
            {(error as any)?.response?.data?.message ?? 'Could not load the QR code photo.'}
          </Text>
          <TouchableOpacity onPress={() => refetch()} hitSlop={8}>
            <Text style={styles.link}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          {renderThumb()}
          <View style={styles.info}>
            <Text style={styles.status}>{statusTitle}</Text>
            {!!photo && !pending && (
              <Text style={styles.meta}>{fmtCaptured(photo.capturedAt)}</Text>
            )}
            {fromCustomer && !pending && (
              <Text style={styles.note}>Not captured for this booking</Text>
            )}
            {!photo && !pending && canReplace && (
              <Text style={styles.meta}>Photograph the QR the customer shows.</Text>
            )}
            {!canReplace && !pending && (
              <Text style={styles.meta}>
                {photo ? 'Can only be replaced' : 'Can only be captured'} while the booking is on hold or confirmed.
              </Text>
            )}

            <View style={styles.actions}>
              {pending?.failed ? (
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setPending(null)} activeOpacity={0.8}>
                  <Text style={styles.ghostBtnText}>Discard</Text>
                </TouchableOpacity>
              ) : canReplace && !pending ? (
                <TouchableOpacity
                  style={[photo ? styles.ghostBtn : styles.primaryBtn, busy && styles.disabled]}
                  onPress={() => setCamera(true)}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  <Ionicons name="camera-outline" size={15} color={photo ? Colors.ink : Colors.white} />
                  <Text style={photo ? styles.ghostBtnText : styles.primaryBtnText}>
                    {photo ? 'Retake' : 'Capture'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {allowRemove && target.kind === 'customer' && !!photo && !pending && (
                <TouchableOpacity
                  style={[styles.removeBtn, busy && styles.disabled]}
                  onPress={remove}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  {removing
                    ? <ActivityIndicator size="small" color="#dc2626" />
                    : <Ionicons name="trash-outline" size={15} color="#dc2626" />}
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}

      {!!uploadError && <Text style={styles.uploadError}>{uploadError}</Text>}

      <CameraCapture
        visible={camera}
        title="Customer QR code"
        onCapture={onShot}
        onClose={() => setCamera(false)}
      />

      <ImageViewer
        visible={viewerOpen && !!photo}
        images={photo ? [{ url: photo.url, label: QR_PHOTO_LABEL }] : []}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

const TILE = 84;
const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    gap: 12,
  },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  helper: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, flex: 1 },
  reqPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  reqText: { fontFamily: Fonts.bodySemiBold, fontSize: 10, color: '#b45309' },
  loader: { alignSelf: 'flex-start', marginVertical: 8 },

  loadError: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadErrorText: { fontFamily: Fonts.body, fontSize: 13, color: '#dc2626', flex: 1 },
  link: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },

  body: { flexDirection: 'row', gap: 14 },
  thumbWrap: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.bg,
  },
  thumb: { width: '100%', height: '100%' },
  zoomBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  overlayFailed: { backgroundColor: 'rgba(220,53,69,0.72)' },
  overlayText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.white },
  emptyTile: {
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  emptyTileText: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.ink3 },

  info: { flex: 1, gap: 3 },
  status: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: '#b45309' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.white },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  removeBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc2626' },
  disabled: { opacity: 0.5 },

  uploadError: { fontFamily: Fonts.body, fontSize: 12, color: '#dc2626', lineHeight: 17 },
});
