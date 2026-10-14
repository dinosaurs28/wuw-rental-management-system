// A damage recorded at the drop, edited with the completed drop (client item 1,
// full edit): what it says, its photos and — for damage the customer pays at
// the drop — its amount. Once the branch manager reviewed it, only they change it.
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';
import PhotoCaptureSection, { type CapturedPhoto } from '../PhotoCaptureSection';
import { PhotoGrid, completedStyles as s, damageBillingLabel } from '../completed/CompletedParts';
import type { ReturnSummaryDamage } from '../../../types/completedOperation';

export const DAMAGE_SEVERITIES = ['Minor', 'Moderate', 'Severe'] as const;

export interface DamageDraft {
  area: string;
  description: string;
  severity: string;
  amount: string;
  photos: CapturedPhoto[];
}

export const damageDraftOf = (d: ReturnSummaryDamage): DamageDraft => ({
  area: d.area,
  description: d.description,
  severity: d.severity,
  amount: String(Number(d.amount) || 0),
  photos: d.photos.map((p) => ({ fileId: p.fileId, url: p.url })),
});

/** First problem with an edited damage, or null. */
export function damageDraftProblem(draft: DamageDraft): string | null {
  if (!draft.area.trim()) return 'Enter the damaged area.';
  if (draft.description.trim().length < 3) return 'Describe the damage (at least 3 characters).';
  if (draft.photos.length === 0) return 'Keep at least one photo of each damage.';
  if (!/^\d+(\.\d{1,2})?$/.test(draft.amount.trim())) return 'Enter the damage cost in ₹.';
  return null;
}

interface Props {
  damage: ReturnSummaryDamage;
  draft: DamageDraft | undefined;
  onChange: (patch: Partial<DamageDraft>) => void;
  upload: (formData: FormData) => Promise<{ fileId: string; url: string }>;
  onPendingChange: (count: number) => void;
}

export default function DropDamageEditor({ damage, draft, onChange, upload, onPendingChange }: Props) {
  if (!damage.editable || !draft) {
    return (
      <View style={styles.block}>
        <Text style={styles.area}>{damage.area || 'Damage'} · {damage.severity}</Text>
        {damage.description ? <Text style={styles.text}>{damage.description}</Text> : null}
        <Text style={[s.hint, { marginTop: 6 }]}>Reviewed by the branch manager — only they can change it.</Text>
        <View style={{ marginTop: 12 }}>
          <PhotoGrid photos={damage.photos} emptyText="No photos." />
        </View>
      </View>
    );
  }
  // Damage the customer pays (on the drop bill, or charged by the manager) has a cost
  const priced = damage.billedAtDrop || damage.chargeCustomer;
  return (
    <View style={styles.block}>
      <Text style={s.fieldLabel}>Damaged area</Text>
      <TextInput
        style={s.input}
        value={draft.area}
        onChangeText={(t) => onChange({ area: t })}
        placeholder="e.g. Front bumper"
        placeholderTextColor={Colors.ink4}
        maxLength={120}
      />
      <Text style={[s.fieldLabel, { marginTop: 14 }]}>Severity</Text>
      <View style={s.chipRow}>
        {DAMAGE_SEVERITIES.map((sev) => {
          const active = draft.severity === sev;
          return (
            <TouchableOpacity
              key={sev}
              style={[s.chip, active && s.chipActive]}
              onPress={() => onChange({ severity: sev })}
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
        onChangeText={(t) => onChange({ description: t })}
        placeholder="Describe the damage"
        placeholderTextColor={Colors.ink4}
        multiline
        maxLength={1000}
      />
      {priced ? (
        <>
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>Damage cost (₹)</Text>
          <TextInput
            style={s.input}
            value={draft.amount}
            onChangeText={(t) => onChange({ amount: t.replace(/[^\d.]/g, '') })}
            keyboardType="decimal-pad"
            placeholder="₹"
            placeholderTextColor={Colors.ink4}
          />
          <Text style={[s.hint, { marginTop: 6 }]}>{damageBillingLabel(damage)}.</Text>
        </>
      ) : (
        <Text style={[s.hint, { marginTop: 10 }]}>{damageBillingLabel(damage)}.</Text>
      )}
      <Text style={[s.fieldLabel, { marginTop: 14 }]}>Damage photos</Text>
      <PhotoCaptureSection
        allowGeneric
        value={draft.photos}
        onChange={(next) => onChange({ photos: next })}
        onPendingChange={onPendingChange}
        upload={upload}
        genericLabel="Add photo"
        profile="damage"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 0 },
  area: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  text: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, marginTop: 6, lineHeight: 18 },
});
