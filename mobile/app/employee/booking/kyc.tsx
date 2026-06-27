import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { useEmployeeBookingStore } from '../../../store/employeeBooking';
import type { KycType, KycSide } from '../../../types/api';

interface WalkinKyc {
  publicId: string; // CustomerKyc.publicId — this is the customer_kyc_id for booking create
  type: KycType;
  side: KycSide;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  file: { url: string };
}

const TYPES: { type: KycType; label: string }[] = [
  { type: 'DL', label: 'License' },
  { type: 'AADHAAR', label: 'Aadhaar' },
  { type: 'PAN', label: 'PAN' },
  { type: 'STUDENT_ID', label: 'Student' },
];
const SIDES: KycSide[] = ['FRONT', 'BACK'];
const STATUS_COLOR: Record<string, string> = { PENDING: '#d97706', APPROVED: '#059669', REJECTED: '#dc2626' };

export default function WalkinKycScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const customer = useEmployeeBookingStore((s) => s.customer);
  const vehicle = useEmployeeBookingStore((s) => s.vehicle);
  const customerKycId = useEmployeeBookingStore((s) => s.customerKycId);
  const setCustomerKycId = useEmployeeBookingStore((s) => s.setCustomerKycId);

  const [docType, setDocType] = useState<KycType>('DL');
  const [side, setSide] = useState<KycSide>('FRONT');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['employee', 'walkin-kyc', customer?.publicId],
    queryFn: async () => {
      const res = await employeeApi.walkinKycList(customer!.publicId);
      return (res.data?.data ?? []) as WalkinKyc[];
    },
    enabled: !!customer,
    staleTime: 15_000,
  });

  const pickAndUpload = async (source: 'camera' | 'gallery') => {
    if (!customer) return;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.7, allowsEditing: false };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera permission needed', 'Enable camera access to capture documents.'); return; }
      result = await ImagePicker.launchCameraAsync(opts);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(opts);
    }
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };
    const ext = extMap[mimeType] ?? asset.uri.split('.').pop() ?? 'jpg';
    const fileName = `kyc_${docType.toLowerCase()}_${side.toLowerCase()}_${Date.now()}.${ext}`;

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: asset.uri, name: fileName, type: mimeType } as any);
      form.append('kyc_type', docType);
      form.append('side', side);
      form.append('customer_public_id', customer.publicId);
      const res = await employeeApi.walkinKycUpload(form);
      // Auto-select the freshly uploaded document for the booking.
      const newId: string | undefined = res.data?.fileId;
      if (newId) setCustomerKycId(newId);
      await qc.invalidateQueries({ queryKey: ['employee', 'walkin-kyc', customer.publicId] });
    } catch (err: any) {
      Alert.alert('Upload failed', err?.response?.data?.message ?? 'Could not upload the document.');
    } finally {
      setUploading(false);
    }
  };

  const remove = (doc: WalkinKyc) => {
    Alert.alert('Remove document', `Remove ${doc.type} (${doc.side})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeleting(doc.publicId);
          try {
            await employeeApi.walkinKycDelete(doc.publicId);
            if (customerKycId === doc.publicId) setCustomerKycId(null);
            await qc.invalidateQueries({ queryKey: ['employee', 'walkin-kyc', customer!.publicId] });
          } catch (err: any) {
            Alert.alert('Failed', err?.response?.data?.message ?? 'Could not remove the document.');
          } finally {
            setDeleting(null);
          }
        },
      },
    ]);
  };

  if (!customer || !vehicle) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/employee/customer/search')} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Documents</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Start a booking first</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>KYC Documents</Text>
          <Text style={styles.subtitle}>{customer.name}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Add a document */}
        <Text style={styles.sectionLabel}>Add a document</Text>
        <View style={styles.card}>
          <Text style={styles.miniLabel}>Type</Text>
          <View style={styles.pillRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.type}
                style={[styles.pill, docType === t.type && styles.pillActive]}
                onPress={() => setDocType(t.type)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pillText, docType === t.type && styles.pillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.miniLabel, { marginTop: 12 }]}>Side</Text>
          <View style={styles.pillRow}>
            {SIDES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.pill, side === s && styles.pillActive]}
                onPress={() => setSide(s)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pillText, side === s && styles.pillTextActive]}>{s === 'FRONT' ? 'Front' : 'Back'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.sourceRow}>
            <TouchableOpacity style={[styles.sourceBtn, uploading && styles.disabled]} onPress={() => pickAndUpload('camera')} disabled={uploading} activeOpacity={0.85}>
              {uploading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                <>
                  <Ionicons name="camera-outline" size={16} color={Colors.white} />
                  <Text style={styles.sourceText}>Camera</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sourceBtn, styles.sourceGallery, uploading && styles.disabled]} onPress={() => pickAndUpload('gallery')} disabled={uploading} activeOpacity={0.85}>
              <Ionicons name="images-outline" size={16} color={Colors.ink} />
              <Text style={[styles.sourceText, { color: Colors.ink }]}>Gallery</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Uploaded docs */}
        <Text style={styles.sectionLabel}>Uploaded — tap to attach to booking</Text>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={Colors.orange} />
        ) : docs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-outline" size={22} color={Colors.ink4} />
            <Text style={styles.emptyCardText}>No documents yet. Add at least one to continue.</Text>
          </View>
        ) : (
          docs.map((doc) => {
            const selected = customerKycId === doc.publicId;
            return (
              <TouchableOpacity
                key={doc.publicId}
                style={[styles.docRow, selected && styles.docRowSelected]}
                onPress={() => setCustomerKycId(doc.publicId)}
                activeOpacity={0.85}
              >
                {doc.file?.url ? (
                  <Image source={{ uri: doc.file.url }} style={styles.docThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.docThumb, styles.docThumbPlaceholder]}>
                    <Ionicons name="document-outline" size={18} color={Colors.ink4} />
                  </View>
                )}
                <View style={styles.docInfo}>
                  <Text style={styles.docType}>{doc.type.replace(/_/g, ' ')} · {doc.side}</Text>
                  <Text style={[styles.docStatus, { color: STATUS_COLOR[doc.status] ?? Colors.ink3 }]}>{doc.status}</Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(doc)} disabled={deleting === doc.publicId} hitSlop={6}>
                  {deleting === doc.publicId ? <ActivityIndicator size="small" color="#dc2626" /> : <Ionicons name="trash-outline" size={16} color="#dc2626" />}
                </TouchableOpacity>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? Colors.orange : Colors.ink4}
                />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.cta, !customerKycId && styles.disabled]}
          onPress={() => router.push('/employee/booking/summary')}
          disabled={!customerKycId}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Continue to summary</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  content: { paddingHorizontal: 20, gap: 10 },
  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16 },
  miniLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  pillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  pillText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  pillTextActive: { color: Colors.white },

  sourceRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sourceBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.ink, borderRadius: 12, paddingVertical: 13, minHeight: 46,
  },
  sourceGallery: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  sourceText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  disabled: { opacity: 0.5 },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.hairline, padding: 16,
  },
  emptyCardText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, flex: 1 },

  docRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  docRowSelected: { borderColor: Colors.orange, backgroundColor: '#ff6a1f08' },
  docThumb: { width: 54, height: 40, borderRadius: 8, backgroundColor: Colors.bg },
  docThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  docInfo: { flex: 1, gap: 2 },
  docType: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  docStatus: { fontFamily: Fonts.bodyMedium, fontSize: 12 },
  deleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center' },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
});
