import { Alert } from 'react-native';
import type { CapturedPhoto } from '../components/employee/PhotoCaptureSection';
import type { CounterPaymentController, CounterRefundController } from '../components/employee/CounterPaymentPicker';
import {
  COUNTER_PAYMENT_METHODS,
  COUNTER_REFUND_METHODS,
  SAFETY_DEPOSIT_HANDLING,
  type SafetyDepositHandling,
} from '../lib/counterPayment';
import { draftBool, draftOneOf, draftString, proofDraftId } from '../lib/operationDraft';
import { useOperationDraft, type OperationDraftController } from './useOperationDraft';

// Paused drop (client item 2): which drop-screen fields are kept and how they
// come back. Bump RETURN_DRAFT_SCHEMA when the layout of `data` changes. The
// drop bill (session), damages and payments live on the server already.
const RETURN_DRAFT_SCHEMA = 1;

const DAMAGE_DECISIONS = ['NO_DAMAGE', 'DAMAGE_FOUND'] as const;

type Setter<T> = (value: T) => void;

export interface ReturnDraftFields {
  endOdo: string;
  fuelLevel: string;
  chargeFuel: boolean;
  fuelAmt: string;
  chargeFastag: boolean;
  fastagAmt: string;
  fastagNote: string;
  chargeOther: boolean;
  otherLines: Array<{ id: string; label: string; amount: string }>;
  damageDecision: (typeof DAMAGE_DECISIONS)[number] | null;
  discount: { amount: number; reason: string } | null;
  depositHandling: SafetyDepositHandling;
  applyGrace: boolean;
  waiveLate: boolean;
  waiveReason: string;
  manualKm: string;
  requireManager: boolean;
}

interface Options {
  bookingId: string | undefined;
  enabled: boolean;
  // Vehicle being handed back (+ swap count): readings and photos only come back for the same car.
  vehicleKey: string | null;
  // Return fuel level preselected from the pickup level — not something staff entered.
  fuelDefault: string;
  fields: ReturnDraftFields;
  setters: { [K in keyof ReturnDraftFields as `set${Capitalize<K>}`]: Setter<ReturnDraftFields[K]> };
  photos: CapturedPhoto[];
  setPhotos: Setter<CapturedPhoto[]>;
  pendingPhotos: number;
  pay: CounterPaymentController;
  refundPay: CounterRefundController;
  onGone: () => void;
}

function readOtherLines(value: unknown): ReturnDraftFields['otherLines'] {
  const lines = Array.isArray(value)
    ? value.flatMap((l, i) => {
        const line = l as { id?: unknown; label?: unknown; amount?: unknown } | null;
        return line && typeof line === 'object'
          ? [{
              id: typeof line.id === 'string' ? line.id : `${Date.now()}_${i}`,
              label: typeof line.label === 'string' ? line.label : '',
              amount: typeof line.amount === 'string' ? line.amount : '',
            }]
          : [];
      })
    : [];
  return lines.length ? lines : [{ id: String(Date.now() + Math.random()), label: '', amount: '' }];
}

function readDiscount(value: unknown): ReturnDraftFields['discount'] {
  const d = value as { amount?: unknown; reason?: unknown } | null;
  return d && typeof d === 'object' && typeof d.amount === 'number' && d.amount > 0 && typeof d.reason === 'string'
    ? { amount: d.amount, reason: d.reason }
    : null;
}

export function useReturnDraft({
  bookingId,
  enabled,
  vehicleKey,
  fuelDefault,
  fields: f,
  setters: s,
  photos,
  setPhotos,
  pendingPhotos,
  pay,
  refundPay,
  onGone,
}: Options): OperationDraftController {
  const isEmpty =
    photos.length === 0 &&
    !f.endOdo.trim() &&
    !f.manualKm.trim() &&
    (f.fuelLevel === '' || f.fuelLevel === fuelDefault) &&
    !f.chargeFuel &&
    !f.chargeFastag &&
    !f.fastagAmt &&
    !f.fastagNote &&
    !f.chargeOther &&
    f.otherLines.every((l) => !l.label.trim() && !l.amount) &&
    f.damageDecision == null &&
    !f.discount &&
    f.depositHandling === 'SET_OFF' &&
    !f.applyGrace &&
    !f.waiveLate &&
    !f.waiveReason &&
    !f.requireManager;

  return useOperationDraft({
    type: 'RETURN',
    bookingId,
    enabled,
    schemaVersion: RETURN_DRAFT_SCHEMA,
    isEmpty,
    pendingUploads: pendingPhotos,
    snapshot: {
      data: {
        vehicleKey,
        ...f,
        payMethod: pay.method,
        payCash: pay.cash,
        payCollateral: pay.collateral,
        payProofId: proofDraftId(pay.proof),
        refundMethod: refundPay.method,
        refundProofId: proofDraftId(refundPay.proof),
      },
      photos,
    },
    onGone,
    onRestore: (draft, savedPhotos) => {
      const d = draft.data;
      const savedVehicle = draftString(d, 'vehicleKey') || null;
      // A mid-rental swap since then: that car's readings and photos don't apply.
      const sameVehicle = !savedVehicle || !vehicleKey || savedVehicle === vehicleKey;
      if (sameVehicle) {
        s.setEndOdo(draftString(d, 'endOdo'));
        const fuel = draftString(d, 'fuelLevel');
        if (/^([1-9]|10)$/.test(fuel)) s.setFuelLevel(fuel);
        s.setChargeFuel(draftBool(d, 'chargeFuel'));
        s.setFuelAmt(draftString(d, 'fuelAmt'));
        s.setManualKm(draftString(d, 'manualKm'));
        setPhotos(savedPhotos);
      } else {
        Alert.alert(
          'Vehicle changed',
          'The vehicle was swapped since this drop was saved. Enter the end odometer and fuel level and take the return photos again.',
        );
      }
      s.setChargeFastag(draftBool(d, 'chargeFastag'));
      s.setFastagAmt(draftString(d, 'fastagAmt'));
      s.setFastagNote(draftString(d, 'fastagNote'));
      s.setChargeOther(draftBool(d, 'chargeOther'));
      s.setOtherLines(readOtherLines(d.otherLines));
      const decision = draftOneOf(d, 'damageDecision', DAMAGE_DECISIONS);
      if (decision) s.setDamageDecision(decision);
      s.setDiscount(readDiscount(d.discount));
      s.setDepositHandling(draftOneOf(d, 'depositHandling', SAFETY_DEPOSIT_HANDLING) ?? 'SET_OFF');
      s.setApplyGrace(draftBool(d, 'applyGrace'));
      s.setWaiveLate(draftBool(d, 'waiveLate'));
      s.setWaiveReason(draftString(d, 'waiveReason'));
      s.setRequireManager(draftBool(d, 'requireManager'));
      // How the bill was going to be settled (the amounts come from the server
      // again; a proof photo is re-checked when the payment is recorded).
      const method = draftOneOf(d, 'payMethod', COUNTER_PAYMENT_METHODS);
      if (method) pay.setMethod(method);
      pay.setCash(draftString(d, 'payCash'));
      pay.setCollateral(draftString(d, 'payCollateral'));
      const payProofId = draftString(d, 'payProofId');
      if (payProofId) pay.proof.restore(payProofId);
      const refundMethod = draftOneOf(d, 'refundMethod', COUNTER_REFUND_METHODS);
      if (refundMethod) refundPay.setMethod(refundMethod);
      const refundProofId = draftString(d, 'refundProofId');
      if (refundProofId) refundPay.proof.restore(refundProofId);
    },
  });
}
