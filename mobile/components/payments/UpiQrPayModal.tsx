import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { upiQrApi } from '../../lib/api';
import { inrExact } from '../../lib/gst';
import {
  UPI_QR_AVAILABILITY_KEY,
  UPI_QR_POLL_MS,
  countdownText,
  endedQrAction,
  upiQrError,
  type UpiQrError,
} from '../../lib/upiQr';
import type { UpiQrPurpose, UpiQrTarget, UpiQrView } from '../../types/upiQr';
import Button from '../ui/Button';

/** How the customer left the QR screen — the host screen decides what follows. */
export type UpiQrExit =
  /** Paid and confirmed (view null: the server said it was already paid). */
  | { kind: 'paid'; view: UpiQrView | null }
  /** Paid but not applicable (hold ended, paid twice…): the refund notice was shown. */
  | { kind: 'refund'; view: UpiQrView }
  /** Left without paying; the QR was closed. `message`: why the QR couldn't be used, when that ended it. */
  | { kind: 'cancelled'; view: UpiQrView | null; message?: string }
  /** The booking hold is over — the booking has to be started again. */
  | { kind: 'expired'; view: UpiQrView | null; message: string }
  /** QR closed; pay the same order in Razorpay Checkout instead. */
  | { kind: 'another-way'; view: UpiQrView | null };

interface Props {
  /** What to pay; null hides the screen. */
  target: UpiQrTarget | null;
  /** Shown while the QR is being made (the QR's own amount replaces it). */
  expectedAmount?: number | null;
  /** e.g. the vehicle — shown under the amount. */
  subtitle?: string;
  /** Offer "Pay another way" (Razorpay Checkout for the same order). */
  canPayAnotherWay?: boolean;
  onExit: (exit: UpiQrExit) => void;
}

// A concurrent create for the same payment answers QR_BUSY: retry quietly.
const QR_BUSY_RETRIES = 2;
const QR_BUSY_DELAY_MS = 1500;
// Failed polls in a row before the screen says it is reconnecting.
const RECONNECT_AFTER = 2;
/** The customer left an extension QR that Razorpay wouldn't close (the host shows this). */
export const QR_LEFT_OPEN_MESSAGE =
  "The UPI QR code couldn't be closed. If it is paid in the next few minutes, your trip will be extended — check your trip before paying again.";

const PURPOSE_LABEL: Record<UpiQrPurpose, string> = {
  ADVANCE: 'Advance payment',
  FULL_PAYMENT: 'Full payment',
  EXTENSION: 'Trip extension',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function targetKey(t: UpiQrTarget | null): string | null {
  if (!t) return null;
  return 'bookingId' in t ? `booking:${t.bookingId}` : `extension:${t.extensionId}`;
}

/**
 * Item 2 — pay by scanning a Razorpay UPI QR with ANOTHER phone (for phones
 * with no UPI app). The QR pays the order the booking / extension already has.
 * Shows the exact amount and the time left, polls every 3 s while on screen
 * (and the app is in front), and hands the result back through `onExit`.
 * Leaving closes the QR so it stops taking money.
 */
export default function UpiQrPayModal({ target, expectedAmount, subtitle, canPayAnotherWay = false, onExit }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isFocused = useIsFocused();
  const qc = useQueryClient();
  const key = targetKey(target);
  const visible = key !== null;

  const [view, setView] = useState<UpiQrView | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<UpiQrError | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'another' | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  // Countdown: anchored to the server's expiresInSeconds when the QR first
  // arrives, so a phone clock that is off doesn't skew it.
  const [deadline, setDeadline] = useState<{ id: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [imgAspect, setImgAspect] = useState(1);
  // Image load state keyed by "<imageUrl>#<attempt>" — a new QR or a retry is a new key.
  const [imgAttempt, setImgAttempt] = useState(0);
  const [imgLoadedKey, setImgLoadedKey] = useState<string | null>(null);
  const [imgFailedKey, setImgFailedKey] = useState<string | null>(null);

  // Bumped whenever the target changes: replies for an older target are dropped.
  const genRef = useRef(0);
  const exitedRef = useRef(false);
  const viewRef = useRef<UpiQrView | null>(null);
  const lastPollAtRef = useRef(0);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const finish = useCallback((exit: UpiQrExit) => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExitRef.current(exit);
  }, []);

  const applyView = useCallback(
    (v: UpiQrView, gen: number) => {
      if (gen !== genRef.current) return;
      viewRef.current = v;
      setView(v);
      if (v.status === 'ACTIVE') {
        setDeadline((d) => (d?.id === v.qrPaymentId ? d : { id: v.qrPaymentId, at: Date.now() + v.expiresInSeconds * 1000 }));
      }
      if (v.outcome === 'CONFIRMED') finish({ kind: 'paid', view: v });
    },
    [finish],
  );

  const create = useCallback(
    async (t: UpiQrTarget, gen: number, attempt = 0): Promise<void> => {
      setCreating(true);
      setError(null);
      setInlineError(null);
      try {
        const res = await upiQrApi.create(t);
        const v = res.data?.data;
        if (gen !== genRef.current || exitedRef.current) {
          // Left while it was being made: don't leave it taking money.
          if (v?.status === 'ACTIVE') upiQrApi.close(v.qrPaymentId).catch(() => undefined);
          return;
        }
        if (!v?.qrPaymentId) {
          setError({
            code: null,
            message: "We couldn't make the UPI QR. Please try again.",
            alreadyPaid: false,
            holdExpired: false,
            retryable: true,
            qrOnly: true,
          });
          return;
        }
        setPollFailures(0);
        lastPollAtRef.current = Date.now();
        applyView(v, gen);
      } catch (err) {
        if (gen !== genRef.current || exitedRef.current) return;
        const e = upiQrError(err);
        if (e.alreadyPaid) {
          finish({ kind: 'paid', view: null });
          return;
        }
        if (e.code === 'QR_BUSY' && attempt < QR_BUSY_RETRIES) {
          await sleep(QR_BUSY_DELAY_MS);
          if (gen === genRef.current && !exitedRef.current) await create(t, gen, attempt + 1);
          return;
        }
        // Switched off since this screen asked: stop offering it.
        if (e.code === 'UPI_QR_DISABLED') qc.setQueryData(UPI_QR_AVAILABILITY_KEY, false);
        setError(e);
      } finally {
        if (gen === genRef.current) setCreating(false);
      }
    },
    [applyView, finish, qc],
  );

  // A new target: start over and make (or reuse) its QR. A QR still open from
  // an earlier target that never exited through this screen is closed.
  useEffect(() => {
    const prev = viewRef.current;
    if (prev && prev.status === 'ACTIVE' && !exitedRef.current) {
      upiQrApi.close(prev.qrPaymentId).catch(() => undefined);
    }
    genRef.current += 1;
    const gen = genRef.current;
    exitedRef.current = false;
    viewRef.current = null;
    setView(null);
    setError(null);
    setBusy(null);
    setInlineError(null);
    setPollFailures(0);
    setDeadline(null);
    if (target) void create(target, gen);
    // Keyed on the target's identity, not the object (callers pass literals).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Unmounted while the QR is still open (e.g. the session ended): close it.
  useEffect(
    () => () => {
      const v = viewRef.current;
      if (v && v.status === 'ACTIVE' && !exitedRef.current) upiQrApi.close(v.qrPaymentId).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const qrPaymentId = view?.qrPaymentId ?? null;
  const pending = view?.outcome === 'PENDING';
  // The QR took the money; the booking / extension is being confirmed.
  const paidPending = pending && view?.status === 'PAID';

  // Status poll — every 3 s while the QR is on screen, the app is in front and
  // nothing else is in flight. Coming back to the app polls straight away.
  const live = visible && pending && appActive && isFocused && !busy;
  useEffect(() => {
    if (!live || !qrPaymentId) return;
    const gen = genRef.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      lastPollAtRef.current = Date.now();
      try {
        const res = await upiQrApi.status(qrPaymentId);
        if (stopped || gen !== genRef.current) return;
        setPollFailures(0);
        const v = res.data?.data;
        if (v) applyView(v, gen);
      } catch (err) {
        if (stopped || gen !== genRef.current) return;
        const e = upiQrError(err);
        if (e.code === 'QR_NOT_FOUND') {
          viewRef.current = null;
          setView(null);
          setError(e);
          return;
        }
        // Offline / gateway hiccup: the payment state is unknown, not failed.
        setPollFailures((n) => n + 1);
      }
      if (!stopped) timer = setTimeout(tick, UPI_QR_POLL_MS);
    };
    const wait = Math.max(0, UPI_QR_POLL_MS - (Date.now() - lastPollAtRef.current));
    timer = setTimeout(tick, wait);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [live, qrPaymentId, applyView]);

  // One-second clock for the countdown.
  useEffect(() => {
    if (!visible || !pending) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, pending]);

  const secondsLeft =
    view && deadline?.id === view.qrPaymentId ? Math.max(0, Math.ceil((deadline.at - now) / 1000)) : 0;
  // Past closeBy but not settled yet: a payment made at the last second still
  // lands, so keep polling — just stop inviting a new scan.
  const timeUp = pending && !paidPending && secondsLeft <= 0;

  const regenerate = () => {
    if (!target || creating) return;
    viewRef.current = null;
    setView(null);
    setDeadline(null);
    void create(target, genRef.current);
  };

  const closeAndLeave = async (kind: 'cancel' | 'another', v: UpiQrView) => {
    // Settled (or another QR shown) while the "Leave?" question was open.
    if (exitedRef.current || viewRef.current?.qrPaymentId !== v.qrPaymentId) return;
    const gen = genRef.current;
    setBusy(kind);
    setInlineError(null);
    try {
      const res = await upiQrApi.close(v.qrPaymentId);
      if (gen !== genRef.current) return;
      const closed = res.data?.data ?? null;
      // The money had already landed: closing settled it.
      if (closed?.outcome === 'CONFIRMED') {
        finish({ kind: 'paid', view: closed });
        return;
      }
      if (closed?.outcome === 'REFUND_REQUIRED') {
        applyView(closed, gen);
        return;
      }
      finish(kind === 'another' ? { kind: 'another-way', view: closed } : { kind: 'cancelled', view: closed });
    } catch (err) {
      if (gen !== genRef.current) return;
      if (kind === 'another' || v.extensionId !== null) {
        // Still open — paying another way now could take the money twice. An
        // extension's quote stays open after "cancelled" (nothing else closes
        // the QR), so leaving would let it be paid behind a "not extended".
        const message = upiQrError(err, "We couldn't close this QR code. Please try again.").message;
        setInlineError(message);
        if (kind === 'cancel') {
          // Razorpay may stay unreachable: let the customer go, knowing the QR is live
          Alert.alert('QR code still open', `${message}\n\nIf you leave now, this QR can still be paid for a few minutes — if it is, your trip will be extended.`, [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Leave anyway',
              style: 'destructive',
              onPress: () => {
                if (gen !== genRef.current) return;
                finish({ kind: 'cancelled', view: v, message: QR_LEFT_OPEN_MESSAGE });
              },
            },
          ]);
        }
      } else {
        // The host releases the hold; the server closes the QR with it.
        finish({ kind: 'cancelled', view: v });
      }
    } finally {
      if (gen === genRef.current) setBusy(null);
    }
  };

  const leave = (kind: 'cancel' | 'another') => {
    if (busy) return;
    const v = viewRef.current;
    // The money is in; leaving now would only hide the confirmation (or, paying
    // another way, charge twice).
    if (v?.status === 'PAID' && v.outcome === 'PENDING') {
      Alert.alert('Payment received', "We're confirming your payment — this takes a few seconds.");
      return;
    }
    if (!v || v.status !== 'ACTIVE') {
      // Nothing open to stop (not made yet, failed, expired or closed).
      finish(kind === 'another' ? { kind: 'another-way', view: v } : { kind: 'cancelled', view: v });
      return;
    }
    if (kind === 'another') {
      void closeAndLeave('another', v);
      return;
    }
    Alert.alert(
      'Leave without paying?',
      "This QR code will stop working. If you've already paid, stay on this screen — it can take a few seconds to confirm.",
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => void closeAndLeave('cancel', v) },
      ],
    );
  };

  // Header close and Android back.
  const onClosePress = () => {
    if (busy) return;
    if (view?.outcome === 'REFUND_REQUIRED') {
      finish({ kind: 'refund', view });
      return;
    }
    if (error && !view) {
      finish({ kind: 'cancelled', view: null, message: error.qrOnly ? undefined : error.message });
      return;
    }
    leave('cancel');
  };

  const isBooking = target ? 'bookingId' in target : true;
  const amount = view?.amount ?? expectedAmount ?? null;
  const amountText = amount != null ? inrExact(amount) : null;
  // Razorpay's image is a poster around the QR: fit it to the width, but keep
  // it under about half the screen so the amount and timer stay in view.
  const maxQrWidth = Math.min(width - 72, 320);
  const qrWidth = Math.min(maxQrWidth, Math.max(240, height * 0.48) * imgAspect);
  const imgKey = view ? `${view.imageUrl}#${imgAttempt}` : '';
  const imgFailed = !!view && imgFailedKey === imgKey;
  const imgLoading = !!view && !imgFailed && imgLoadedKey !== imgKey;
  // EXPIRED / CLOSED: a new QR, or (a booking whose hold is ending) start again.
  const endedAction = view ? endedQrAction(view) : null;
  const ended = endedAction !== null;
  const canRegenerate = endedAction === 'regenerate';
  const startAgain = endedAction === 'start-again';

  const statusLine = (() => {
    if (pollFailures >= RECONNECT_AFTER) return "Can't reach the server right now — still checking…";
    if (paidPending) return `Payment received — confirming your ${isBooking ? 'booking' : 'extension'}…`;
    if (view?.gatewayUnreachable) return view.message;
    if (timeUp) return 'Checking for a last-second payment…';
    return 'Waiting for the payment…';
  })();

  const renderBody = () => {
    if (error && !view) {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.stateIcon, { backgroundColor: Colors.availNoneSoft }]}>
            <Ionicons name={error.holdExpired ? 'hourglass-outline' : 'alert-circle'} size={40} color={Colors.availNone} />
          </View>
          <Text style={styles.stateTitle}>{error.holdExpired ? 'Booking hold ended' : "Couldn't show the UPI QR"}</Text>
          <Text style={styles.stateText}>{error.message}</Text>
        </View>
      );
    }
    if (!view) {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={styles.stateText}>Making your UPI QR…</Text>
          {amountText ? <Text style={styles.stateAmount}>{amountText}</Text> : null}
        </View>
      );
    }
    if (view.outcome === 'REFUND_REQUIRED') {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.stateIcon, { backgroundColor: Colors.availLowSoft }]}>
            <Ionicons name="return-down-back" size={38} color={Colors.availLow} />
          </View>
          <Text style={styles.stateTitle}>Payment can't be applied</Text>
          <Text style={styles.stateText}>{view.message}</Text>
          <Text style={styles.stateNote}>The branch has been notified about the refund.</Text>
        </View>
      );
    }

    return (
      <>
        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>
            {PURPOSE_LABEL[view.purpose] ?? 'Payment'} · pay exactly
          </Text>
          <Text style={styles.amount}>{inrExact(view.amount)}</Text>
          {subtitle ? <Text style={styles.amountSub}>{subtitle}</Text> : null}
        </View>

        <View style={styles.qrCard}>
          <View style={{ width: qrWidth, height: qrWidth / imgAspect }}>
            <Image
              key={imgKey}
              source={{ uri: view.imageUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              accessibilityLabel={`UPI QR code to pay ${inrExact(view.amount)}`}
              onLoad={(e) => {
                // Razorpay's QR image is a poster (not square): size the box to it.
                const src = e.nativeEvent?.source;
                if (src?.width && src?.height) setImgAspect(src.width / src.height);
                setImgLoadedKey(imgKey);
              }}
              onError={() => setImgFailedKey(imgKey)}
            />
            {imgLoading && (
              <View style={styles.qrOverlay}>
                <ActivityIndicator color={Colors.orange} />
              </View>
            )}
            {imgFailed && (
              <TouchableOpacity
                style={styles.qrOverlay}
                onPress={() => setImgAttempt((n) => n + 1)}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh" size={22} color={Colors.ink2} />
                <Text style={styles.qrOverlayText}>Couldn't load the QR. Tap to retry.</Text>
              </TouchableOpacity>
            )}
            {paidPending ? (
              <View style={[styles.qrOverlay, styles.qrOverlayDim]}>
                <Ionicons name="checkmark-circle" size={34} color={Colors.availGood} />
                <Text style={styles.qrOverlayText}>Payment received</Text>
              </View>
            ) : (timeUp || ended) && !imgFailed ? (
              <View style={[styles.qrOverlay, styles.qrOverlayDim]}>
                <Ionicons name={ended ? 'close-circle' : 'time-outline'} size={30} color={Colors.ink2} />
                <Text style={styles.qrOverlayText}>
                  {view.outcome === 'CLOSED' ? 'QR closed' : 'QR expired'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {pending && !timeUp && !paidPending ? (
          <View style={[styles.timerPill, secondsLeft < 60 && styles.timerPillLow]}>
            <Ionicons name="time-outline" size={14} color={secondsLeft < 60 ? Colors.availLow : Colors.ink3} />
            <Text style={[styles.timerText, secondsLeft < 60 && styles.timerTextLow]}>
              QR valid for {countdownText(secondsLeft)}
            </Text>
          </View>
        ) : null}

        {pending ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={Colors.orange} />
            <Text style={styles.statusText}>{statusLine}</Text>
          </View>
        ) : (
          <View style={styles.endedBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.availLow} />
            <Text style={styles.endedText}>{view.message}</Text>
          </View>
        )}

        {pending && !timeUp && !paidPending ? (
          <View style={styles.steps}>
            <Text style={styles.stepsTitle}>How to pay</Text>
            {[
              'Open any UPI app — Google Pay, PhonePe, Paytm, BHIM — on another phone.',
              'Scan this QR code.',
              `Pay exactly ${inrExact(view.amount)}. The amount is fixed.`,
            ].map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}
            <Text style={styles.stepsNote}>Keep this screen open — it updates on its own once the payment arrives.</Text>
          </View>
        ) : null}
      </>
    );
  };

  const renderFooter = () => {
    if (error && !view) {
      return (
        <>
          {error.holdExpired ? (
            <Button title="Start again" onPress={() => finish({ kind: 'expired', view: null, message: error.message })} />
          ) : error.retryable ? (
            <Button title="Try again" onPress={regenerate} loading={creating} />
          ) : null}
          {canPayAnotherWay && error.qrOnly && !error.holdExpired ? (
            <Button title="Pay another way" variant="secondary" onPress={() => leave('another')} disabled={creating} />
          ) : null}
          <Button title="Close" variant="ghost" onPress={onClosePress} disabled={creating} />
        </>
      );
    }
    if (!view) {
      return <Button title="Cancel" variant="ghost" onPress={onClosePress} />;
    }
    if (view.outcome === 'REFUND_REQUIRED') {
      return <Button title="Done" onPress={() => finish({ kind: 'refund', view })} />;
    }
    if (ended) {
      return (
        <>
          {canRegenerate ? <Button title="Generate new QR" onPress={regenerate} loading={creating} /> : null}
          {startAgain ? (
            <Button title="Start again" onPress={() => finish({ kind: 'expired', view, message: view.message })} />
          ) : null}
          {canPayAnotherWay && canRegenerate ? (
            <Button title="Pay another way" variant="secondary" onPress={() => leave('another')} disabled={creating} />
          ) : null}
          {!startAgain ? <Button title="Close" variant="ghost" onPress={onClosePress} disabled={creating} /> : null}
        </>
      );
    }
    return (
      <>
        {inlineError ? (
          <View style={styles.inlineError}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
            <Text style={styles.inlineErrorText}>{inlineError}</Text>
          </View>
        ) : null}
        {canPayAnotherWay && !paidPending ? (
          <Button
            title="Pay another way"
            variant="secondary"
            onPress={() => leave('another')}
            loading={busy === 'another'}
            disabled={!!busy}
          />
        ) : null}
        <Button
          title="Cancel"
          variant="ghost"
          onPress={onClosePress}
          loading={busy === 'cancel'}
          disabled={!!busy || paidPending}
        />
      </>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClosePress}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClosePress} style={styles.closeBtn} hitSlop={8} disabled={!!busy}>
            <Ionicons name="close" size={24} color={busy ? Colors.ink4 : Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pay with UPI QR</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {renderBody()}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{renderFooter()}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, alignItems: 'center', gap: 14 },

  amountBlock: { alignItems: 'center', gap: 2 },
  amountLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  amount: { fontFamily: Fonts.displayBold, fontSize: 34, color: Colors.ink, letterSpacing: -0.8 },
  amountSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, textAlign: 'center' },

  qrCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
  },
  qrOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  qrOverlayDim: { backgroundColor: 'rgba(255,255,255,0.88)' },
  qrOverlayText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2, textAlign: 'center' },

  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  timerPillLow: { backgroundColor: Colors.availLowSoft, borderColor: '#d9770630' },
  timerText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  timerTextLow: { color: Colors.availLow },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  statusText: { flexShrink: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2, textAlign: 'center' },

  endedBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.availLowSoft,
    borderRadius: 12,
    padding: 12,
  },
  endedText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: '#92400e' },

  steps: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
    gap: 10,
  },
  stepsTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.orange },
  stepText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, lineHeight: 19, color: Colors.ink2 },
  stepsNote: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17, color: Colors.ink3 },

  stateBox: { alignItems: 'center', gap: 12, paddingTop: 48, paddingHorizontal: 12 },
  stateIcon: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stateTitle: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.5, textAlign: 'center' },
  stateText: { fontFamily: Fonts.body, fontSize: 15, lineHeight: 22, color: Colors.ink2, textAlign: 'center' },
  stateNote: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 18, color: Colors.ink3, textAlign: 'center' },
  stateAmount: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.ink, letterSpacing: -0.5 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.availNoneSoft,
    borderRadius: 12,
    padding: 12,
  },
  inlineErrorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, lineHeight: 18, color: Colors.availNone },
});
