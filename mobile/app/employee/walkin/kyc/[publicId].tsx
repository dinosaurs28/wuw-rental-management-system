import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';
import Toast from '../../../../components/ui/Toast';
import type { KycType } from '../../../../types/api';

const DOC_TYPES: {
  type: KycType;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { type: 'DL', label: "Driver's License", icon: 'card-outline' },
  { type: 'AADHAAR', label: 'Aadhaar', icon: 'finger-print-outline' },
  { type: 'PAN', label: 'PAN Card', icon: 'document-text-outline' },
  { type: 'STUDENT_ID', label: 'Student ID', icon: 'school-outline' },
];

const STATUS_CONFIG = {
  PENDING: { color: '#d97706', bg: '#fffbeb', label: 'Pending' },
  APPROVED: { color: '#059669', bg: '#ecfdf5', label: 'Approved' },
  REJECTED: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
};

interface ServerKyc {
  id: number;
  publicId: string;
  customerId: number;
  type: KycType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fileId: number;
  createdAt: string;
  file: { id: number; publicId: string; key: string; url: string; mime: string; size: number };
}

export default function WalkinKyc() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { publicId, next } = useLocalSearchParams<{ publicId: string; next?: string }>();
  const customerPublicId = publicId as string;

  const [uploading, setUploading] = useState<KycType | null>(null);
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);

  const { data: kycList = [], isLoading } = useQuery<ServerKyc[]>({
    queryKey: ['employee', 'walkin', 'kyc', customerPublicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomerKyc(customerPublicId);
      return (res.data?.data ?? []) as ServerKyc[];
    },
    enabled: !!customerPublicId,
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ kycPublicId }: { kycPublicId: string }) =>
      employeeApi.deleteWalkinKyc(kycPublicId, customerPublicId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'walkin', 'kyc', customerPublicId] });
      setToast({ title: 'Document removed', type: 'success' });
    },
    onError: (err: any) =>
      setToast({
        title: 'Failed to delete',
        message: err.response?.data?.message ?? 'Something went wrong.',
        type: 'error',
      }),
  });

  const pickAndUpload = async (type: KycType) => {
    Alert.alert(
      'Upload document',
      'Choose a source',
      [
        { text: 'Camera', onPress: () => doUpload(type, 'camera') },
        { text: 'Photo Library', onPress: () => doUpload(type, 'library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const doUpload = async (type: KycType, source: 'camera' | 'library') => {
    let result;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setToast({ title: 'Camera permission required', type: 'error' });
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images',
        quality: 0.8,
        allowsEditing: false,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.8,
        allowsEditing: false,
      });
    }
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/heic': 'heic',
      'image/webp': 'webp',
    };
    const ext = extMap[mimeType] ?? asset.uri.split('.').pop() ?? 'jpg';
    const fileName = `kyc_${type.toLowerCase()}_${Date.now()}.${ext}`;

    setUploading(type);
    try {
      const form = new FormData();
      form.append('file', { uri: asset.uri, name: fileName, type: mimeType } as any);
      form.append('kyc_type', type);
      form.append('customer_public_id', customerPublicId);
      await employeeApi.uploadWalkinKyc(form);
      qc.invalidateQueries({ queryKey: ['employee', 'walkin', 'kyc', customerPublicId] });
      setToast({ title: 'Document uploaded', type: 'success' });
    } catch (err: any) {
      setToast({
        title: 'Upload failed',
        message: err.response?.data?.message ?? 'Something went wrong.',
        type: 'error',
      });
    } finally {
      setUploading(null);
    }
  };

  const confirmDelete = (doc: ServerKyc) => {
    Alert.alert(
      'Remove document',
      `Remove ${DOC_TYPES.find((d) => d.type === doc.type)?.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteMutation.mutate({ kycPublicId: doc.publicId }),
        },
      ],
    );
  };

  const handleDone = () => {
    if (next) {
      router.replace(next as any);
    } else {
      router.replace({ pathname: '/employee/customer/[publicId]', params: { publicId: customerPublicId } });
    }
  };

  const uploadedCount = kycList.length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Toast
        visible={!!toast}
        title={toast?.title ?? ''}
        message={toast?.message}
        type={toast?.type ?? 'error'}
        onDismiss={() => setToast(null)}
      />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>KYC Documents</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Verify identity</Text>
        <Text style={styles.subtitle}>
          Upload at least one document to complete walk-in onboarding.
        </Text>

        <View style={styles.completionPill}>
          <View
            style={[
              styles.completionDot,
              { backgroundColor: uploadedCount > 0 ? '#059669' : Colors.orange },
            ]}
          />
          <Text style={styles.completionText}>
            {uploadedCount}/{DOC_TYPES.length} documents uploaded
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.orange} />
        ) : (
          <View style={styles.card}>
            {DOC_TYPES.map((docType, i) => {
              const uploaded = kycList.find((d) => d.type === docType.type);
              const isUploading = uploading === docType.type;
              const status = uploaded ? STATUS_CONFIG[uploaded.status] : null;
              const last = i === DOC_TYPES.length - 1;

              return (
                <View key={docType.type} style={[styles.docRow, last && styles.lastRow]}>
                  <View style={[styles.docIconWrap, uploaded && { backgroundColor: status!.bg }]}>
                    <Ionicons
                      name={docType.icon}
                      size={18}
                      color={uploaded ? status!.color : Colors.ink3}
                    />
                  </View>

                  <View style={styles.docInfo}>
                    <Text style={styles.docLabel}>{docType.label}</Text>
                    {uploaded ? (
                      <View style={[styles.statusBadge, { backgroundColor: status!.bg }]}>
                        <Text style={[styles.statusText, { color: status!.color }]}>
                          {status!.label}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.docSub}>Not uploaded</Text>
                    )}
                  </View>

                  {uploaded ? (
                    <View style={styles.docActions}>
                      {uploaded.file?.url ? (
                        <TouchableOpacity
                          style={styles.docActionBtn}
                          onPress={() =>
                            router.push({
                              pathname: '/document-viewer',
                              params: { url: uploaded.file.url, title: docType.label },
                            } as any)
                          }
                        >
                          <Ionicons name="eye-outline" size={16} color={Colors.ink2} />
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.docActionBtn, { backgroundColor: '#fff5f5' }]}
                        onPress={() => pickAndUpload(docType.type)}
                        disabled={isUploading}
                      >
                        <Ionicons name="refresh" size={16} color={Colors.ink2} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.docActionBtn, { backgroundColor: '#fef2f2' }]}
                        onPress={() => confirmDelete(uploaded)}
                        disabled={deleteMutation.isPending}
                      >
                        <Ionicons name="trash-outline" size={16} color="#dc2626" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.uploadBtn}
                      onPress={() => pickAndUpload(docType.type)}
                      disabled={isUploading}
                      activeOpacity={0.85}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color={Colors.white} />
                      ) : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={14} color={Colors.white} />
                          <Text style={styles.uploadBtnText}>Upload</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>
            {uploadedCount > 0 ? 'Done' : 'Skip for now'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 24 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginBottom: 16,
    lineHeight: 20,
  },
  completionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.hairline,
    marginBottom: 18,
  },
  completionDot: { width: 7, height: 7, borderRadius: 4 },
  completionText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 12,
  },
  lastRow: { borderBottomWidth: 0 },
  docIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: { flex: 1, gap: 4 },
  docLabel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  docSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  docActions: { flexDirection: 'row', gap: 6 },
  docActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  uploadBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.white },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  doneBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});
