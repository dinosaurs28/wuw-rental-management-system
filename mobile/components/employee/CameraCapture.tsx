import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

export interface CapturedSize {
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  // Fired as soon as a shot is saved — there is deliberately no preview or
  // accept/retake step. `size` lets the caller downscale before uploading.
  onCapture: (uri: string, size: CapturedSize) => void;
  // Stay open for several shots ("Done (N)"); otherwise close after one.
  multiple?: boolean;
  // Shown top-centre, e.g. the photo slot being captured ("Front", "Odometer").
  title?: string;
}

const FLASH_CYCLE: FlashMode[] = ['off', 'auto', 'on'];

export default function CameraCapture({ visible, onClose, onCapture, multiple = false, title }: Props) {
  // Android's Modal copies the activity's status-bar appearance at the moment
  // it opens, so switch to light icons one frame before presenting.
  const [presented, setPresented] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPresented(false);
      return;
    }
    const frame = requestAnimationFrame(() => setPresented(true));
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <>
      {visible && <StatusBar style="light" />}
      <Modal
        visible={presented}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onClose}
      >
        <CameraScreen onClose={onClose} onCapture={onCapture} multiple={multiple} title={title} />
      </Modal>
    </>
  );
}

// Mounted only while the modal is open, so every opening starts fresh
// (permission check, shot count, last thumbnail).
function CameraScreen({ onClose, onCapture, multiple, title }: Omit<Props, 'visible'>) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const takingRef = useRef(false);
  const askedRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [shots, setShots] = useState(0);
  const [lastUri, setLastUri] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const shutterScale = useRef(new Animated.Value(1)).current;
  const thumbScale = useRef(new Animated.Value(1)).current;

  const granted = !!permission?.granted;

  // The user just tapped a camera tile, so ask straight away (once per opening).
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || askedRef.current) return;
    askedRef.current = true;
    setAsking(true);
    requestPermission()
      .catch(() => undefined)
      .finally(() => setAsking(false));
  }, [permission]);

  // Coming back from system Settings — re-read the permission.
  useEffect(() => {
    if (granted) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission();
    });
    return () => sub.remove();
  }, [granted]);

  useEffect(() => {
    if (!captureError) return;
    const t = setTimeout(() => setCaptureError(null), 2500);
    return () => clearTimeout(t);
  }, [captureError]);

  const canShoot = granted && ready && !mountError;

  const shoot = async () => {
    const camera = cameraRef.current;
    if (!canShoot || !camera || takingRef.current) return;
    takingRef.current = true;
    setTaking(true);
    // iOS ignores the duration and buzzes for ~400ms, which is too heavy per
    // shot — the native shutter sound + flash is the feedback there.
    if (Platform.OS === 'android') Vibration.vibrate(20);
    let closing = false;
    try {
      // 0.7 keeps the on-device JPEG encode quick; the caller downsizes again
      // before upload anyway.
      const pic = await camera.takePictureAsync({ quality: 0.7 });
      if (!pic?.uri) throw new Error('No picture returned');
      onCapture(pic.uri, { width: pic.width, height: pic.height });
      if (!multiple) {
        // Stay locked so a second tap can't fire while the modal closes.
        closing = true;
        onClose();
        return;
      }
      setShots((n) => n + 1);
      setLastUri(pic.uri);
      thumbScale.setValue(0.6);
      Animated.spring(thumbScale, { toValue: 1, speed: 24, bounciness: 8, useNativeDriver: true }).start();
    } catch {
      setCaptureError("Couldn't take the photo. Try again.");
    } finally {
      if (!closing) {
        takingRef.current = false;
        setTaking(false);
      }
    }
  };

  const pressIn = () =>
    Animated.timing(shutterScale, { toValue: 0.88, duration: 80, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(shutterScale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }).start();

  const cycleFlash = () =>
    setFlash((f) => FLASH_CYCLE[(FLASH_CYCLE.indexOf(f) + 1) % FLASH_CYCLE.length]);

  const renderBlocked = () => {
    if (!permission || asking) {
      return <ActivityIndicator color={Colors.orange} size="large" />;
    }
    if (mountError) {
      return (
        <View style={styles.permBox}>
          <View style={styles.permIcon}>
            <Ionicons name="alert-circle-outline" size={32} color={Colors.white} />
          </View>
          <Text style={styles.permTitle}>Camera unavailable</Text>
          <Text style={styles.permSub}>{mountError}</Text>
          <TouchableOpacity style={styles.permBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.permBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.permBox}>
        <View style={styles.permIcon}>
          <Ionicons name="camera-outline" size={32} color={Colors.white} />
        </View>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>
          {permission.canAskAgain
            ? 'Allow camera access to photograph the vehicle.'
            : 'Camera access is turned off for this app. Turn it on in Settings to photograph the vehicle.'}
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.85}>
            <Text style={styles.permBtnText}>Allow camera</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.permBtn} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
            <Text style={styles.permBtnText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.roundBtn}
          onPress={onClose}
          hitSlop={8}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
        >
          <Ionicons name="close" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          {multiple && <Text style={styles.subtitle}>Take as many as you need</Text>}
        </View>
        {canShoot ? (
          <TouchableOpacity
            style={styles.roundBtn}
            onPress={cycleFlash}
            hitSlop={8}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Flash ${flash}`}
          >
            <Ionicons
              name={flash === 'off' ? 'flash-off-outline' : 'flash'}
              size={20}
              color={flash === 'on' ? Colors.orange : Colors.white}
            />
            {flash === 'auto' && <Text style={styles.flashAuto}>A</Text>}
          </TouchableOpacity>
        ) : (
          <View style={styles.roundBtnSpacer} />
        )}
      </View>

      {/* Viewfinder — 3:4 like the captured photo, so what you see is what you get */}
      <View style={styles.previewArea}>
        {granted && !mountError ? (
          <View style={styles.preview}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              flash={flash}
              responsiveOrientationWhenOrientationLocked
              onCameraReady={() => setReady(true)}
              onMountError={(e) => setMountError(e.message || 'The camera could not be started.')}
            />
            {!ready && (
              <View style={styles.previewLoader}>
                <ActivityIndicator color={Colors.white} />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.blocked}>{renderBlocked()}</View>
        )}

        {!!captureError && (
          <View style={styles.errorPill} pointerEvents="none">
            <Ionicons name="alert-circle-outline" size={15} color={Colors.white} />
            <Text style={styles.errorPillText}>{captureError}</Text>
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.sideLeft}>
          {multiple && lastUri && (
            <Animated.View style={[styles.lastShot, { transform: [{ scale: thumbScale }] }]}>
              <Image key={lastUri} source={{ uri: lastUri }} style={styles.lastShotImg} resizeMethod="resize" />
            </Animated.View>
          )}
        </View>

        <Pressable
          onPress={shoot}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={!canShoot || taking}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
        >
          <View style={[styles.shutterRing, !canShoot && styles.shutterDisabled]}>
            <Animated.View
              style={[styles.shutterDisc, taking && styles.shutterDiscBusy, { transform: [{ scale: shutterScale }] }]}
            />
          </View>
        </Pressable>

        <View style={styles.sideRight}>
          {multiple && (
            <TouchableOpacity
              style={[styles.doneBtn, shots > 0 && styles.doneBtnActive]}
              onPress={onClose}
              disabled={taking}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.doneBtnText}>{shots > 0 ? `Done (${shots})` : 'Done'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const SHUTTER = 76;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.black },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnSpacer: { width: 40, height: 40 },
  flashAuto: {
    position: 'absolute',
    right: 7,
    bottom: 5,
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.white,
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.onDarkMuted, marginTop: 2 },

  previewArea: { flex: 1, justifyContent: 'flex-start' },
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: '100%',
    overflow: 'hidden',
    backgroundColor: Colors.cardDark,
  },
  previewLoader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  errorPill: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(229,62,62,0.9)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  errorPillText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.white },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  sideLeft: { flex: 1, alignItems: 'flex-start' },
  sideRight: { flex: 1, alignItems: 'flex-end' },

  shutterRing: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterDisc: {
    width: SHUTTER - 16,
    height: SHUTTER - 16,
    borderRadius: (SHUTTER - 16) / 2,
    backgroundColor: Colors.white,
  },
  shutterDiscBusy: { opacity: 0.55 },

  lastShot: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.white,
    overflow: 'hidden',
    backgroundColor: Colors.cardDark,
  },
  lastShotImg: { width: '100%', height: '100%' },

  doneBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
    backgroundColor: Colors.glass,
  },
  doneBtnActive: { backgroundColor: Colors.orange },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },

  permBox: { alignItems: 'center', paddingHorizontal: 40, gap: 12 },
  permIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  permTitle: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.white, letterSpacing: -0.4, textAlign: 'center' },
  permSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.onDarkMuted, textAlign: 'center', lineHeight: 20 },
  permBtn: {
    marginTop: 8,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  permBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});
