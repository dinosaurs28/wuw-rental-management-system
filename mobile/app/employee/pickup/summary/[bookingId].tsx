import { useCallback, useRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';
import { dlStatusLabel } from '../../../../lib/dlStatus';
import { fmtDateTime } from '../../../../lib/dates';
import {
  BillLines,
  Card,
  CompletionBanner,
  Divider,
  FooterButton,
  InfoRow,
  PaymentsCard,
  PhotoGrid,
  ScreenHeader,
  SectionHeader,
  balanceText,
  completedStyles as s,
  fuelText,
  inr,
  kmText,
  num,
} from '../../../../components/employee/completed/CompletedParts';
import type { PickupSummary } from '../../../../types/completedOperation';
import { AdjustmentHistory, PendingAdjustmentCard } from '../../../../components/employee/edit/AdjustmentRecords';
import CustomerRefundHistory from '../../../../components/employee/CustomerRefundHistory';

// A completed pickup (client item 1): read-only. Changes go through Edit Pickup.
export default function PickupSummaryScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch } = useQuery<PickupSummary>({
    queryKey: ['employee', 'pickup-summary', bookingId],
    queryFn: async () => (await employeeApi.getPickupSummary(bookingId as string)).data.data,
    enabled: !!bookingId,
    retry: false,
  });

  // Back from Edit Pickup: show what was saved. The first focus is the initial load.
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      refetch();
    }, [refetch]),
  );

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Pickup" bookingId={bookingId} />
        <ActivityIndicator style={s.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Pickup" bookingId={bookingId} />
        <View style={s.emptyState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={s.emptyText}>Could not load this pickup.</Text>
        </View>
      </View>
    );
  }

  // Not handed over yet: the pickup screen does it
  if (data.state === 'PENDING') return <Redirect href={`/employee/pickup/${data.booking.publicId}` as Href} />;

  const awaitingManager = data.state === 'AWAITING_MANAGER';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Pickup" bookingId={data.booking.publicId} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + (data.edit.allowed ? 120 : 32) }]}
        showsVerticalScrollIndicator={false}
      >
        {data.state ? (
          <CompletionBanner completed={data.completed} awaitingManager={awaitingManager} phase="pickup" />
        ) : (
          <Text style={s.hint}>This booking is {data.booking.status.replace(/_/g, ' ').toLowerCase()} — it has no pickup.</Text>
        )}

        <SectionHeader title="Customer" />
        <Card>
          <InfoRow icon="person-outline" label="Name" value={data.customer.name} />
          {data.customer.phone ? (
            <>
              <Divider />
              <InfoRow icon="call-outline" label="Phone" value={data.customer.phone} />
            </>
          ) : null}
        </Card>

        <SectionHeader title="Vehicle" />
        <Card>
          {data.vehicles.map((v, i) => (
            <View key={v.publicId}>
              {i > 0 && <Divider />}
              <InfoRow icon="car-outline" label={`${v.make} ${v.model}`} value={v.regNo} />
            </View>
          ))}
        </Card>

        <SectionHeader title="Handover" />
        <Card>
          <InfoRow icon="calendar-outline" label="Pickup" value={fmtDateTime(data.booking.startAt)} />
          <Divider />
          <InfoRow icon="speedometer-outline" label="Odometer" value={kmText(data.odometer)} />
          <Divider />
          <InfoRow icon="water-outline" label="Fuel level" value={fuelText(data.fuelLevel)} />
          {data.fastag.hasFastag && (
            <>
              <Divider />
              <InfoRow icon="pricetag-outline" label="FASTag balance" value={balanceText(data.fastag.balance)} />
            </>
          )}
          <Divider />
          <InfoRow
            icon="id-card-outline"
            label="Original DL"
            value={`${dlStatusLabel(data.dl.status)}${data.dl.status === 'DEPOSIT' && data.dl.depositNote ? ` · ${data.dl.depositNote}` : ''}`}
          />
          {data.pickupDiscount && (
            <>
              <Divider />
              <InfoRow
                icon="pricetag-outline"
                label="Pickup discount"
                value={`−${inr(num(data.pickupDiscount.amount))}${data.pickupDiscount.reason ? ` · ${data.pickupDiscount.reason}` : ''}`}
              />
            </>
          )}
          {num(data.safetyDeposit) > 0 && (
            <>
              <Divider />
              <InfoRow icon="shield-checkmark-outline" label="Safety deposit" value={inr(num(data.safetyDeposit))} />
            </>
          )}
        </Card>

        <SectionHeader title={`Photos (${data.photos.length})`} />
        <Card>
          {/* In the order taken (the server's order) — the numbers the drop compares by */}
          <PhotoGrid photos={data.photos} emptyText="No photos were saved with this pickup." />
        </Card>

        {data.bill && (
          <>
            <SectionHeader title="Pickup bill" />
            <Card>
              <BillLines lines={data.bill.lines} />
            </Card>
          </>
        )}

        {/* Edits that moved money (full edit): still to settle, then settled */}
        {data.pendingAdjustment && (
          <>
            <SectionHeader title="Edit difference" />
            <PendingAdjustmentCard record={data.pendingAdjustment} onSettled={() => { refetch(); }} />
          </>
        )}
        {(data.adjustments?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Edits" />
            <AdjustmentHistory records={data.adjustments ?? []} />
          </>
        )}

        <SectionHeader title="Payments" />
        <Card>
          <PaymentsCard bookingId={data.booking.publicId} />
          <CustomerRefundHistory refunds={data.customerRefunds} />
        </Card>
      </ScrollView>

      {data.edit.allowed && (
        <FooterButton
          label="Edit Pickup"
          icon="create-outline"
          onPress={() => router.push(`/employee/pickup/${data.booking.publicId}?edit=1` as Href)}
        />
      )}
    </View>
  );
}
