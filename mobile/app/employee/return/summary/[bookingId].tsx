import { useCallback, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../../constants/colors';
import { employeeApi } from '../../../../lib/api';
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
  damageBillingLabel,
  fuelText,
  inr,
  kmText,
  num,
} from '../../../../components/employee/completed/CompletedParts';
import type { ReturnSummary } from '../../../../types/completedOperation';
import DropSwapSection from '../../../../components/employee/DropSwapSection';
import { AdjustmentHistory, PendingAdjustmentCard } from '../../../../components/employee/edit/AdjustmentRecords';

// A completed return (client item 1): read-only. Changes go through Edit Return.
export default function ReturnSummaryScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch } = useQuery<ReturnSummary>({
    queryKey: ['employee', 'return-summary', bookingId],
    queryFn: async () => (await employeeApi.getReturnSummary(bookingId as string)).data.data,
    enabled: !!bookingId,
    retry: false,
  });

  // Back from Edit Return: show what was saved. The first focus is the initial load.
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
        <ScreenHeader title="Return" bookingId={bookingId} />
        <ActivityIndicator style={s.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Return" bookingId={bookingId} />
        <View style={s.emptyState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={s.emptyText}>Could not load this return.</Text>
        </View>
      </View>
    );
  }

  // Still out: the return screen takes the car back
  if (data.state === 'PENDING') return <Redirect href={`/employee/return/${data.booking.publicId}` as Href} />;

  const awaitingManager = data.state === 'AWAITING_MANAGER';
  const odo = data.odometer;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Return" bookingId={data.booking.publicId} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + (data.edit.allowed ? 120 : 32) }]}
        showsVerticalScrollIndicator={false}
      >
        {data.state ? (
          <CompletionBanner completed={data.completed} awaitingManager={awaitingManager} phase="return" />
        ) : (
          <Text style={s.hint}>This booking hasn't been returned.</Text>
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

        <SectionHeader title="Drop" />
        <Card>
          <InfoRow icon="calendar-outline" label="Return due" value={fmtDateTime(data.booking.endAt)} />
          {data.booking.returnedAt ? (
            <>
              <Divider />
              <InfoRow icon="flag-outline" label="Returned" value={fmtDateTime(data.booking.returnedAt)} />
            </>
          ) : null}
          <Divider />
          <InfoRow icon="speedometer-outline" label="Odometer at pickup" value={kmText(odo.pickup)} />
          {odo.swapCount > 0 && odo.start != null ? (
            <>
              <Divider />
              <InfoRow icon="swap-horizontal-outline" label="Replacement car started at" value={kmText(odo.start)} />
            </>
          ) : null}
          <Divider />
          <InfoRow icon="speedometer-outline" label="Odometer at drop" value={kmText(odo.end)} />
          {odo.measured && odo.kmDriven != null ? (
            <>
              <Divider />
              <InfoRow icon="navigate-outline" label="Km driven" value={kmText(odo.kmDriven)} />
            </>
          ) : null}
          {odo.freeKm != null ? (
            <>
              <Divider />
              <InfoRow icon="gift-outline" label="Free km" value={kmText(odo.freeKm)} />
            </>
          ) : null}
          {odo.extraKm != null && odo.extraKm > 0 ? (
            <>
              <Divider />
              <InfoRow icon="add-circle-outline" label="Extra km" value={kmText(odo.extraKm)} />
            </>
          ) : null}
          {!odo.measured && (
            <Text style={[s.hint, { marginTop: 12 }]}>
              The vehicle was swapped without odometer readings — km driven can't be measured.
            </Text>
          )}
          {(odo.swaps ?? []).length > 0 && (
            <DropSwapSection
              segments={odo.swaps ?? []}
              currentStartOdometer={odo.start}
              style={{ marginTop: 12, marginBottom: 0, padding: 0, borderWidth: 0 }}
            />
          )}
          <Divider />
          <InfoRow icon="water-outline" label="Fuel at pickup" value={fuelText(data.fuel.pickup)} />
          <Divider />
          <InfoRow icon="water-outline" label="Fuel at drop" value={fuelText(data.fuel.return)} />
          {data.fastag.hasFastag && (
            <>
              <Divider />
              <InfoRow icon="pricetag-outline" label="FASTag at handover" value={balanceText(data.fastag.startBalance)} />
              <Divider />
              <InfoRow icon="pricetag-outline" label="FASTag at drop" value={balanceText(data.fastag.balance)} />
              {data.fastag.usage != null && (
                <>
                  <Divider />
                  <InfoRow icon="trending-down-outline" label="FASTag used" value={inr(num(data.fastag.usage))} />
                </>
              )}
            </>
          )}
        </Card>

        <SectionHeader title={`Return photos (${data.photos.length})`} />
        <Card>
          <PhotoGrid photos={data.photos} emptyText="No photos were saved with this return." />
        </Card>

        {data.damages.length > 0 && (
          <>
            <SectionHeader title={`Damage found (${data.damages.length})`} />
            {data.damages.map((d) => (
              <Card key={d.publicId}>
                <View style={styles.damageTop}>
                  <Text style={styles.damageArea}>{d.area || 'Damage'}</Text>
                  <Text style={styles.damageSeverity}>{d.severity}</Text>
                </View>
                {d.description ? <Text style={styles.damageText}>{d.description}</Text> : null}
                <Text style={styles.damageMoney}>
                  {num(d.amount) > 0 ? `${inr(num(d.amount))} · ` : ''}
                  {damageBillingLabel(d)}
                </Text>
                <View style={{ marginTop: 12 }}>
                  <PhotoGrid photos={d.photos} emptyText="No photos." />
                </View>
              </Card>
            ))}
          </>
        )}

        {data.bill && (
          <>
            <SectionHeader title={data.bill.settledBy === 'DROP_BILL' ? 'Drop bill' : 'Drop charges'} />
            <Card>
              <BillLines lines={data.bill.lines} />
              {data.bill.settledBy === 'BRANCH_MANAGER' && (
                <Text style={[s.hint, { marginTop: 12 }]}>Collected by the branch manager in Settlements.</Text>
              )}
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
        </Card>
      </ScrollView>

      {data.edit.allowed && (
        <FooterButton
          label="Edit Return"
          icon="create-outline"
          onPress={() => router.push(`/employee/return/${data.booking.publicId}?edit=1` as Href)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  damageTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  damageArea: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  damageSeverity: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.availLow },
  damageText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, marginTop: 6, lineHeight: 18 },
  damageMoney: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginTop: 6 },
});
