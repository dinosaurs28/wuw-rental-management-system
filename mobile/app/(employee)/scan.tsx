import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Vibration,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

type Mode = 'camera' | 'manual';

const VIEWFINDER = 260;
const CORNER = 28;
const BORDER = 3;

export default function ScanBooking() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('camera');
  const [scanning, setScanning] = useState(true);
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scannerActive = useRef(true);

  // Animate the scan line — restart whenever mode becomes 'camera' so the
  // native driver re-syncs after the Animated.View was unmounted in manual mode.
  const scanLine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (mode !== 'camera') return;
    scanLine.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode]);

  // Re-enable scanner each time the tab is focused
  useFocusEffect(
    useCallback(() => {
      scannerActive.current = true;
      setScanning(true);
      setError('');
    }, []),
  );

  const navigate = (bookingId: string, status: string) => {
    if (status === 'CONFIRMED') {
      router.push(`/employee/pickup/${bookingId}`);
    } else if (status === 'PICKED_UP') {
      router.push(`/employee/return/${bookingId}`);
    } else {
      setError(`Status is ${status} — no action available.`);
      setTimeout(() => { scannerActive.current = true; setScanning(true); }, 2500);
    }
  };

  const lookup = async (id: string) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await employeeApi.scanBooking(id.trim());
      const booking = res.data?.data;
      if (!booking) {
        setError('Booking not found.');
        setTimeout(() => { scannerActive.current = true; setScanning(true); }, 2500);
        return;
      }
      navigate(booking.publicId, booking.status);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Booking not found.');
      setTimeout(() => { scannerActive.current = true; setScanning(true); }, 2500);
    } finally {
      setLoading(false);
    }
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (!scannerActive.current || !data) return;
    scannerActive.current = false;
    setScanning(false);
    Vibration.vibrate(60);
    lookup(data);
  };

  const handleManual = () => lookup(manualId);

  const scanLineY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, VIEWFINDER - 4],
  });

  // ── Camera tab ──────────────────────────────────────────────────────────────

  const renderCamera = () => {
    if (!permission) {
      return <ActivityIndicator style={styles.permLoader} color={Colors.orange} />;
    }

    if (!permission.granted) {
      return (
        <View style={styles.permBox}>
          <View style={styles.permIcon}>
            <Ionicons name="camera-outline" size={36} color={Colors.ink3} />
          </View>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permSub}>Allow camera access to scan booking QR codes.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.85}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        />

        {/* Overlay rendered as sibling via absolute positioning */}
        <View style={styles.overlay} pointerEvents="none">
          {/* Top dark band */}
          <View style={styles.overlayTop} />

          <View style={styles.overlayRow}>
            <View style={styles.overlaySide} />

            {/* Viewfinder */}
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />

              {scanning && (
                <Animated.View
                  style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]}
                />
              )}

              {loading && (
                <View style={styles.processingOverlay}>
                  <ActivityIndicator color={Colors.orange} size="large" />
                  <Text style={styles.processingText}>Looking up...</Text>
                </View>
              )}
            </View>

            <View style={styles.overlaySide} />
          </View>

          {/* Bottom dark band */}
          <View style={styles.overlayBottom} />
        </View>

        {/* Hint / error — needs to be tappable so outside pointerEvents="none" */}
        <View style={styles.hintWrap}>
          {error ? (
            <View style={styles.errorPill}>
              <Ionicons name="alert-circle-outline" size={15} color="#fff" />
              <Text style={styles.errorPillText}>{error}</Text>
            </View>
          ) : (
            <Text style={styles.scanHint}>Point camera at booking QR code</Text>
          )}
        </View>
      </View>
    );
  };

  // ── Manual tab ──────────────────────────────────────────────────────────────

  const renderManual = () => (
    <View style={styles.manualWrap}>
      <View style={styles.manualIcon}>
        <Ionicons name="document-text-outline" size={32} color={Colors.orange} />
      </View>
      <Text style={styles.manualTitle}>Enter Booking ID</Text>
      <Text style={styles.manualSub}>Type or paste the booking ID from the confirmation screen.</Text>

      <View style={styles.inputRow}>
        <View style={[styles.inputWrap, error ? styles.inputError : null]}>
          <TextInput
            style={styles.input}
            placeholder="e.g. A1B2C3D4"
            placeholderTextColor={Colors.ink4}
            value={manualId}
            onChangeText={(t) => { setManualId(t.toUpperCase()); setError(''); }}
            autoCapitalize="characters"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={handleManual}
          />
          {manualId.length > 0 && (
            <TouchableOpacity onPress={() => { setManualId(''); setError(''); }} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.goBtn, (!manualId.trim() || loading) && styles.goBtnDisabled]}
          onPress={handleManual}
          disabled={!manualId.trim() || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="arrow-forward" size={20} color={Colors.white} />
          )}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={14} color="#e53e3e" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Scan</Text>

        {/* Mode toggle */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'camera' && styles.modeBtnActive]}
            onPress={() => { setMode('camera'); setError(''); scannerActive.current = true; setScanning(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={15} color={mode === 'camera' ? Colors.white : Colors.ink3} />
            <Text style={[styles.modeBtnText, mode === 'camera' && styles.modeBtnTextActive]}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'manual' && styles.modeBtnActive]}
            onPress={() => { setMode('manual'); setError(''); }}
            activeOpacity={0.8}
          >
            <Ionicons name="keypad-outline" size={15} color={mode === 'manual' ? Colors.white : Colors.ink3} />
            <Text style={[styles.modeBtnText, mode === 'manual' && styles.modeBtnTextActive]}>Manual</Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'camera' ? renderCamera() : renderManual()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.ink, letterSpacing: -0.6 },

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 3,
    gap: 2,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  modeBtnActive: { backgroundColor: Colors.ink },
  modeBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  modeBtnTextActive: { color: Colors.white },

  // ── Camera ──────────────────────────────────────────────────────────────────
  cameraWrap: { flex: 1 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    bottom: '50%',
    marginBottom: VIEWFINDER / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlaySide: {
    width: 40,
    height: VIEWFINDER,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    top: '50%',
    marginTop: VIEWFINDER / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintWrap: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
  },

  viewfinder: {
    width: VIEWFINDER,
    height: VIEWFINDER,
    overflow: 'hidden',
  },

  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: Colors.orange,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderTopLeftRadius: 10 },
  cornerTR: { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER, borderTopRightRadius: 10 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderBottomRightRadius: 10 },

  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },

  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 2,
  },
  processingText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: '#fff' },

  scanHint: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
  },
  errorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(229,62,62,0.85)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  errorPillText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#fff' },

  permLoader: { flex: 1 },
  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  permIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permTitle: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4, textAlign: 'center' },
  permSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', lineHeight: 20 },
  permBtn: {
    marginTop: 8,
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  permBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },

  // ── Manual ──────────────────────────────────────────────────────────────────
  manualWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    gap: 16,
  },
  manualIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  manualTitle: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.5 },
  manualSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, lineHeight: 20 },

  inputRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    height: 54,
    gap: 10,
  },
  inputError: { borderColor: '#e53e3e' },
  input: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
    letterSpacing: 1,
    padding: 0,
  },
  goBtn: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  goBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },
});
