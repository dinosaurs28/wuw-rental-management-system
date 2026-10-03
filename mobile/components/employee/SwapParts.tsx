import { Image, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import {
  SWAP_FUEL_BARS,
  SWAP_REASONS,
  SWAP_REASON_LABEL,
  priceDifferenceOf,
  type SwapCandidate,
  type SwapCandidates,
  type SwapContext,
  type SwapPickerVehicle,
  type SwapReason,
} from '../../types/vehicleSwap';

// Building blocks shared by the pickup swap card (VehicleSwapSection) and the
// active-rental swap sheet (ActiveSwapSheet).

export const swapInr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const swapCandidatesKey = (bookingId: string) => ['employee', 'available-vehicles', bookingId] as const;
export const swapHistoryKey = (bookingId: string) => ['employee', 'swap-history', bookingId] as const;

// Replacement candidates + swapContext. A 4xx here (overdue, drop bill started,
// unpaid extension…) carries the reason in response.data.message.
export function useSwapCandidates(bookingId: string, enabled: boolean) {
  return useQuery<SwapCandidates>({
    queryKey: swapCandidatesKey(bookingId),
    queryFn: async () => {
      const res = await employeeApi.getAvailableVehicles(bookingId);
      return {
        vehicles: (res.data?.data ?? []) as SwapCandidate[],
        context: (res.data?.swapContext ?? null) as SwapContext | null,
      };
    },
    enabled: enabled && !!bookingId,
    // Availability and the pro-rated difference move with time — reload on every open.
    staleTime: 0,
    retry: false,
  });
}

/**
 * What to send as chargeDifference. Only a priced, positive difference can be
 * charged, and only once a reason was chosen — an amount staff never saw is
 * never billed (the server would otherwise apply its per-reason default).
 */
export function chargeDifferenceToSend(candidate: SwapCandidate | null, reason: SwapReason | null, charge: boolean): boolean {
  const diff = priceDifferenceOf(candidate?.priceDifference);
  return !!reason && diff != null && diff > 0 && charge;
}

export function SwapCandidateList<T extends SwapPickerVehicle>({
  vehicles,
  selectedId,
  onSelect,
  disabled,
}: {
  vehicles: T[];
  selectedId: string | number | null;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {vehicles.map((v) => {
        const sel = v.id === selectedId;
        const thumb = v.images?.[0]?.url ?? null;
        const diff = priceDifferenceOf(v.priceDifference);
        return (
          <TouchableOpacity
            key={v.id}
            style={[styles.vehRow, sel && styles.vehRowActive]}
            onPress={() => onSelect(v)}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
          >
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.vehThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.vehThumb, styles.vehThumbPlaceholder]}>
                <Ionicons name="car-outline" size={18} color={Colors.ink4} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.vehName} numberOfLines={1}>{v.make} {v.model}</Text>
              <Text style={styles.vehReg} numberOfLines={1}>{v.regNo}{v.categoryName ? ` · ${v.categoryName}` : ''}</Text>
              {(v.isUpgrade || diff != null) && (
                <View style={styles.vehMetaRow}>
                  {v.isUpgrade && (
                    <View style={styles.upgradeBadge}>
                      <Ionicons name="arrow-up" size={10} color={Colors.orange} />
                      <Text style={styles.upgradeBadgeText}>Upgrade</Text>
                    </View>
                  )}
                  {diff != null && (
                    <Text style={[styles.vehPrice, diff > 0 && styles.vehPriceUp]}>
                      {diff > 0 ? `+${swapInr(diff)}` : 'No price difference'}
                    </Text>
                  )}
                </View>
              )}
            </View>
            <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={20} color={sel ? Colors.orange : Colors.ink4} />
          </TouchableOpacity>
        );
      })}
    </>
  );
}

export function SwapReasonChips({
  value,
  onChange,
  disabled,
}: {
  value: SwapReason | null;
  onChange: (r: SwapReason) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.reasonWrap}>
      {SWAP_REASONS.map((r) => (
        <TouchableOpacity
          key={r}
          style={[styles.reasonChip, value === r && styles.reasonChipActive]}
          onPress={() => onChange(r)}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <Text style={[styles.reasonText, value === r && styles.reasonTextActive]}>{SWAP_REASON_LABEL[r]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Price difference of the selected replacement + the "Charge customer" switch.
export function SwapPriceDifference({
  candidate,
  pricingError,
  reason,
  charge,
  onChargeChange,
  disabled,
}: {
  candidate: SwapCandidate;
  pricingError: string | null;
  reason: SwapReason | null;
  charge: boolean;
  onChargeChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const diff = priceDifferenceOf(candidate.priceDifference);

  if (diff == null) {
    return (
      <View style={styles.priceBox}>
        <Text style={styles.priceTitle}>Price difference unavailable</Text>
        <Text style={styles.priceSub}>
          {pricingError ? `${pricingError}. ` : ''}The customer can't be charged for this swap.
        </Text>
      </View>
    );
  }

  if (diff <= 0) {
    return (
      <View style={styles.priceBox}>
        <Text style={styles.priceSub}>No price difference for the rest of the rental — nothing to charge.</Text>
      </View>
    );
  }

  return (
    <View style={styles.priceBox}>
      <View style={styles.priceHead}>
        <Text style={styles.priceTitle}>Price difference</Text>
        <Text style={styles.priceAmount}>+{swapInr(diff)}</Text>
      </View>
      <Text style={styles.priceSub}>For the rest of the rental (rents incl. GST).</Text>
      {reason ? (
        <>
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Charge customer</Text>
            <Switch
              value={charge}
              onValueChange={onChargeChange}
              disabled={disabled}
              trackColor={{ false: Colors.ink4, true: Colors.orange }}
              thumbColor={Colors.white}
            />
          </View>
          <Text style={styles.priceSub}>
            {charge ? 'Added to the drop bill (no GST on top).' : "Waived — the customer doesn't pay the difference."}
          </Text>
        </>
      ) : (
        <Text style={[styles.priceSub, { marginTop: 8 }]}>Pick a reason to set whether the customer pays it.</Text>
      )}
    </View>
  );
}

export function SwapFuelBars({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.fuelGrid}>
      {SWAP_FUEL_BARS.map((lvl) => (
        <TouchableOpacity
          key={lvl}
          style={[styles.fuelPill, value === lvl && styles.fuelPillActive]}
          onPress={() => onChange(lvl)}
          disabled={disabled}
          activeOpacity={0.8}
          accessibilityLabel={`${lvl} of 10 bars`}
        >
          <Text style={[styles.fuelPillText, value === lvl && styles.fuelPillTextActive]}>{lvl}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  vehRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.hairline, marginBottom: 8, backgroundColor: Colors.bg,
  },
  vehRowActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  vehThumb: { width: 48, height: 40, borderRadius: 8, backgroundColor: Colors.surface },
  vehThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  vehName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  vehReg: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  vehMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  upgradeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.orangeSoft,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  upgradeBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 10, color: Colors.orange, letterSpacing: 0.2 },
  vehPrice: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  vehPriceUp: { color: Colors.ink2 },

  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reasonChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  reasonChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  reasonText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  reasonTextActive: { color: Colors.white },

  priceBox: { backgroundColor: Colors.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
  priceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  priceAmount: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  priceSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2, lineHeight: 17 },
  chargeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  chargeLabel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },

  fuelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fuelPill: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  fuelPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  fuelPillTextActive: { color: Colors.white },
});
