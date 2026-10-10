import { Alert } from 'react-native';
import type { CapturedPhoto } from '../components/employee/PhotoCaptureSection';
import type { CounterPaymentController, CounterRefundController } from '../components/employee/CounterPaymentPicker';
import { COUNTER_PAYMENT_METHODS, COUNTER_REFUND_METHODS } from '../lib/counterPayment';
import { DL_SELECTABLE_STATUSES, type DlCollectionStatus } from '../lib/dlStatus';
import { draftBool, draftNumber, draftOneOf, draftString, proofDraftId } from '../lib/operationDraft';
import { useOperationDraft, type OperationDraftController } from './useOperationDraft';

// Paused pickup (client item 2): which pickup-screen fields are kept and how
// they come back. Bump PICKUP_DRAFT_SCHEMA when the layout of `data` changes.
const PICKUP_DRAFT_SCHEMA = 1;

type Setter<T> = (value: T) => void;

export interface PickupDraftFields {
  odo: string;
  fuelLevel: number | null;
  dlStatus: DlCollectionStatus | null;
  dlNumberEditing: boolean;
  dlNumberInput: string;
  // Legacy flow
  requireManager: boolean;
  requestDeposit: boolean;
  depositAmount: string;
  depositReason: string;
  // Payment-session flow (the bill itself is on the server)
  couponCode: string;
  depositOpen: boolean;
  sDepositAmt: string;
  sDepositReason: string;
}

interface Options {
  bookingId: string | undefined;
  enabled: boolean;
  // The booked vehicle (reg no): readings and photos only come back for the same car.
  vehicleKey: string | null;
  // The odometer prefilled from the vehicle — not something staff entered.
  odoPrefill: string | null;
  fields: PickupDraftFields;
  setters: { [K in keyof PickupDraftFields as `set${Capitalize<K>}`]: Setter<PickupDraftFields[K]> };
  photos: CapturedPhoto[];
  setPhotos: Setter<CapturedPhoto[]>;
  pendingPhotos: number;
  pay: CounterPaymentController;
  refundPay: CounterRefundController;
  onGone: () => void;
}

export function usePickupDraft({
  bookingId,
  enabled,
  vehicleKey,
  odoPrefill,
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
    f.fuelLevel == null &&
    f.dlStatus == null &&
    !f.dlNumberEditing &&
    !f.dlNumberInput.trim() &&
    !f.requireManager &&
    !f.requestDeposit &&
    !f.depositAmount &&
    !f.depositReason &&
    !f.couponCode &&
    !f.depositOpen &&
    (f.odo === '' || f.odo === odoPrefill);

  return useOperationDraft({
    type: 'PICKUP',
    bookingId,
    enabled,
    schemaVersion: PICKUP_DRAFT_SCHEMA,
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
      // A vehicle swap since then: that car's readings and photos don't apply.
      const sameVehicle = !savedVehicle || !vehicleKey || savedVehicle === vehicleKey;
      if (sameVehicle) {
        const odo = draftString(d, 'odo');
        if (odo) s.setOdo(odo);
        const fuel = draftNumber(d, 'fuelLevel');
        s.setFuelLevel(fuel != null && fuel >= 1 && fuel <= 10 ? fuel : null);
        setPhotos(savedPhotos);
      } else {
        Alert.alert(
          'Vehicle changed',
          `This pickup was saved for ${savedVehicle}. Enter the odometer and fuel level and take the photos again for ${vehicleKey}.`,
        );
      }
      s.setDlStatus(draftOneOf(d, 'dlStatus', DL_SELECTABLE_STATUSES));
      s.setDlNumberEditing(draftBool(d, 'dlNumberEditing'));
      s.setDlNumberInput(draftString(d, 'dlNumberInput'));
      s.setRequireManager(draftBool(d, 'requireManager'));
      s.setRequestDeposit(draftBool(d, 'requestDeposit'));
      s.setDepositAmount(draftString(d, 'depositAmount'));
      s.setDepositReason(draftString(d, 'depositReason'));
      s.setCouponCode(draftString(d, 'couponCode'));
      s.setDepositOpen(draftBool(d, 'depositOpen'));
      s.setSDepositAmt(draftString(d, 'sDepositAmt'));
      s.setSDepositReason(draftString(d, 'sDepositReason'));
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
