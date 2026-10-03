import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';
import {
  COLLATERAL_HELPER,
  COLLATERAL_MAX_LENGTH,
  COUNTER_PAYMENT_METHODS,
  PAYMENT_PROOF_HELPER,
  PAYMENT_PROOF_LABEL,
  counterPaymentServerError,
  inrCounter,
  proofProblem,
  resolveCounterPayment,
  splitUpiPart,
  type CounterPaymentChoice,
  type CounterPaymentErrors,
  type CounterRefundMethod,
  type PaymentMethodKey,
  type ProofShot,
} from '../../lib/counterPayment';
import ImageViewer from '../ui/ImageViewer';
import CameraCapture, { type CapturedSize } from './CameraCapture';

// Fleet counter payments (#3 / #11 / #12): one method picker for every counter
// payment step — walk-in create, pickup bill, drop bill, extension collect,
// legacy remaining balance. Cash · UPI (photo of the customer's payment screen,
// camera only — no UTR box) · Split (cash + UPI) · Credit (collateral held).
// The screen owns the state through useCounterPayment() so a photo keeps
// uploading while staff switch methods, and maps the resolved choice onto its
// endpoint's body.

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const METHOD_ICON: Record<PaymentMethodKey, IconName> = {
  CASH: 'wallet-outline',
  UPI: 'qr-code-outline',
  SPLIT: 'pie-chart-outline',
  CREDIT: 'hourglass-outline',
  ONLINE: 'card-outline',
};

// Short chip labels so four fit as a 2 × 2 grid.
const CHIP_LABEL: Record<PaymentMethodKey, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  SPLIT: 'Split',
  CREDIT: 'Credit',
  ONLINE: 'Online',
};

// ── Proof photo state (survives the capture UI unmounting) ───────────────────

// The server explains its 400s (INVALID_IMAGE, IMAGE_TOO_SMALL…); the shared
// helper covers proxy 413s and timeouts.
function proofUploadError(err: any): string {
  const status = err?.response?.status;
  const message = err?.response?.data?.message;
  if (status && status !== 413 && typeof message === 'string' && message) return message;
  return uploadErrorMessage(err, 'Could not upload the payment photo.');
}

export interface ProofController {
  shot: ProofShot | null;
  /** Uploads a fresh camera shot (replacing any earlier one). */
  upload: (localUri: string, width: number) => void;
  retry: () => void;
  clear: () => void;
}

export function useProofShot(onTouched?: () => void): ProofController {
  const [shot, setShot] = useState<ProofShot | null>(null);
  // Bumped per shot / clear, so a slow upload can't overwrite a newer one.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const touchedRef = useRef(onTouched);
  touchedRef.current = onTouched;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const upload = async (localUri: string, width: number) => {
    const seq = ++seqRef.current;
    setShot({ status: 'uploading', localUri, width });
    touchedRef.current?.();
    try {
      const asset = { uri: localUri, width, mimeType: 'image/jpeg' };
      let res;
      try {
        // Sharp enough for the amount and reference on the customer's screen.
        res = await employeeApi.uploadPaymentProof(
          toUploadForm(await prepareImageForUpload(asset, `upi_proof_${Date.now()}`, 'qr')),
        );
      } catch (err: any) {
        // A tight proxy limit — retry once at the standard size.
        if (err?.response?.status !== 413) throw err;
        res = await employeeApi.uploadPaymentProof(
          toUploadForm(await prepareImageForUpload(asset, `upi_proof_${Date.now()}`, 'standard')),
        );
      }
      if (!mountedRef.current || seq !== seqRef.current) return;
      const proof = res.data?.data;
      if (!proof?.proofFileId) {
        setShot({ status: 'failed', localUri, width, error: 'Could not upload the payment photo.' });
        return;
      }
      setShot({ status: 'ready', localUri, width, proof });
    } catch (err: any) {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setShot({ status: 'failed', localUri, width, error: proofUploadError(err) });
    }
  };

  return {
    shot,
    upload: (localUri, width) => { void upload(localUri, width); },
    retry: () => {
      if (shot?.status === 'failed') void upload(shot.localUri, shot.width);
    },
    clear: () => {
      seqRef.current++;
      setShot(null);
      touchedRef.current?.();
    },
  };
}

// ── Payment picker state ─────────────────────────────────────────────────────

export interface CounterPaymentController {
  method: PaymentMethodKey;
  setMethod: (m: PaymentMethodKey) => void;
  cash: string;
  setCash: (text: string) => void;
  proof: ProofController;
  collateral: string;
  setCollateral: (text: string) => void;
  errors: CounterPaymentErrors;
  setErrors: (errors: CounterPaymentErrors) => void;
  /** Checks the entry for `amount` (> 0): the choice, or null with the problems shown. */
  resolve: (amount: number) => CounterPaymentChoice | null;
  /** Shows a refused payment under the picker's fields; true when it was about the method. */
  showServerError: (err: any) => boolean;
  reset: () => void;
}

export function useCounterPayment(initial: PaymentMethodKey = 'CASH'): CounterPaymentController {
  const [method, setMethodState] = useState<PaymentMethodKey>(initial);
  const [cash, setCashState] = useState('');
  const [collateral, setCollateralState] = useState('');
  const [errors, setErrors] = useState<CounterPaymentErrors>({});
  const proof = useProofShot(() => setErrors((e) => (e.proof ? { ...e, proof: undefined } : e)));

  return {
    method,
    setMethod: (m) => {
      setMethodState(m);
      setErrors({});
    },
    cash,
    setCash: (text) => {
      setCashState(text.replace(/[^\d.]/g, ''));
      setErrors((e) => (e.split ? { ...e, split: undefined } : e));
    },
    proof,
    collateral,
    setCollateral: (text) => {
      setCollateralState(text);
      setErrors((e) => (e.collateral ? { ...e, collateral: undefined } : e));
    },
    errors,
    setErrors,
    resolve: (amount) => {
      const r = resolveCounterPayment(amount, { method, cash, proof: proof.shot, collateral });
      if (!r.ok) {
        setErrors(r.errors);
        return null;
      }
      setErrors({});
      return r.choice;
    },
    showServerError: (err) => {
      const mapped = counterPaymentServerError(err);
      if (!mapped) return false;
      if (mapped.dropProof) proof.clear();
      setErrors(mapped.errors);
      return true;
    },
    reset: () => {
      setMethodState(initial);
      setCashState('');
      setCollateralState('');
      setErrors({});
      proof.clear();
    },
  };
}

// ── Refund picker state (drop deposit / bill refunds) ────────────────────────

export interface CounterRefundController {
  method: CounterRefundMethod;
  setMethod: (m: CounterRefundMethod) => void;
  proof: ProofController;
  error: string | null;
  setError: (message: string | null) => void;
  /** The refund method (+ optional transfer photo), or null with the problem shown. */
  resolve: () => { method: CounterRefundMethod; proofFileId?: string } | null;
  showServerError: (err: any) => boolean;
  reset: () => void;
}

export function useCounterRefund(): CounterRefundController {
  const [method, setMethodState] = useState<CounterRefundMethod>('CASH');
  const [error, setError] = useState<string | null>(null);
  const proof = useProofShot(() => setError(null));

  return {
    method,
    setMethod: (m) => {
      setMethodState(m);
      setError(null);
    },
    proof,
    error,
    setError,
    resolve: () => {
      if (method === 'CASH') {
        setError(null);
        return { method };
      }
      // The transfer photo is optional — but one that's still on its way must land first.
      const problem = proofProblem(proof.shot, false);
      if (problem) {
        setError(problem.replace('payment photo', 'transfer photo'));
        return null;
      }
      setError(null);
      return proof.shot?.status === 'ready' ? { method, proofFileId: proof.shot.proof.proofFileId } : { method };
    },
    showServerError: (err) => {
      const mapped = counterPaymentServerError(err);
      if (!mapped?.errors.proof) return false;
      if (mapped.dropProof) proof.clear();
      setError(mapped.errors.proof);
      return true;
    },
    reset: () => {
      setMethodState('CASH');
      setError(null);
      proof.clear();
    },
  };
}

// ── UI ───────────────────────────────────────────────────────────────────────

function Chips<K extends string>({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: readonly { key: K; label: string; icon: IconName }[];
  value: K;
  onSelect: (k: K) => void;
  disabled?: boolean;
}) {
  const basis = options.length > 4 ? '30%' : '47%';
  return (
    <View style={styles.grid}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.chip, { flexBasis: basis }, active && styles.chipActive, disabled && !active && styles.dim]}
            onPress={() => onSelect(o.key)}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
          >
            <Ionicons name={o.icon} size={16} color={active ? Colors.white : Colors.ink2} />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  } catch {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}

/**
 * Camera capture of the customer's UPI payment-success screen, uploaded at
 * once; preview (tap to zoom), retake and retry. Camera only — a gallery
 * screenshot could be an old payment.
 */
export function PaymentProofCapture({
  ctl,
  required = true,
  label = PAYMENT_PROOF_LABEL,
  helper = PAYMENT_PROOF_HELPER,
  error,
  disabled,
  style,
}: {
  ctl: ProofController;
  required?: boolean;
  label?: string;
  helper?: string;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [camera, setCamera] = useState(false);
  const [viewer, setViewer] = useState(false);
  const shot = ctl.shot;

  const onShot = (uri: string, size: CapturedSize) => ctl.upload(uri, size.width);

  const status = !shot
    ? null
    : shot.status === 'uploading'
      ? 'Uploading…'
      : shot.status === 'failed'
        ? 'Upload failed'
        : `Captured ${fmtTime(shot.proof.capturedAt)}`;

  return (
    <View style={[styles.proofCard, !!error && styles.proofCardError, style]}>
      <View style={styles.proofHead}>
        <Ionicons name="camera-outline" size={15} color={Colors.ink3} />
        <Text style={styles.proofLabel}>{label}</Text>
        {required && shot?.status !== 'ready' ? (
          <View style={styles.reqPill}><Text style={styles.reqText}>Required</Text></View>
        ) : shot?.status === 'ready' ? (
          <Ionicons name="checkmark-circle" size={16} color={Colors.availGood} />
        ) : null}
      </View>

      {shot ? (
        <View style={styles.proofBody}>
          <TouchableOpacity
            style={styles.thumbWrap}
            onPress={() => (shot.status === 'failed' ? ctl.retry() : setViewer(true))}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={shot.status === 'failed' ? 'Retry upload' : 'View payment photo'}
          >
            <Image source={{ uri: shot.localUri }} style={styles.thumb} resizeMethod="resize" />
            {shot.status === 'uploading' ? (
              <View style={styles.overlay}><ActivityIndicator size="small" color={Colors.white} /></View>
            ) : shot.status === 'failed' ? (
              <View style={[styles.overlay, styles.overlayFailed]}>
                <Ionicons name="refresh" size={18} color={Colors.white} />
                <Text style={styles.overlayText}>Retry</Text>
              </View>
            ) : (
              <View style={styles.zoomBadge}><Ionicons name="expand-outline" size={11} color={Colors.white} /></View>
            )}
          </TouchableOpacity>
          <View style={styles.proofInfo}>
            <Text style={[styles.proofStatus, shot.status === 'failed' && styles.errorText]}>{status}</Text>
            {shot.status === 'failed' && <Text style={styles.proofMeta}>{shot.error}</Text>}
            <View style={styles.proofActions}>
              <TouchableOpacity
                style={[styles.ghostBtn, disabled && styles.dim]}
                onPress={() => setCamera(true)}
                disabled={disabled}
                activeOpacity={0.85}
              >
                <Ionicons name="camera-reverse-outline" size={14} color={Colors.ink} />
                <Text style={styles.ghostBtnText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ghostBtn, disabled && styles.dim]}
                onPress={ctl.clear}
                disabled={disabled}
                activeOpacity={0.85}
              >
                <Ionicons name="trash-outline" size={14} color={Colors.availNone} />
                <Text style={[styles.ghostBtnText, styles.errorText]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.captureBtn, disabled && styles.dim]}
          onPress={() => setCamera(true)}
          disabled={disabled}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Take a photo of the payment screen"
        >
          <Ionicons name="camera" size={18} color={Colors.ink} />
          <Text style={styles.captureText}>Take photo</Text>
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.fieldError}>{error}</Text> : !shot ? <Text style={styles.helper}>{helper}</Text> : null}

      <CameraCapture visible={camera} title="Payment screen" onCapture={onShot} onClose={() => setCamera(false)} />
      <ImageViewer
        visible={viewer && !!shot}
        images={shot ? [{ url: shot.localUri, label }] : []}
        onClose={() => setViewer(false)}
      />
    </View>
  );
}

/**
 * Cash / UPI / Split / Credit (and Online where the screen offers Razorpay
 * checkout — the screen renders that part itself) for `amount`.
 */
export default function CounterPaymentPicker({
  ctl,
  amount,
  methods = COUNTER_PAYMENT_METHODS,
  disabled,
  title = 'Payment method',
  creditNotice,
  style,
}: {
  ctl: CounterPaymentController;
  amount: number;
  methods?: readonly PaymentMethodKey[];
  disabled?: boolean;
  /** Label above the chips; null when the screen renders its own. */
  title?: string | null;
  /** Shown in the Credit panel, e.g. why credit can't cover a safety deposit. */
  creditNotice?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { method, errors } = ctl;
  const amountText = inrCounter(amount);
  const upiPart = splitUpiPart(amount, ctl.cash);

  return (
    <View style={[styles.wrap, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Chips
        options={methods.map((m) => ({ key: m, label: CHIP_LABEL[m], icon: METHOD_ICON[m] }))}
        value={method}
        onSelect={ctl.setMethod}
        disabled={disabled}
      />
      {errors.method ? <Text style={styles.fieldError}>{errors.method}</Text> : null}

      {method === 'UPI' && (
        <>
          <Text style={styles.hint}>
            Ask the customer to pay {amountText} to the shop's UPI QR, then photograph the payment-success screen on their phone.
          </Text>
          <PaymentProofCapture ctl={ctl.proof} error={errors.proof} disabled={disabled} />
        </>
      )}

      {method === 'SPLIT' && (
        <>
          <View style={styles.splitRow}>
            <View style={styles.splitCol}>
              <Text style={styles.fieldLabel}>Cash (₹)</Text>
              <TextInput
                style={[styles.input, !!errors.split && styles.inputError]}
                value={ctl.cash}
                onChangeText={ctl.setCash}
                placeholder="0"
                placeholderTextColor={Colors.ink4}
                keyboardType="decimal-pad"
                editable={!disabled}
              />
            </View>
            <View style={styles.splitCol}>
              <Text style={styles.fieldLabel}>UPI (₹)</Text>
              <View style={[styles.input, styles.readOnly]}>
                <Text style={styles.readOnlyText}>{upiPart > 0 ? upiPart.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</Text>
              </View>
            </View>
          </View>
          {errors.split ? (
            <Text style={styles.fieldError}>{errors.split}</Text>
          ) : (
            <Text style={styles.hint}>
              Of {amountText}: enter the cash part — the rest is paid by UPI to the shop's QR.
            </Text>
          )}
          <PaymentProofCapture
            ctl={ctl.proof}
            label={upiPart > 0 ? `Photo of the UPI payment (${inrCounter(upiPart)})` : 'Photo of the UPI payment'}
            error={errors.proof}
            disabled={disabled}
          />
        </>
      )}

      {method === 'CREDIT' && (
        <>
          <View style={styles.creditInfo}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.availLow} />
            <Text style={styles.creditInfoText}>
              {amountText} stays owed by the customer. The branch manager clears it when they pay.
            </Text>
          </View>
          {creditNotice}
          <Text style={styles.fieldLabel}>Collateral held</Text>
          <TextInput
            style={[styles.input, styles.collateralInput, !!errors.collateral && styles.inputError]}
            value={ctl.collateral}
            onChangeText={ctl.setCollateral}
            placeholder="e.g. Original Aadhaar card"
            placeholderTextColor={Colors.ink4}
            maxLength={COLLATERAL_MAX_LENGTH}
            multiline
            editable={!disabled}
          />
          {errors.collateral ? (
            <Text style={styles.fieldError}>{errors.collateral}</Text>
          ) : (
            <Text style={styles.helper}>{COLLATERAL_HELPER}</Text>
          )}
        </>
      )}
    </View>
  );
}

/** Cash / UPI for paying money back (drop deposit refund, bill refund). */
export function CounterRefundPicker({
  ctl,
  amount,
  title,
  disabled,
  style,
}: {
  ctl: CounterRefundController;
  amount: number;
  title?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const amountText = inrCounter(amount);
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title ?? `Refund ${amountText} by`}</Text>
      <Chips
        options={[
          { key: 'CASH' as const, label: 'Cash', icon: 'wallet-outline' as IconName },
          { key: 'UPI' as const, label: 'UPI', icon: 'qr-code-outline' as IconName },
        ]}
        value={ctl.method}
        onSelect={ctl.setMethod}
        disabled={disabled}
      />
      {ctl.method === 'CASH' ? (
        <>
          <Text style={styles.hint}>
            Pay {amountText} back in cash from your drawer. The branch manager acknowledges cash refunds.
          </Text>
          {ctl.error ? <Text style={styles.fieldError}>{ctl.error}</Text> : null}
        </>
      ) : (
        <>
          <Text style={styles.hint}>Send {amountText} to the customer by UPI.</Text>
          <PaymentProofCapture
            ctl={ctl.proof}
            required={false}
            label="Photo of the UPI transfer (optional)"
            helper="Photograph the transfer's success screen if you can."
            error={ctl.error}
            disabled={disabled}
          />
        </>
      )}
    </View>
  );
}

const TILE = 72;
const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
  dim: { opacity: 0.5 },

  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  helper: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginBottom: 6 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone, lineHeight: 17 },
  errorText: { color: Colors.availNone },

  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  inputError: { borderColor: Colors.availNone },
  readOnly: { justifyContent: 'center', backgroundColor: Colors.surface },
  readOnlyText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink2 },
  collateralInput: { fontFamily: Fonts.body, fontSize: 15, minHeight: 48, textAlignVertical: 'top' },

  splitRow: { flexDirection: 'row', gap: 10 },
  splitCol: { flex: 1 },

  creditInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.availLowSoft,
    borderRadius: 12,
    padding: 10,
  },
  creditInfoText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: '#92400e', lineHeight: 17 },

  proofCard: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 12,
    gap: 10,
  },
  proofCardError: { borderColor: Colors.availNone },
  proofHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofLabel: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  reqPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.availLowSoft,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  reqText: { fontFamily: Fonts.bodySemiBold, fontSize: 10, color: '#b45309' },
  proofBody: { flexDirection: 'row', gap: 12 },
  thumbWrap: { width: TILE, height: TILE, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.surface },
  thumb: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  overlayFailed: { backgroundColor: 'rgba(220,53,69,0.72)' },
  overlayText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.white },
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
  proofInfo: { flex: 1, gap: 3 },
  proofStatus: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  proofMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 16 },
  proofActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ghostBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.ink4,
    paddingVertical: 14,
  },
  captureText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
});
