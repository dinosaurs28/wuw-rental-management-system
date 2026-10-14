import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';
import { apiErrorMessage } from '../../../../lib/counterErrors';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../../components/employee/PhotoCaptureSection';
import {
  Card,
  FooterButton,
  FuelPicker,
  PhotoGrid,
  ScreenHeader,
  SectionHeader,
  balanceText,
  completedStyles as s,
  damageBillingLabel,
  isBalanceInput,
  fuelText,
  inr,
  kmText,
  num,
} from '../../../../components/employee/completed/CompletedParts';
import type { EditReturnBody, ReturnSummary, ReturnSummaryDamage } from '../../../../types/completedOperation';

type FieldKey = 'endOdometer' | 'returnFuelLevel' | 'returnFastagBalance';
const SEVERITIES = ['Minor', 'Moderate', 'Severe'] as const;
type Severity = (typeof SEVERITIES)[number];

interface DamageDraft {
  area: string;
  description: string;
  severity: string;
  photos: CapturedPhoto[];
}

// Edit Return (client item 1): the readings, photos and damage notes the drop
// captured, prefilled with what was saved. Charges stay with the branch manager;
// a reading that would change them is refused (409 EDIT_CHANGES_CHARGES).
export default function EditReturnScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<ReturnSummary>({
    queryKey: ['employee', 'return-summary', bookingId],
    queryFn: async () => (await employeeApi.getReturnSummary(bookingId as string)).data.data,
    enabled: !!bookingId,
    retry: false,
  });

  const [endOdo, setEndOdo] = useState('');
  const [fuel, setFuel] = useState<string | null>(null);
  const [fastag, setFastag] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [damages, setDamages] = useState<Record<string, DamageDraft>>({});
  // Shots still uploading, per photo section
  const [pending, setPending] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: FieldKey; message: string } | null>(null);
  const loadedRef = useRef<ReturnSummary | null>(null);
  // Photos taken during this edit: the ones dropped before saving — or all of them
  // when the edit is left unsaved — are deleted on the way out (saved photos are kept)
  const uploadedRef = useRef(new Set<string>());
  const keptRef = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const fileId of uploadedRef.current) {
        if (!keptRef.current.has(fileId)) employeeApi.deleteReturnImage(fileId).catch(() => {});
      }
    },
    [],
  );

  // Prefill once from what the drop saved
  useEffect(() => {
    if (!data || loadedRef.current) return;
    loadedRef.current = data;
    setEndOdo(data.odometer.end != null ? String(data.odometer.end) : '');
    setFuel(data.fuel.return);
    setFastag(data.fastag.balance != null ? String(Number(data.fastag.balance)) : '');
    setPhotos(data.photos.map((p) => ({ fileId: p.fileId, url: p.url })));
    setDamages(
      Object.fromEntries(
        data.damages.map((d) => [
          d.publicId,
          { area: d.area, description: d.description, severity: d.severity, photos: d.photos.map((p) => ({ fileId: p.fileId, url: p.url })) },
        ]),
      ),
    );
  }, [data]);

  const original = loadedRef.current;

  const body = useMemo((): EditReturnBody => {
    if (!original) return {};
    const out: EditReturnBody = {};
    if (endOdo.trim() !== '' && Number(endOdo) !== original.odometer.end) out.endOdometer = Number(endOdo);
    if (original.edit.fuelEditable && fuel && fuel !== original.fuel.return) out.returnFuelLevel = fuel;
    if (
      original.fastag.hasFastag &&
      isBalanceInput(fastag) &&
      (original.fastag.balance == null || Number(fastag) !== Number(original.fastag.balance))
    ) {
      out.returnFastagBalance = Number(fastag);
    }
    const before = new Set(original.photos.map((p) => p.fileId));
    const now = new Set(photos.map((p) => p.fileId));
    const removed = original.photos.filter((p) => !now.has(p.fileId)).map((p) => p.fileId);
    const added = photos.filter((p) => !before.has(p.fileId)).map((p) => ({ fileId: p.fileId }));
    if (removed.length) out.removeFileIds = removed;
    if (added.length) out.addPhotos = added;
    const damageEdits: NonNullable<EditReturnBody['damages']> = [];
    for (const d of original.damages) {
      const draft = damages[d.publicId];
      if (!d.editable || !draft) continue;
      const entry: NonNullable<EditReturnBody['damages']>[number] = { publicId: d.publicId };
      if (draft.area.trim() !== d.area) entry.area = draft.area.trim();
      if (draft.description.trim() !== d.description) entry.description = draft.description.trim();
      if (draft.severity !== d.severity) entry.severity = draft.severity as Severity;
      const had = new Set(d.photos.map((p) => p.fileId));
      const has = new Set(draft.photos.map((p) => p.fileId));
      const gone = d.photos.filter((p) => !has.has(p.fileId)).map((p) => p.fileId);
      const fresh = draft.photos.filter((p) => !had.has(p.fileId)).map((p) => p.fileId);
      if (gone.length) entry.removeFileIds = gone;
      if (fresh.length) entry.addPhotoIds = fresh;
      if (Object.keys(entry).length > 1) damageEdits.push(entry);
    }
    if (damageEdits.length) out.damages = damageEdits;
    return out;
  }, [original, endOdo, fuel, fastag, photos, damages]);

  if (isLoading || (data && !original)) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Edit Return" bookingId={bookingId} />
        <ActivityIndicator style={s.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !data || !original) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Edit Return" bookingId={bookingId} />
        <View style={s.emptyState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={s.emptyText}>Could not load this return.</Text>
        </View>
      </View>
    );
  }

  // Not completed: the return screen is where it is done
  if (!data.edit.allowed) return <Redirect href={`/employee/return/${data.booking.publicId}` as Href} />;

  const odo = original.odometer;
  const endProblem =
    endOdo.trim() === ''
      ? odo.end != null ? 'Enter the odometer reading at drop.' : null
      : !/^\d+$/.test(endOdo.trim())
        ? 'Enter a whole number of km.'
        : odo.measured && odo.start != null && Number(endOdo) < odo.start
          ? `End odometer can't be less than ${odo.swapCount > 0 ? "the replacement vehicle's reading at the swap" : 'the pickup reading'} (${kmText(odo.start)}).`
          : null;
  const fastagProblem =
    original.fastag.hasFastag && fastag.trim() !== '' && !isBalanceInput(fastag)
      ? 'Enter the FASTag balance in ₹ (up to 2 decimals).'
      : null;
  const damageProblem = original.damages
    .filter((d) => d.editable && damages[d.publicId])
    .map((d) => {
      const draft = damages[d.publicId]!;
      if (!draft.area.trim()) return 'Enter the damaged area.';
      if (draft.description.trim().length < 3) return 'Describe the damage (at least 3 characters).';
      if (draft.photos.length === 0) return 'Keep at least one photo of each damage.';
      return null;
    })
    .find(Boolean) ?? null;
  const pendingCount = Object.values(pending).reduce((sum, n) => sum + n, 0);
  const changed = Object.keys(body).length > 0;
  const photosEmptied = original.photos.length > 0 && photos.length === 0;
  const blocker =
    endProblem ??
    (photosEmptied ? 'Keep at least one return photo — replace a photo rather than removing them all.' : null) ??
    fastagProblem ??
    damageProblem ??
    (pendingCount > 0 ? 'Wait for the photos to upload (retry or remove failed ones).' : null) ??
    (!changed ? 'Nothing changed yet.' : null);

  const setDamage = (publicId: string, patch: Partial<DamageDraft>) =>
    setDamages((all) => ({ ...all, [publicId]: { ...all[publicId]!, ...patch } }));
  const setPendingFor = (key: string) => (count: number) => setPending((all) => ({ ...all, [key]: count }));

  const save = async () => {
    if (blocker || saving) return;
    setSaving(true);
    setErrorMsg(null);
    setFieldError(null);
    try {
      const res = await employeeApi.editReturn(data.booking.publicId, body);
      keptRef.current = new Set([
        ...photos.map((p) => p.fileId),
        ...Object.values(damages).flatMap((d) => d.photos.map((p) => p.fileId)),
      ]);
      qc.setQueryData(['employee', 'return-summary', bookingId], res.data.data);
      qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
      router.back();
    } catch (err: any) {
      const field = err?.response?.data?.field as string | undefined;
      const message = apiErrorMessage(err, 'Could not save the changes. Try again.');
      if (field === 'endOdometer' || field === 'returnFuelLevel' || field === 'returnFastagBalance') {
        setFieldError({ field, message });
      } else {
        setErrorMsg(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (field: FieldKey) => (fieldError?.field === field ? fieldError.message : null);

  const renderDamage = (d: ReturnSummaryDamage) => {
    const draft = damages[d.publicId];
    if (!d.editable || !draft) {
      return (
        <Card key={d.publicId}>
          <Text style={styles.damageArea}>{d.area || 'Damage'} · {d.severity}</Text>
          {d.description ? <Text style={styles.damageText}>{d.description}</Text> : null}
          <Text style={[s.hint, { marginTop: 6 }]}>Reviewed by the branch manager — only they can change it.</Text>
          <View style={{ marginTop: 12 }}>
            <PhotoGrid photos={d.photos} emptyText="No photos." />
          </View>
        </Card>
      );
    }
    return (
      <Card key={d.publicId}>
        <Text style={s.fieldLabel}>Damaged area</Text>
        <TextInput
          style={s.input}
          value={draft.area}
          onChangeText={(t) => setDamage(d.publicId, { area: t })}
          placeholder="e.g. Front bumper"
          placeholderTextColor={Colors.ink4}
          maxLength={120}
        />
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Severity</Text>
        <View style={s.chipRow}>
          {SEVERITIES.map((sev) => {
            const active = draft.severity === sev;
            return (
              <TouchableOpacity
                key={sev}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setDamage(d.publicId, { severity: sev })}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{sev}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>What's damaged</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={draft.description}
          onChangeText={(t) => setDamage(d.publicId, { description: t })}
          placeholder="Describe the damage"
          placeholderTextColor={Colors.ink4}
          multiline
          maxLength={1000}
        />
        <Text style={[s.hint, { marginTop: 10 }]}>
          {num(d.amount) > 0 ? `${inr(num(d.amount))} · ` : ''}
          {damageBillingLabel(d)} — the amount can't be changed here.
        </Text>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Damage photos</Text>
        <PhotoCaptureSection
          allowGeneric
          value={draft.photos}
          onChange={(next) => setDamage(d.publicId, { photos: next })}
          onPendingChange={setPendingFor(`damage:${d.publicId}`)}
          upload={async (formData) => {
            const res = await employeeApi.uploadDamageImage(formData);
            uploadedRef.current.add(res.data.fileId);
            return { fileId: res.data.fileId, url: res.data.url };
          }}
          genericLabel="Add photo"
          profile="damage"
        />
      </Card>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Edit Return" bookingId={data.booking.publicId} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 140 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.hint}>
          {data.vehicles.map((v) => `${v.make} ${v.model} · ${v.regNo}`).join(', ')} · {data.customer.name}
        </Text>

        <View style={s.noticeBox}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.availLow} />
          <Text style={s.noticeText}>
            Charges, discounts and the safety deposit can't be changed here. A reading that would change a charge
            already worked out is refused — ask the branch manager to adjust the bill.
          </Text>
        </View>

        <SectionHeader title="Odometer at drop" />
        <Card>
          <TextInput
            style={[s.input, (errorFor('endOdometer') || (endProblem && endOdo !== '')) && s.inputError]}
            value={endOdo}
            onChangeText={(t) => {
              setEndOdo(t.replace(/[^0-9]/g, ''));
              if (fieldError?.field === 'endOdometer') setFieldError(null);
            }}
            keyboardType="number-pad"
            placeholder="Reading at drop (km)"
            placeholderTextColor={Colors.ink4}
          />
          {errorFor('endOdometer') ? (
            <Text style={s.fieldError}>{errorFor('endOdometer')}</Text>
          ) : endProblem && endOdo !== '' ? (
            <Text style={s.fieldError}>{endProblem}</Text>
          ) : (
            <Text style={[s.hint, { marginTop: 8 }]}>
              {odo.swapCount > 0 && odo.start != null
                ? `Replacement car started at ${kmText(odo.start)}.`
                : `Pickup reading: ${kmText(odo.pickup)}.`}
              {!odo.measured ? ' Km driven can\'t be measured (swap without readings).' : ''}
            </Text>
          )}
        </Card>

        <SectionHeader title="Fuel at drop" />
        <Card>
          {data.edit.fuelEditable ? (
            <>
              <FuelPicker
                value={fuel}
                onChange={(v) => {
                  setFuel(v);
                  if (fieldError?.field === 'returnFuelLevel') setFieldError(null);
                }}
              />
              <Text style={[s.hint, { marginTop: 8 }]}>At pickup: {fuelText(data.fuel.pickup)}</Text>
            </>
          ) : (
            <Text style={s.hint}>No fuel reading was kept for this rental.</Text>
          )}
          {errorFor('returnFuelLevel') ? <Text style={s.fieldError}>{errorFor('returnFuelLevel')}</Text> : null}
        </Card>

        {data.fastag.hasFastag && (
          <>
            <SectionHeader title="FASTag balance at drop" />
            <Card>
              <TextInput
                style={[s.input, (errorFor('returnFastagBalance') || fastagProblem) && s.inputError]}
                value={fastag}
                onChangeText={(t) => {
                  setFastag(t.replace(/[^0-9.]/g, ''));
                  if (fieldError?.field === 'returnFastagBalance') setFieldError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="₹ on the tag at the drop"
                placeholderTextColor={Colors.ink4}
              />
              {errorFor('returnFastagBalance') || fastagProblem ? (
                <Text style={s.fieldError}>{errorFor('returnFastagBalance') ?? fastagProblem}</Text>
              ) : (
                <Text style={[s.hint, { marginTop: 8 }]}>
                  At the handover: {balanceText(data.fastag.startBalance)}. A change that alters the FASTag charge is refused.
                </Text>
              )}
            </Card>
          </>
        )}

        <SectionHeader title="Return photos" />
        <Card>
          <PhotoCaptureSection
            allowGeneric
            value={photos}
            onChange={setPhotos}
            onPendingChange={setPendingFor('return')}
            upload={async (formData) => {
              const res = await employeeApi.uploadReturnImage(formData);
              uploadedRef.current.add(res.data.fileId);
              return { fileId: res.data.fileId, url: res.data.url };
            }}
            genericLabel="Add photo"
          />
        </Card>

        {data.damages.length > 0 && (
          <>
            <SectionHeader title={`Damage found (${data.damages.length})`} />
            {data.damages.map(renderDamage)}
          </>
        )}

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

const styles = StyleSheet.create({
  damageArea: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  damageText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, marginTop: 6, lineHeight: 18 },
});
