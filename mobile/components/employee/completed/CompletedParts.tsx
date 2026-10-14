// Building blocks of the completed pickup / return screens (client item 1):
// the read-only summaries (app/employee/{pickup,return}/summary) and the
// Edit Pickup / Edit Return screens (app/employee/{pickup,return}/edit).
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/dates';
import ImageViewer, { type ViewerImage } from '../../ui/ImageViewer';
import type { FinancialState } from '../../../types/api';
import type { CompletionInfo, ReturnSummaryDamage, SummaryBillLine } from '../../../types/completedOperation';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export const num = (x: unknown) => Number(x ?? 0) || 0;
export const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
// Fuel is recorded in bars, "1".."10".
export const FUEL_LEVELS = Array.from({ length: 10 }, (_, i) => String(i + 1));
export const fuelText = (level: string | null | undefined) => (level ? `${level}/10` : '—');
export const kmText = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-IN')} km`);
export const balanceText = (v: string | null | undefined) => (v == null ? 'Not read' : inr(num(v)));
// FASTag balance typed by staff: ₹ with up to 2 decimals.
export const isBalanceInput = (v: string) => /^\d{1,6}(\.\d{1,2})?$/.test(v.trim());

// Who pays for a damage recorded at drop.
export function damageBillingLabel(d: ReturnSummaryDamage): string {
  if (!d.chargeCustomer) return 'Company expense';
  return d.billedAtDrop ? 'Charged on the drop bill' : 'Charged by the branch manager';
}

export function ScreenHeader({ title, bookingId, right }: { title: string; bookingId?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        {bookingId ? <Text style={styles.subtitle}>#{bookingId.slice(-8).toUpperCase()}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function InfoRow({ icon, label, value, valueColor }: { icon: IoniconName; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

// "Completed" / "Awaiting manager", when and by whom.
export function CompletionBanner({
  completed,
  awaitingManager,
  phase,
}: {
  completed: CompletionInfo | null;
  awaitingManager: boolean;
  phase: 'pickup' | 'return';
}) {
  const color = awaitingManager ? Colors.availLow : Colors.availGood;
  const when = [completed?.at ? fmtDateTime(completed.at) : null, completed?.byName ? `by ${completed.byName}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.banner, { backgroundColor: awaitingManager ? Colors.availLowSoft : Colors.availGoodSoft }]}>
      <Ionicons name={awaitingManager ? 'time' : 'checkmark-circle'} size={20} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.bannerTitle, { color }]}>{awaitingManager ? 'Awaiting manager' : 'Completed'}</Text>
        <Text style={styles.bannerSub}>
          {awaitingManager
            ? `This ${phase} was sent to the branch manager to confirm.`
            : `This ${phase} is done.`}
          {when ? ` ${when}` : ''}
        </Text>
      </View>
    </View>
  );
}

// Saved photos, tap to open the viewer.
export function PhotoGrid({ photos, emptyText }: { photos: Array<{ url: string; label?: string | null }>; emptyText: string }) {
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  if (photos.length === 0) return <Text style={styles.hint}>{emptyText}</Text>;
  return (
    <>
      <View style={styles.photoGrid}>
        {photos.map((p, i) => (
          <TouchableOpacity
            key={`${p.url}_${i}`}
            style={styles.photoTile}
            onPress={() => setViewer({ images: photos.map((x) => ({ url: x.url, label: x.label ?? undefined })), index: i })}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={p.label ? `View ${p.label} photo` : 'View photo'}
          >
            <Image source={{ uri: p.url }} style={styles.photo} resizeMethod="resize" />
            {p.label ? (
              <View style={styles.photoLabel}>
                <Text style={styles.photoLabelText} numberOfLines={1}>{p.label}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
      <ImageViewer
        visible={!!viewer}
        images={viewer?.images ?? []}
        startIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </>
  );
}

// Lines of the settled pickup / drop bill.
export function BillLines({ lines }: { lines: SummaryBillLine[] }) {
  if (lines.length === 0) return <Text style={styles.hint}>No charges.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {lines.map((l, i) => {
        const amount = num(l.amount);
        return (
          <View key={`${l.label}_${i}`} style={styles.billRow}>
            <Text style={styles.billLabel}>{l.label}</Text>
            <Text style={[styles.billAmount, amount < 0 && styles.billCredit]}>
              {amount < 0 ? '−' : ''}
              {inr(amount)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// What the booking cost and what was collected (same source as the Payment panel).
export function PaymentsCard({ bookingId }: { bookingId: string }) {
  const { data: fin, isLoading } = useQuery<FinancialState | null>({
    queryKey: ['employee', 'financial-state', bookingId],
    queryFn: async () => {
      const res = await employeeApi.financialState(bookingId);
      return (res.data?.data ?? null) as FinancialState | null;
    },
    staleTime: 15_000,
    retry: false,
  });
  if (isLoading) return <ActivityIndicator color={Colors.orange} style={{ marginVertical: 12 }} />;
  if (!fin) return <Text style={styles.hint}>Payments couldn't be loaded.</Text>;
  const due = num(fin.amountDue);
  return (
    <View style={{ gap: 10 }}>
      <InfoRow icon="receipt-outline" label="Booking total" value={inr(num(fin.totalFinal))} />
      {num(fin.returnCharges) > 0 && (
        <InfoRow icon="add-circle-outline" label="Drop charges" value={inr(num(fin.returnCharges))} />
      )}
      <InfoRow icon="cash-outline" label="Collected" value={inr(num(fin.totalCollectedConfirmed) + num(fin.totalCollectedPending))} />
      {num(fin.totalRefunded) > 0 && (
        <InfoRow icon="return-down-back-outline" label="Refunded" value={inr(num(fin.totalRefunded))} />
      )}
      <InfoRow
        icon={due > 0 ? 'alert-circle-outline' : 'checkmark-done-outline'}
        label="Due"
        value={due > 0 ? inr(due) : 'Nothing due'}
        valueColor={due > 0 ? Colors.availLow : Colors.availGood}
      />
    </View>
  );
}

// Bottom action bar of the summary / edit screens.
export function FooterButton({
  label,
  icon,
  onPress,
  disabled,
  busy,
  hint,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  hint?: string | null;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
      {hint ? <Text style={styles.footerHint}>{hint}</Text> : null}
      <TouchableOpacity
        style={[styles.footerBtn, (disabled || busy) && styles.footerBtnDisabled]}
        onPress={onPress}
        disabled={disabled || busy}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color={Colors.white} /> : <Ionicons name={icon} size={18} color={Colors.white} />}
        <Text style={styles.footerBtnText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

// 1..10 fuel bars picker.
export function FuelPicker({ value, onChange, disabled }: { value: string | null; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <View style={styles.fuelRow}>
      {FUEL_LEVELS.map((lvl) => {
        const active = value === lvl;
        return (
          <TouchableOpacity
            key={lvl}
            style={[styles.fuelPill, active && styles.fuelPillActive, disabled && { opacity: 0.5 }]}
            onPress={() => onChange(lvl)}
            disabled={disabled}
            activeOpacity={0.8}
          >
            <Text style={[styles.fuelPillText, active && styles.fuelPillTextActive]}>{lvl}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export const completedStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  loader: { marginTop: 100 },
  content: { paddingHorizontal: 20, gap: 8 },
  hint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, lineHeight: 18 },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, marginBottom: 8 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone, marginTop: 8, lineHeight: 17 },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top', fontFamily: Fonts.body, fontSize: 14 },
  inputError: { borderColor: Colors.availNone },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.availLowSoft,
    borderRadius: 12,
    padding: 12,
  },
  noticeText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.availNoneSoft,
    borderRadius: 12,
    padding: 12,
  },
  errorBoxText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  sectionHeader: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginBottom: 4,
  },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 14, marginBottom: 4 },
  bannerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14 },
  bannerSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  hint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.bg },
  photo: { width: '100%', height: '100%' },
  photoLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  photoLabelText: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.white },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  billLabel: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2 },
  billAmount: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  billCredit: { color: Colors.availGood },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  footerHint: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, textAlign: 'center', marginBottom: 10 },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 17,
  },
  footerBtnDisabled: { opacity: 0.45 },
  footerBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  fuelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fuelPill: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  fuelPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  fuelPillTextActive: { color: Colors.white },
});
