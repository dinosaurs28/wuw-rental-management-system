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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload, toUploadForm, uploadErrorMessage } from '../../lib/image';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import { LEGAL_URLS } from '../../constants/links';
import WhatsAppSupportButton from '../../components/ui/WhatsAppSupportButton';
import { useAuthStore } from '../../store/auth';
import Avatar from '../../components/ui/Avatar';
import Toast from '../../components/ui/Toast';
import type { KycDocument, KycType, KycSide } from '../../types/api';

const DOC_TYPES: {
  type: KycType;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  sides: KycSide[];
}[] = [
  { type: 'DL',         label: "Driver's License", icon: 'card-outline',          sides: ['FRONT', 'BACK'] },
  { type: 'AADHAAR',    label: 'Aadhaar',           icon: 'finger-print-outline', sides: ['FRONT', 'BACK'] },
  { type: 'PAN',        label: 'PAN Card',          icon: 'document-text-outline', sides: ['FRONT'] },
  { type: 'STUDENT_ID', label: 'Student ID',        icon: 'school-outline',         sides: ['FRONT'] },
];

const SIDE_LABEL: Record<KycSide, string> = { FRONT: 'Front', BACK: 'Back' };

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
  const [uploading, setUploading] = useState<string | null>(null);

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

  const uploadDoc = async (type: KycType, side: KycSide) => {
    // quality is left at 1 deliberately: prepareImageForUpload re-encodes
    // anyway, so asking the picker to compress first costs a second full
    // decode/encode pass and is the main reason selection felt slow.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    setUploading(`${type}:${side}`);
    try {
      const file = await prepareImageForUpload(
        asset,
        `kyc_${type.toLowerCase()}_${side.toLowerCase()}_${Date.now()}`,
      );
      // `side` is mandatory — the backend 400s without it.
      const form = toUploadForm(file, { type, side });

      await userApi.uploadKyc(form);
      queryClient.invalidateQueries({ queryKey: ['kyc'] });
      setToast({ title: `${SIDE_LABEL[side]} uploaded`, type: 'success' });
    } catch (err: any) {
      setToast({
        title: err.response?.status === 409 ? 'Already uploaded' : 'Upload failed',
        message: uploadErrorMessage(err, 'Something went wrong.'),
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

  const approvedCount = kyc.filter((d) => d.status === 'APPROVED').length;
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
        style={styles.root}
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatarWrap}>
            <Avatar seed={name} size={80} />
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email}>{email}</Text>

          {/* Completion pill */}
          <View style={styles.completionPill}>
            <View style={[styles.completionDot, { backgroundColor: approvedCount > 0 ? '#059669' : Colors.orange }]} />
            <Text style={styles.completionText}>
              {approvedCount > 0
                ? `${approvedCount} document${approvedCount !== 1 ? 's' : ''} verified`
                : 'No documents verified yet'}
            </Text>
          </View>

          {/* Edit profile button */}
          <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/profile/edit')} activeOpacity={0.8}>
            <Ionicons name="pencil-outline" size={14} color={Colors.ink2} />
            <Text style={styles.editBtnText}>Edit profile</Text>
          </TouchableOpacity>
        </View>

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

        {/* Bookings */}
        <Text style={styles.sectionTitle}>Bookings</Text>
        <View style={styles.card}>
          <LinkRow icon="receipt-outline" label="Cancellations & fees" onPress={() => router.push('/cancellations')} last />
        </View>

        {/* KYC documents */}
        <View style={styles.sectionRow}>
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
          {DOC_TYPES.map((docType, i) => (
            <View key={docType.type} style={[styles.docGroup, i === DOC_TYPES.length - 1 && styles.lastRow]}>
              <View style={styles.docGroupHeader}>
                <View style={styles.docIconWrap}>
                  <Ionicons name={docType.icon} size={18} color={Colors.ink3} />
                </View>
                <Text style={styles.docLabel}>{docType.label}</Text>
              </View>

              <View style={styles.sideRow}>
                {docType.sides.map((side) => {
                  const uploaded = kyc.find((d) => d.type === docType.type && d.side === side);
                  const isUploading = uploading === `${docType.type}:${side}`;
                  const status = uploaded ? STATUS_CONFIG[uploaded.status] : null;

                  return (
                    <View key={side} style={styles.sideSlot}>
                      <View style={styles.sideSlotTop}>
                        <Text style={styles.sideLabel}>{SIDE_LABEL[side]}</Text>
                        {uploaded && (
                          <View style={[styles.statusBadge, { backgroundColor: status!.bg }]}>
                            <Text style={[styles.statusText, { color: status!.color }]}>{status!.label}</Text>
                          </View>
                        )}
                      </View>

                      {uploaded ? (
                        <View style={styles.sideActions}>
                          {uploaded.file?.url ? (
                            <TouchableOpacity
                              style={[styles.docActionBtn, { flex: 1 }]}
                              onPress={() => router.push({ pathname: '/document-viewer', params: { url: uploaded.file.url, title: `${docType.label} · ${SIDE_LABEL[side]}` } } as any)}
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
                          onPress={() => (isProfileComplete ? uploadDoc(docType.type, side) : router.push('/profile/edit'))}
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
            </View>
          ))}
        </View>

        {/* Support */}
        <Text style={styles.sectionTitle}>Support</Text>
        <View style={{ marginBottom: 12 }}>
          <WhatsAppSupportButton />
        </View>
        <View style={styles.card}>
          <LinkRow icon="help-buoy-outline" label="Help & Contact" onPress={() => router.push('/contact')} />
          <LinkRow icon="document-text-outline" label="Terms & Conditions" onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.terms)} />
          <LinkRow icon="shield-checkmark-outline" label="Privacy Policy" onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.privacy)} />
          <LinkRow icon="cash-outline" label="Refund Policy" onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.refund)} />
          <LinkRow icon="help-circle-outline" label="FAQ" onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.faq)} last />
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

        {/* Account deletion — required in-app by Google Play policy for apps
            that allow in-app account creation. */}
        <TouchableOpacity
          style={styles.deleteAccountBtn}
          onPress={() => router.push('/delete-account')}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteAccountText}>Delete account</Text>
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
    <TouchableOpacity style={[styles.infoRow, last && styles.lastRow]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={16} color={Colors.ink3} />
      </View>
      <Text style={[styles.infoValue, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
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
  header: { alignItems: 'center', paddingVertical: 24 },
  avatarWrap: { marginBottom: 14 },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  email: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginTop: 4,
  },
  completionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  completionDot: { width: 7, height: 7, borderRadius: 4 },
  completionText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },

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

  /* Doc group (front/back slots) */
  docGroup: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 12,
  },
  docGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sideRow: { flexDirection: 'row', gap: 10 },
  sideSlot: {
    flex: 1,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 10,
    gap: 8,
    justifyContent: 'space-between',
  },
  sideSlotTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  sideActions: { flexDirection: 'row', gap: 8 },

  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 14,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  editBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },

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

  /* Delete account — deliberately low-emphasis so it can't be hit by mistake,
     but always reachable (Google Play requires an in-app deletion path). */
  deleteAccountBtn: { alignItems: 'center', paddingVertical: 18, marginTop: 4 },
  deleteAccountText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    textDecorationLine: 'underline',
  },
});
