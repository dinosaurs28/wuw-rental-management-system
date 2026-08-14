import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import {
  type DamageEntry,
  type DamageSeverity,
} from '../../../types/return';
import PhotoUploader, { type UploadedPhoto } from './PhotoUploader';

interface Props {
  entry: DamageEntry;
  onChange: (next: DamageEntry) => void;
  onRemove: () => void;
  zones: readonly string[];
  /** Map of imageId -> photo URL/publicId for preview rendering. */
  photoMap: Record<string, UploadedPhoto>;
  onUploadPhoto: (formData: FormData) => Promise<UploadedPhoto>;
  index: number;
}

const SEVERITIES: { value: DamageSeverity; label: string; color: string }[] = [
  { value: 'MINOR',    label: 'Minor',    color: '#059669' },
  { value: 'MODERATE', label: 'Moderate', color: '#d97706' },
  { value: 'SEVERE',   label: 'Severe',   color: '#dc2626' },
];

export default function DamageEntryEditor({
  entry,
  onChange,
  onRemove,
  zones,
  photoMap,
  onUploadPhoto,
  index,
}: Props) {
  const set = <K extends keyof DamageEntry>(k: K, v: DamageEntry[K]) =>
    onChange({ ...entry, [k]: v });

  const photos: UploadedPhoto[] = entry.imageIds
    .map((id) => photoMap[id])
    .filter((p): p is UploadedPhoto => !!p);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Damage #{index + 1}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={16} color="#dc2626" />
        </TouchableOpacity>
      </View>

      {/* Area */}
      <Text style={styles.fieldLabel}>Area</Text>
      <View style={styles.zonesGrid}>
        {zones.map((zone) => {
          const active = entry.area === zone;
          return (
            <TouchableOpacity
              key={zone}
              style={[styles.zonePill, active && styles.zonePillActive]}
              onPress={() => set('area', zone)}
              activeOpacity={0.85}
            >
              <Text style={[styles.zoneLabel, active && styles.zoneLabelActive]}>{zone}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Severity */}
      <Text style={styles.fieldLabel}>Severity</Text>
      <View style={styles.sevRow}>
        {SEVERITIES.map((s) => {
          const active = entry.severity === s.value;
          return (
            <TouchableOpacity
              key={s.value}
              style={[
                styles.sevPill,
                active && { backgroundColor: s.color, borderColor: s.color },
              ]}
              onPress={() => set('severity', s.value)}
              activeOpacity={0.85}
            >
              <Text style={[styles.sevLabel, active && styles.sevLabelActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Description */}
      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput
        style={styles.input}
        value={entry.description}
        onChangeText={(t) => set('description', t)}
        placeholder="Brief description of the damage"
        placeholderTextColor={Colors.ink3}
        multiline
      />

      {/* Photos */}
      <Text style={styles.fieldLabel}>Photos</Text>
      <PhotoUploader
        photos={photos}
        onUpload={async (form) => {
          const uploaded = await onUploadPhoto(form);
          set('imageIds', [...entry.imageIds, uploaded.publicId]);
          return uploaded;
        }}
        onRemove={(p) => set('imageIds', entry.imageIds.filter((id) => id !== p.publicId))}
        fileNamePrefix={`damage_${index + 1}`}
        maxPhotos={6}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
  },
  zonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  zonePill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  zonePillActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  zoneLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  zoneLabelActive: { color: Colors.white },
  sevRow: { flexDirection: 'row', gap: 8 },
  sevPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
  },
  sevLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  sevLabelActive: { color: Colors.white },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    minHeight: 70,
    textAlignVertical: 'top',
  },
});
