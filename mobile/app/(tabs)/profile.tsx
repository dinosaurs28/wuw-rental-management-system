import { useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import Avatar from '../../components/ui/Avatar';
import Toast from '../../components/ui/Toast';
import type { KycDocument, KycType } from '../../types/api';

const DOC_TYPES: { type: KycType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { type: 'DL',         label: "Driver's License", icon: 'card-outline' },
  { type: 'AADHAAR',    label: 'Aadhaar',           icon: 'finger-print-outline' },
  { type: 'PAN',        label: 'PAN Card',           icon: 'document-text-outline' },
  { type: 'STUDENT_ID', label: 'Student ID',         icon: 'school-outline' },
];

const STATUS_CONFIG = {
  PENDING:  { color: '#d97706', bg: '#fffbeb', label: 'Pending' },
  APPROVED: { color: '#059669', bg: '#ecfdf5', label: 'Approved' },
  REJECTED: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
};

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ title: string; message?: string; type?: 'error' | 'success' } | null>(null);
  const [uploading, setUploading] = useState<KycType | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const docsY = useRef(0);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data as import('../../types/api').UserProfile,
    enabled: !!user,
  });

  const { data: kyc = [], isLoading: kycLoading } = useQuery({
    queryKey: ['kyc'],
    queryFn: () => userApi.kyc(),
    select: (res) => (res.data.data ?? []) as KycDocument[],
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ publicId }: { publicId: string }) =>
      userApi.deleteKyc(publicId, user!.publicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc'] });
      setToast({ title: 'Document removed', type: 'success' });
    },
    onError: () => setToast({ title: 'Failed to delete document', type: 'error' }),
  });

  const uploadDoc = async (type: KycType) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    // Derive extension from URI or mimeType
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };
    const ext = extMap[mimeType] ?? asset.uri.split('.').pop() ?? 'jpg';
    const fileName = `kyc_${type.toLowerCase()}_${Date.now()}.${ext}`;

    setUploading(type);
    try {
      const form = new FormData();
      form.append('file', { uri: asset.uri, name: fileName, type: mimeType } as any);
      form.append('type', type);
      await userApi.uploadKyc(form);
      queryClient.invalidateQueries({ queryKey: ['kyc'] });
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

  const confirmDelete = (doc: KycDocument) => {
    Alert.alert(
      'Remove document',
      `Remove your ${DOC_TYPES.find((d) => d.type === doc.type)?.label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteMutation.mutate({ publicId: doc.publicId }),
        },
      ],
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  const name = profile?.name ?? user?.name ?? '—';
  const email = profile?.email ?? user?.email ?? '—';

  const completedDocs = kyc.filter((d) => d.status === 'APPROVED').length;
  const isProfileComplete = profile?.isProfileCompleted ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Toast
        visible={!!toast}
        title={toast?.title ?? ''}
        message={toast?.message}
        type={toast?.type ?? 'error'}
        onDismiss={() => setToast(null)}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — avatar + name/email + edit chip */}
        <View style={styles.header}>
          <Avatar seed={name} size={64} />
          <View style={styles.headerInfo}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.email} numberOfLines={1}>{email}</Text>
          </View>
          <TouchableOpacity
            style={styles.editChip}
            onPress={() => router.push('/profile/edit')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Ionicons name="pencil" size={14} color={Colors.ink2} />
          </TouchableOpacity>
        </View>

        {/* Verification status — tappable, scrolls to docs */}
        <TouchableOpacity
          style={styles.verifyCard}
          onPress={() => scrollRef.current?.scrollTo({ y: docsY.current - 12, animated: true })}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.verifyIcon,
              { backgroundColor: completedDocs === DOC_TYPES.length ? '#ecfdf5' : '#ff6a1f12' },
            ]}
          >
            <Ionicons
              name={completedDocs === DOC_TYPES.length ? 'shield-checkmark' : 'shield-outline'}
              size={18}
              color={completedDocs === DOC_TYPES.length ? '#059669' : Colors.orange}
            />
          </View>
          <View style={styles.verifyText}>
            <Text style={styles.verifyTitle}>
              {completedDocs === DOC_TYPES.length
                ? 'Identity verified'
                : `${completedDocs} of ${DOC_TYPES.length} documents verified`}
            </Text>
            <Text style={styles.verifySub}>
              {completedDocs === DOC_TYPES.length
                ? 'Your account is fully verified'
                : 'Tap to upload remaining documents'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.ink3} />
        </TouchableOpacity>

        {/* Account info card */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <InfoRow icon="person-outline" label="Name" value={name} />
          <InfoRow icon="mail-outline" label="Email" value={email} />
          <InfoRow icon="call-outline" label="Phone" value={profile?.phone ?? 'Not added'} muted={!profile?.phone} />
          {profile?.dob && (
            <InfoRow icon="calendar-outline" label="Date of birth" value={new Date(profile.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} last />
          )}
        </View>

        {/* KYC documents */}
        <View
          style={styles.sectionRow}
          onLayout={(e) => { docsY.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.sectionTitle}>Identity Documents</Text>
          {kycLoading && <ActivityIndicator size="small" color={Colors.orange} />}
        </View>

        {!isProfileComplete && (
          <TouchableOpacity style={styles.incompleteBanner} onPress={() => router.push('/profile/edit')} activeOpacity={0.85}>
            <Ionicons name="alert-circle-outline" size={18} color="#d97706" />
            <View style={styles.incompleteBannerText}>
              <Text style={styles.incompleteBannerTitle}>Complete your profile first</Text>
              <Text style={styles.incompleteBannerSub}>Name, phone and address required to upload KYC documents.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#d97706" />
          </TouchableOpacity>
        )}
        <View style={styles.card}>
          {DOC_TYPES.map((docType, i) => {
            const uploaded = kyc.find((d) => d.type === docType.type);
            const isUploading = uploading === docType.type;
            const status = uploaded ? STATUS_CONFIG[uploaded.status] : null;

            return (
              <View key={docType.type} style={[styles.docRow, i === DOC_TYPES.length - 1 && styles.lastRow]}>
                {/* Left icon */}
                <View style={[styles.docIconWrap, uploaded && { backgroundColor: status!.bg }]}>
                  <Ionicons
                    name={docType.icon}
                    size={18}
                    color={uploaded ? status!.color : Colors.ink3}
                  />
                </View>

                {/* Info */}
                <View style={styles.docInfo}>
                  <Text style={styles.docLabel}>{docType.label}</Text>
                  {uploaded ? (
                    <View style={[styles.statusBadge, { backgroundColor: status!.bg }]}>
                      <Text style={[styles.statusText, { color: status!.color }]}>{status!.label}</Text>
                    </View>
                  ) : (
                    <Text style={styles.docSub}>Not uploaded</Text>
                  )}
                </View>

                {/* Action */}
                {uploaded ? (
                  <View style={styles.docActions}>
                    {uploaded.file?.url ? (
                      <TouchableOpacity
                        style={styles.docActionBtn}
                        onPress={() => router.push({ pathname: '/document-viewer', params: { url: uploaded.file.url, title: docType.label } } as any)}
                      >
                        <Ionicons name="eye-outline" size={16} color={Colors.ink2} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.docActionBtn, { backgroundColor: '#fef2f2' }]}
                      onPress={() => confirmDelete(uploaded)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.uploadBtn, !isProfileComplete && styles.uploadBtnDisabled]}
                    onPress={() => isProfileComplete ? uploadDoc(docType.type) : router.push('/profile/edit')}
                    disabled={isUploading}
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

        {/* Support */}
        <Text style={styles.sectionTitle}>Support</Text>
        <View style={styles.card}>
          <LinkRow
            icon="call-outline"
            label="Contact us"
            onPress={() => router.push('/contact' as any)}
            last
          />
        </View>

        {/* Legal */}
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.card}>
          <LinkRow
            icon="document-text-outline"
            label="Terms and Conditions"
            onPress={() => router.push('/legal/terms' as any)}
          />
          <LinkRow
            icon="lock-closed-outline"
            label="Privacy Policy"
            onPress={() => router.push('/legal/privacy' as any)}
          />
          <LinkRow
            icon="help-circle-outline"
            label="FAQ"
            onPress={() => router.push('/legal/faq' as any)}
          />
          <LinkRow
            icon="receipt-outline"
            label="Refund Policy"
            onPress={() => router.push('/legal/refund' as any)}
            last
          />
        </View>

        {/* App */}
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.card}>
          <InfoRow icon="information-circle-outline" label="Version" value="1.0.0" last />
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color="#dc2626" />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.infoRow, last && styles.lastRow]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={16} color={Colors.ink3} />
      </View>
      <Text style={[styles.infoValue, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.ink3} />
    </TouchableOpacity>
  );
}

function InfoRow({
  icon,
  label,
  value,
  muted,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.lastRow]}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={16} color={Colors.ink3} />
      </View>
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, muted && styles.infoValueMuted]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  inner: { paddingHorizontal: 20 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  headerInfo: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  email: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    marginTop: 2,
  },
  editChip: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Verification status card */
  verifyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    marginTop: 8,
  },
  verifyIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyText: { flex: 1, gap: 2 },
  verifyTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  verifySub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
  },

  /* Sections */
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 24 },
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  lastRow: { borderBottomWidth: 0 },

  /* Info row */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 12,
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: { flex: 1 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginBottom: 2 },
  infoValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  infoValueMuted: { color: Colors.ink3 },

  /* Doc row */
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 12,
  },
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
  docActions: { flexDirection: 'row', gap: 8 },
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
  uploadBtnDisabled: { backgroundColor: Colors.ink4 },
  uploadBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.white },

  incompleteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  incompleteBannerText: { flex: 1 },
  incompleteBannerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#92400e' },
  incompleteBannerSub: { fontFamily: Fonts.body, fontSize: 12, color: '#b45309', marginTop: 2, lineHeight: 16 },

  /* Sign out */
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff5f5',
  },
  signOutText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: '#dc2626' },
});
