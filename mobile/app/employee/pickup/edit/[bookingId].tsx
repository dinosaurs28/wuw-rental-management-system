import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';
import { apiErrorMessage } from '../../../../lib/counterErrors';
import { dlInUseErrorText } from '../../../../lib/dlInUse';
import { dlStatusLabel, type DlCollectionStatus } from '../../../../lib/dlStatus';
import { drivingLicenceError, normalizeDrivingLicence } from '../../../../lib/identity';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../../components/employee/PhotoCaptureSection';
import { DlStatusSelector } from '../../../../components/employee/DlStatus';
import {
  Card,
  FooterButton,
  FuelPicker,
  ScreenHeader,
  SectionHeader,
  completedStyles as s,
  isBalanceInput,
} from '../../../../components/employee/completed/CompletedParts';
import type { EditPickupBody, PickupSummary } from '../../../../types/completedOperation';

type FieldKey = 'odo' | 'pickupFuelLevel' | 'pickupFastagBalance' | 'dlStatus' | 'drivingLicenceNumber';

// Edit Pickup (client item 1): every field the pickup captured, prefilled with
// what was saved. Only what changed is sent; the server refuses a reading that
// would change charges already computed (409 EDIT_CHANGES_CHARGES).
export default function EditPickupScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<PickupSummary>({
    queryKey: ['employee', 'pickup-summary', bookingId],
    queryFn: async () => (await employeeApi.getPickupSummary(bookingId as string)).data.data,
    enabled: !!bookingId,
    retry: false,
  });

  const [odo, setOdo] = useState('');
  const [fuel, setFuel] = useState<string | null>(null);
  const [fastag, setFastag] = useState('');
  const [dlStatus, setDlStatus] = useState<DlCollectionStatus | null>(null);
  const [dlNumber, setDlNumber] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: FieldKey; message: string } | null>(null);
  const loadedRef = useRef<PickupSummary | null>(null);
  // Photos taken during this edit: the ones dropped before saving — or all of them
  // when the edit is left unsaved — are deleted on the way out (saved photos are kept)
  const uploadedRef = useRef(new Set<string>());
  const keptRef = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const fileId of uploadedRef.current) {
        if (!keptRef.current.has(fileId)) employeeApi.deletePickupImage(fileId).catch(() => {});
      }
    },
    [],
  );

  // Prefill once from what the pickup saved
  useEffect(() => {
    if (!data || loadedRef.current) return;
    loadedRef.current = data;
    setOdo(data.odometer != null ? String(data.odometer) : '');
    setFuel(data.fuelLevel);
    setFastag(data.fastag.balance != null ? String(Number(data.fastag.balance)) : '');
    setDlStatus(data.dl.status);
    setDlNumber(data.customer.drivingLicenceNumber ?? '');
    setPhotos(data.photos.map((p) => ({ fileId: p.fileId, url: p.url, label: p.label ?? undefined })));
  }, [data]);

  const original = loadedRef.current;

  const body = useMemo((): EditPickupBody => {
    if (!original) return {};
    const out: EditPickupBody = {};
    if (odo.trim() !== '' && Number(odo) !== original.odometer) out.odo = Number(odo);
    if (fuel && fuel !== original.fuelLevel) out.pickupFuelLevel = fuel;
    if (
      original.fastag.hasFastag &&
      isBalanceInput(fastag) &&
      (original.fastag.balance == null || Number(fastag) !== Number(original.fastag.balance))
    ) {
      out.pickupFastagBalance = Number(fastag);
    }
    if (dlStatus && dlStatus !== original.dl.status) out.dlStatus = dlStatus;
    const onFile = original.customer.drivingLicenceNumber ?? '';
    if (dlNumber.trim() && normalizeDrivingLicence(dlNumber) !== onFile) {
      out.drivingLicenceNumber = normalizeDrivingLicence(dlNumber);
    }
    const before = new Set(original.photos.map((p) => p.fileId));
    const now = new Set(photos.map((p) => p.fileId));
    const removed = original.photos.filter((p) => !now.has(p.fileId)).map((p) => p.fileId);
    const added = photos.filter((p) => !before.has(p.fileId)).map((p) => ({ fileId: p.fileId, label: p.label ?? null }));
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added;
    return out;
  }, [original, odo, fuel, fastag, dlStatus, dlNumber, photos]);

  if (isLoading || (data && !original)) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Edit Pickup" bookingId={bookingId} />
        <ActivityIndicator style={s.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !data || !original) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Edit Pickup" bookingId={bookingId} />
        <View style={s.emptyState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={s.emptyText}>Could not load this pickup.</Text>
        </View>
      </View>
    );
  }

  // Not completed: the pickup screen is where it is done
  if (!data.edit.allowed) return <Redirect href={`/employee/pickup/${data.booking.publicId}` as Href} />;

  // Old pickups saved without a reading may stay without one
  const odoProblem =
    odo.trim() === ''
      ? original.odometer != null ? 'Enter the odometer reading.' : null
      : !/^\d+$/.test(odo.trim()) || Number(odo) <= 0 ? 'Enter a whole number of km.' : null;
  const fastagProblem =
    data.fastag.hasFastag && fastag.trim() !== '' && !isBalanceInput(fastag)
      ? 'Enter the FASTag balance in ₹ (up to 2 decimals).'
      : null;
  const dlNumberProblem =
    dlNumber.trim() && normalizeDrivingLicence(dlNumber) !== (original.customer.drivingLicenceNumber ?? '')
      ? drivingLicenceError(dlNumber)
      : null;
  // A required slot that had a photo can't be left empty
  const hadLabel = new Set(original.photos.map((p) => p.label).filter(Boolean));
  const emptiedSlots = original.captureFields.filter(
    (f) => f.required && hadLabel.has(f.name) && !photos.some((p) => p.label === f.name),
  );
  const changed = Object.keys(body).length > 0;
  const photosEmptied = original.photos.length > 0 && photos.length === 0;
  const blocker =
    odoProblem ??
    fastagProblem ??
    dlNumberProblem ??
    (photosEmptied ? 'Keep at least one pickup photo — replace a photo rather than removing them all.' : null) ??
    (emptiedSlots.length > 0
      ? `Take the required photo${emptiedSlots.length > 1 ? 's' : ''}: ${emptiedSlots.map((f) => f.name).join(', ')}.`
      : null) ??
    (pendingPhotos > 0 ? 'Wait for the photos to upload (retry or remove failed ones).' : null) ??
    (!changed ? 'Nothing changed yet.' : null);

  const save = async () => {
    if (blocker || saving) return;
    setSaving(true);
    setErrorMsg(null);
    setFieldError(null);
    try {
      const res = await employeeApi.editPickup(data.booking.publicId, body);
      keptRef.current = new Set(photos.map((p) => p.fileId));
      qc.setQueryData(['employee', 'pickup-summary', bookingId], res.data.data);
      qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
      qc.invalidateQueries({ queryKey: ['employee', 'pickup', bookingId] });
      router.back();
    } catch (err: any) {
      const res = err?.response?.data;
      const message = dlInUseErrorText(err) ?? apiErrorMessage(err, 'Could not save the changes. Try again.');
      const field = (res?.field as FieldKey | undefined) ??
        (res?.code === 'INVALID_DL_NUMBER' || res?.code === 'DL_NUMBER_REQUIRED' ? 'drivingLicenceNumber'
          : String(res?.code ?? '').startsWith('DL_STATUS') ? 'dlStatus' : undefined);
      if (field && ['odo', 'pickupFuelLevel', 'pickupFastagBalance', 'dlStatus', 'drivingLicenceNumber'].includes(field)) {
        setFieldError({ field, message });
      } else {
        setErrorMsg(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (field: FieldKey) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Edit Pickup" bookingId={data.booking.publicId} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 140 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.hint}>
          {data.vehicles.map((v) => `${v.make} ${v.model} · ${v.regNo}`).join(', ')} · {data.customer.name}
        </Text>

        <SectionHeader title="Odometer" />
        <Card>
          <TextInput
            style={[s.input, errorFor('odo') && s.inputError]}
            value={odo}
            onChangeText={(t) => {
              setOdo(t.replace(/[^0-9]/g, ''));
              if (fieldError?.field === 'odo') setFieldError(null);
            }}
            keyboardType="number-pad"
            placeholder="Reading at pickup (km)"
            placeholderTextColor={Colors.ink4}
          />
          {errorFor('odo') ? (
            <Text style={s.fieldError}>{errorFor('odo')}</Text>
          ) : odoProblem && odo !== '' ? (
            <Text style={s.fieldError}>{odoProblem}</Text>
          ) : data.edit.odometerCheckedAgainstCharges ? (
            <Text style={[s.hint, { marginTop: 8 }]}>
              The drop already worked out km from this reading — a change that alters the km charge is refused.
            </Text>
          ) : null}
        </Card>

        <SectionHeader title="Fuel level" />
        <Card>
          <FuelPicker
            value={fuel}
            onChange={(v) => {
              setFuel(v);
              if (fieldError?.field === 'pickupFuelLevel') setFieldError(null);
            }}
          />
          {errorFor('pickupFuelLevel') ? <Text style={s.fieldError}>{errorFor('pickupFuelLevel')}</Text> : null}
        </Card>

        {data.fastag.hasFastag && (
          <>
            <SectionHeader title="FASTag balance" />
            <Card>
              <TextInput
                style={[s.input, (errorFor('pickupFastagBalance') || fastagProblem) && s.inputError]}
                value={fastag}
                onChangeText={(t) => {
                  setFastag(t.replace(/[^0-9.]/g, ''));
                  if (fieldError?.field === 'pickupFastagBalance') setFieldError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="₹ on the tag at the handover"
                placeholderTextColor={Colors.ink4}
              />
              {errorFor('pickupFastagBalance') || fastagProblem ? (
                <Text style={s.fieldError}>{errorFor('pickupFastagBalance') ?? fastagProblem}</Text>
              ) : data.edit.fastagCheckedAgainstCharges ? (
                <Text style={[s.hint, { marginTop: 8 }]}>
                  The drop billed FASTag from this balance — a change that alters the FASTag charge is refused.
                </Text>
              ) : null}
            </Card>
          </>
        )}

        <SectionHeader title="Original driving licence" />
        <Card>
          {data.edit.dlStatusEditable ? (
            <DlStatusSelector
              value={dlStatus}
              onChange={(v) => {
                setDlStatus(v);
                if (fieldError?.field === 'dlStatus') setFieldError(null);
              }}
            />
          ) : (
            <>
              <Text style={s.fieldLabel}>{dlStatusLabel(data.dl.status)}</Text>
              {data.edit.dlStatusLockedReason ? <Text style={s.hint}>{data.edit.dlStatusLockedReason}</Text> : null}
            </>
          )}
          {errorFor('dlStatus') ? <Text style={s.fieldError}>{errorFor('dlStatus')}</Text> : null}
        </Card>

        <SectionHeader title="Driving licence number" />
        <Card>
          <TextInput
            style={[s.input, (errorFor('drivingLicenceNumber') || dlNumberProblem) && s.inputError]}
            value={dlNumber}
            onChangeText={(t) => {
              setDlNumber(t.toUpperCase());
              if (fieldError?.field === 'drivingLicenceNumber') setFieldError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. KA01 20110012345"
            placeholderTextColor={Colors.ink4}
          />
          {errorFor('drivingLicenceNumber') || dlNumberProblem ? (
            <Text style={s.fieldError}>{errorFor('drivingLicenceNumber') ?? dlNumberProblem}</Text>
          ) : (
            <Text style={[s.hint, { marginTop: 8 }]}>Saved to the customer's profile.</Text>
          )}
        </Card>

        <SectionHeader title="Pickup photos" />
        <Card>
          <PhotoCaptureSection
            fields={data.captureFields}
            allowGeneric
            value={photos}
            onChange={setPhotos}
            onPendingChange={setPendingPhotos}
            upload={async (formData) => {
              const res = await employeeApi.uploadPickupImage(formData);
              uploadedRef.current.add(res.data.fileId);
              return { fileId: res.data.fileId, url: res.data.url };
            }}
            genericLabel="Add photo"
          />
        </Card>

        {errorMsg && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
            <Text style={s.errorBoxText}>{errorMsg}</Text>
          </View>
        )}
      </ScrollView>

      <FooterButton
        label="Save changes"
        icon="checkmark"
        onPress={save}
        disabled={!!blocker}
        busy={saving}
        hint={blocker && blocker !== 'Nothing changed yet.' ? blocker : null}
      />
    </KeyboardAvoidingView>
  );
}
