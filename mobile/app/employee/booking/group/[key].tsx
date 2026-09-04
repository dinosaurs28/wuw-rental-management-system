import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';

interface PricingDetails {
  basePrice: number;
  discountAmount: number;
  discountPercent: number;
  deposit: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxRate: number;
  finalTotal: number;
  freeKmLimit: number;
  extraKmRate: number;
  pricingBreakdown: {
    periodType: string;
    duration: { days?: number; hours?: number };
    applicablePrice: number;
    priceSource: string;
  };
}

interface VehicleGroupDetail {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  availableCount: number;
  totalCount: number;
  images: string[];
  pricing: { daily: number | null };
  deposit: number;
  availability: boolean | null;
  pricingDetails: PricingDetails | null;
  advancePayAmount?: number;
}

interface KycDoc {
  id: number;
  publicId: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  file: { url: string };
}

interface CustomerDetail {
  name: string;
  email: string;
  phone: string | null;
  isProfileCompleted: boolean;
}

const formatPrice = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

export default function EmployeeVehicleGroupDetail() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { key, customerPublicId, start, end } = useLocalSearchParams<{
    key: string;
    customerPublicId: string;
    start: string;
    end: string;
  }>();

  const [selectedKycId, setSelectedKycId] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [creatingHold, setCreatingHold] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [paymentType, setPaymentType] = useState<'CASH' | 'ONLINE'>('CASH');
  const profileModalShownRef = useRef(false);

  const { data: customer } = useQuery<CustomerDetail>({
    queryKey: ['employee', 'customer', customerPublicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomer(String(customerPublicId));
      return res.data?.data as CustomerDetail;
    },
    enabled: !!customerPublicId,
    staleTime: 30_000,
  });

  const { data: group, isLoading, error } = useQuery<VehicleGroupDetail>({
    queryKey: ['employee', 'vehicle-group', key, start, end],
    queryFn: async () => {
      const res = await employeeApi.getEmployeeVehicleGroup(String(key), {
        start: String(start),
        end: String(end),
      });
      return res.data?.data as VehicleGroupDetail;
    },
    enabled: !!key && !!start && !!end,
  });

  const {
    data: kycDocs,
    isLoading: kycLoading,
    refetch: refetchKyc,
  } = useQuery<KycDoc[]>({
    queryKey: ['employee', 'customer-kyc', customerPublicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomerKyc(String(customerPublicId));
      return (res.data?.data ?? []) as KycDoc[];
    },
    enabled: !!customerPublicId && customer?.isProfileCompleted !== false,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!selectedKycId && kycDocs && kycDocs.length > 0) {
      const approved = kycDocs.find((d) => d.status === 'APPROVED');
      if (approved) setSelectedKycId(approved.publicId);
    }
  }, [kycDocs, selectedKycId]);

  useEffect(() => {
    if (
      customer &&
      customer.isProfileCompleted === false &&
      !profileModalShownRef.current
    ) {
      profileModalShownRef.current = true;
      setShowProfileModal(true);
    }
  }, [customer]);

  const verifyKyc = useMutation({
    mutationFn: ({
      kycPublicId,
      status,
    }: {
      kycPublicId: string;
      status: 'APPROVED' | 'REJECTED';
    }) => employeeApi.verifyWalkinKyc(kycPublicId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'customer-kyc', customerPublicId] });
    },
    onError: (err: any) => {
      Alert.alert('Failed', err?.response?.data?.message ?? 'Could not update KYC status.');
    },
  });

  const pricing = group?.pricingDetails ?? null;
  const days = pricing?.pricingBreakdown?.duration?.days ?? 1;
  const subtotal = pricing?.basePrice ?? 0;
  const deposit = pricing?.deposit ?? group?.deposit ?? 0;
  const tax = pricing?.taxAmount ?? 0;
  const total = (pricing?.finalTotal ?? 0) + deposit;

  const handleBookNow = async () => {
    if (!group) return;
    if (customer?.isProfileCompleted === false) {
      setShowProfileModal(true);
      return;
    }
    if (!selectedKycId) {
      Alert.alert('Select KYC', 'Please select an approved KYC document for the customer.');
      return;
    }
    if (group.availability === false || group.availableCount === 0) {
      Alert.alert(
        'Unavailable',
        'No vehicles available in this group for the selected dates.',
      );
      return;
    }

    setCreatingHold(true);
    try {
      const res = await employeeApi.createEmployeeBooking({
        group_key: String(key),
        customer_public_id: String(customerPublicId),
        customer_kyc_id: selectedKycId,
        start: String(start),
        end: String(end),
        payment_type: paymentType,
      });
      const data = res.data?.data;
      if (!data?.bookingId) throw new Error('Missing bookingId');
      router.push({
        pathname: '/employee/booking/summary' as any,
        params: {
          bookingId: data.bookingId,
          transactionId: data.transactionId ?? '',
          expiresAt: data.expiresAt ?? '',
          rehold_id: String(key),
          rehold_isGroup: '1',
          rehold_customer: String(customerPublicId),
          rehold_kyc: selectedKycId,
          rehold_start: String(start),
          rehold_end: String(end),
          rehold_paymentType: paymentType,
        },
      });
    } catch (err: any) {
      Alert.alert(
        'Booking failed',
        err?.response?.data?.message ?? 'Could not create the booking hold.',
      );
    } finally {
      setCreatingHold(false);
    }
  };

  const handleCompleteProfile = () => {
    setShowProfileModal(false);
    const next = encodeURIComponent(
      `/employee/booking/group/${key}?customerPublicId=${customerPublicId}&start=${start}&end=${end}`,
    );
    router.push(
      `/employee/walkin/profile?customerPublicId=${customerPublicId}&next=${next}` as any,
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }
  if (error || !group) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={36} color={Colors.ink3} />
        <Text style={styles.errorTitle}>Group not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.errorBackBtn}>
          <Text style={styles.errorBackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const heroImage = group.images?.[galleryIndex] ?? group.images?.[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Vehicle group</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          {heroImage ? (
            <Image source={{ uri: heroImage }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              <Ionicons name="car-sport-outline" size={56} color="rgba(0,0,0,0.18)" />
            </View>
          )}
        </View>

        {/* Image thumbs */}
        {group.images.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbRow}
          >
            {group.images.map((img, i) => (
              <TouchableOpacity
                key={`${img}-${i}`}
                onPress={() => setGalleryIndex(i)}
                style={[styles.thumb, galleryIndex === i && styles.thumbActive]}
                activeOpacity={0.85}
              >
                <Image source={{ uri: img }} style={styles.thumbImage} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.vehicleName}>
            {group.make} {group.model}
          </Text>
          <Text style={styles.metaText}>
            {group.category} · {group.branch}
          </Text>
          <View style={styles.unitsRow}>
            <View style={styles.unitsBadge}>
              <Ionicons name="cube-outline" size={14} color={Colors.orange} />
              <Text style={styles.unitsText}>
                {group.availableCount}/{group.totalCount} units available
              </Text>
            </View>
          </View>
        </View>

        {/* Customer banner */}
        {customer && (
          <View style={styles.custBanner}>
            <View style={styles.custIcon}>
              <Ionicons name="person" size={16} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.custName}>{customer.name}</Text>
              <Text style={styles.custMeta}>{customer.phone ?? customer.email}</Text>
            </View>
            {customer.isProfileCompleted === false && (
              <View style={styles.profileWarn}>
                <Text style={styles.profileWarnText}>Incomplete</Text>
              </View>
            )}
          </View>
        )}

        {/* Pricing */}
        <Text style={styles.sectionTitle}>Pricing</Text>
        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>
              {pricing?.pricingBreakdown?.periodType ?? 'Daily'} rate
            </Text>
            <Text style={styles.priceValue}>
              {formatPrice(pricing?.pricingBreakdown?.applicablePrice ?? group.pricing?.daily)}
            </Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>
              Subtotal{days ? ` (${days} day${days > 1 ? 's' : ''})` : ''}
            </Text>
            <Text style={styles.priceValue}>{formatPrice(subtotal)}</Text>
          </View>
          {(pricing?.discountAmount ?? 0) > 0 && (
            <View style={styles.priceRow}>
              <Text style={[styles.priceLabel, { color: '#10b981' }]}>Discount</Text>
              <Text style={[styles.priceValue, { color: '#10b981' }]}>
                -{formatPrice(pricing?.discountAmount)}
              </Text>
            </View>
          )}
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>
              Tax {pricing?.taxRate ? `(${pricing.taxRate}%)` : ''}
            </Text>
            <Text style={styles.priceValue}>{formatPrice(tax)}</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Deposit (refundable)</Text>
            <Text style={styles.priceValue}>{formatPrice(deposit)}</Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatPrice(total)}</Text>
          </View>
        </View>

        {/* KYC */}
        <View style={styles.kycHeader}>
          <Text style={styles.sectionTitle}>Customer KYC</Text>
          <TouchableOpacity onPress={() => refetchKyc()} hitSlop={8}>
            <Text style={styles.refreshLink}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {customer?.isProfileCompleted === false ? (
          <View style={styles.profileBlock}>
            <Ionicons name="alert-circle-outline" size={22} color="#f59e0b" />
            <Text style={styles.profileBlockTitle}>Profile incomplete</Text>
            <Text style={styles.profileBlockSub}>
              Customer profile must be completed before viewing or selecting KYC documents.
            </Text>
            <TouchableOpacity
              style={styles.profileBlockBtn}
              onPress={handleCompleteProfile}
              activeOpacity={0.85}
            >
              <Text style={styles.profileBlockBtnText}>Complete profile</Text>
            </TouchableOpacity>
          </View>
        ) : kycLoading ? (
          <ActivityIndicator color={Colors.orange} size="small" style={{ marginVertical: 16 }} />
        ) : !kycDocs || kycDocs.length === 0 ? (
          <View style={styles.kycEmpty}>
            <Text style={styles.kycEmptyTitle}>No KYC uploaded</Text>
            <Text style={styles.kycEmptySub}>
              Customer must upload a KYC document via the walk-in flow before booking.
            </Text>
          </View>
        ) : (
          <View style={styles.kycList}>
            {kycDocs.map((doc) => {
              const selected = selectedKycId === doc.publicId;
              return (
                <View key={doc.publicId} style={styles.kycItem}>
                  <TouchableOpacity
                    style={styles.kycSelect}
                    onPress={() =>
                      doc.status === 'APPROVED' && setSelectedKycId(doc.publicId)
                    }
                    activeOpacity={doc.status === 'APPROVED' ? 0.85 : 1}
                  >
                    <View style={[styles.kycRadio, selected && styles.kycRadioOn]}>
                      {selected && <View style={styles.kycRadioInner} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kycType}>{doc.type.replace(/_/g, ' ')}</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          doc.status === 'APPROVED' && styles.statusGreen,
                          doc.status === 'REJECTED' && styles.statusRed,
                          doc.status === 'PENDING' && styles.statusAmber,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            doc.status === 'APPROVED' && { color: '#10b981' },
                            doc.status === 'REJECTED' && { color: '#ef4444' },
                            doc.status === 'PENDING' && { color: '#f59e0b' },
                          ]}
                        >
                          {doc.status}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  {doc.status === 'PENDING' && (
                    <View style={styles.kycActions}>
                      <TouchableOpacity
                        style={[styles.kycActionBtn, styles.kycApproveBtn]}
                        onPress={() =>
                          verifyKyc.mutate({
                            kycPublicId: doc.publicId,
                            status: 'APPROVED',
                          })
                        }
                        disabled={verifyKyc.isPending}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.kycApproveText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.kycActionBtn, styles.kycRejectBtn]}
                        onPress={() =>
                          verifyKyc.mutate({
                            kycPublicId: doc.publicId,
                            status: 'REJECTED',
                          })
                        }
                        disabled={verifyKyc.isPending}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.kycRejectText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Payment method */}
        <Text style={styles.sectionTitle}>Payment method</Text>
        <View style={styles.payRow}>
          <TouchableOpacity
            style={[styles.payOption, paymentType === 'CASH' && styles.payOptionActive]}
            onPress={() => setPaymentType('CASH')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="cash-outline"
              size={18}
              color={paymentType === 'CASH' ? Colors.orange : Colors.ink3}
            />
            <Text
              style={[
                styles.payOptionText,
                paymentType === 'CASH' && styles.payOptionTextActive,
              ]}
            >
              Cash
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payOption, paymentType === 'ONLINE' && styles.payOptionActive]}
            onPress={() => setPaymentType('ONLINE')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="card-outline"
              size={18}
              color={paymentType === 'ONLINE' ? Colors.orange : Colors.ink3}
            />
            <Text
              style={[
                styles.payOptionText,
                paymentType === 'ONLINE' && styles.payOptionTextActive,
              ]}
            >
              Online
            </Text>
          </TouchableOpacity>
        </View>

        {(group.availability === false || group.availableCount === 0) && (
          <View style={styles.unavailableBox}>
            <Ionicons name="ban-outline" size={18} color="#ef4444" />
            <Text style={styles.unavailableText}>
              No vehicles available in this group for the selected dates.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 14 }]}>
        <View>
          <Text style={styles.ctaTotal}>{formatPrice(total)}</Text>
          <Text style={styles.ctaTotalNote}>Total · {days || 1}d</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.ctaBtn,
            (creatingHold ||
              group.availability === false ||
              group.availableCount === 0) &&
              styles.ctaBtnDisabled,
          ]}
          onPress={handleBookNow}
          disabled={
            creatingHold || group.availability === false || group.availableCount === 0
          }
          activeOpacity={0.85}
        >
          {creatingHold ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.ctaBtnText}>
              {paymentType === 'CASH' ? 'Hold & pay cash' : 'Hold & pay online'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Profile completion modal */}
      <Modal
        visible={showProfileModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowProfileModal(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Ionicons name="information-circle-outline" size={28} color="#f59e0b" />
            </View>
            <Text style={styles.modalTitle}>Profile Incomplete</Text>
            <Text style={styles.modalBody}>
              The customer's profile is missing required information. You'll need to complete
              the profile before continuing with the booking.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setShowProfileModal(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.modalBtnSecondaryText}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleCompleteProfile}
                activeOpacity={0.85}
              >
                <Text style={styles.modalBtnPrimaryText}>Complete profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
    gap: 12,
  },
  errorTitle: { fontFamily: Fonts.display, fontSize: 16, color: Colors.ink2 },
  errorBackBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  errorBackText: { fontFamily: Fonts.bodySemiBold, color: Colors.white, fontSize: 14 },

  scroll: { paddingBottom: 140 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    justifyContent: 'space-between',
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.ink,
    letterSpacing: -0.3,
  },

  hero: {
    marginHorizontal: 20,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  heroImage: { width: '100%', height: 220 },
  heroPlaceholder: {
    backgroundColor: '#f0f0ee',
    alignItems: 'center',
    justifyContent: 'center',
  },

  thumbRow: {
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 10,
  },
  thumb: {
    width: 64,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbActive: { borderColor: Colors.orange },
  thumbImage: { width: '100%', height: '100%' },

  titleSection: { paddingHorizontal: 20, marginTop: 16, gap: 4 },
  vehicleName: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.ink,
    letterSpacing: -0.6,
  },
  metaText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  unitsRow: { marginTop: 8, flexDirection: 'row' },
  unitsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orangeSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  unitsText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.orange },

  custBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 12,
    gap: 12,
  },
  custIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  custName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  custMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  profileWarn: {
    backgroundColor: '#f59e0b15',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  profileWarnText: { fontFamily: Fonts.bodySemiBold, fontSize: 10, color: '#f59e0b' },

  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 8,
  },
  priceCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 16,
    padding: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  priceLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2 },
  priceValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  priceDivider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 8 },
  totalLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  totalValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },

  kycHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
  },
  refreshLink: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.orange,
    marginTop: 18,
  },
  kycList: { paddingHorizontal: 20, gap: 8 },
  kycItem: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  kycSelect: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kycRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.ink4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycRadioOn: { borderColor: Colors.orange },
  kycRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.orange,
  },
  kycType: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  statusGreen: { backgroundColor: '#10b98115' },
  statusRed: { backgroundColor: '#ef444415' },
  statusAmber: { backgroundColor: '#f59e0b15' },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 10 },

  kycActions: { flexDirection: 'row', gap: 8 },
  kycActionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  kycApproveBtn: {
    backgroundColor: '#10b98115',
    borderWidth: 1,
    borderColor: '#10b98140',
  },
  kycRejectBtn: {
    backgroundColor: '#ef444415',
    borderWidth: 1,
    borderColor: '#ef444440',
  },
  kycApproveText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: '#10b981' },
  kycRejectText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: '#ef4444' },

  kycEmpty: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  kycEmptyTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  kycEmptySub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    textAlign: 'center',
  },

  profileBlock: {
    marginHorizontal: 20,
    backgroundColor: '#fef3c7',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  profileBlockTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#92400e' },
  profileBlockSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
  },
  profileBlockBtn: {
    marginTop: 8,
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  profileBlockBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },

  payRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
  },
  payOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
  },
  payOptionActive: {
    borderColor: Colors.orange,
    backgroundColor: Colors.orangeSoft,
  },
  payOptionText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink3,
  },
  payOptionTextActive: { color: Colors.orange },

  unavailableBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
  },
  unavailableText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: '#b91c1c',
    flex: 1,
  },

  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ctaTotal: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  ctaTotalNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minWidth: 140,
    alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 22,
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  modalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f59e0b15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  modalTitle: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  modalBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalActions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 14 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  modalBtnSecondary: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  modalBtnSecondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
  },
  modalBtnPrimary: { backgroundColor: Colors.orange },
  modalBtnPrimaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },
});
