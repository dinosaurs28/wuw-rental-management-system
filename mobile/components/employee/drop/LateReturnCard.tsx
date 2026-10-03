import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtIstShort, rentalMinutesLabel } from '../../../lib/dates';
import type { LateChargePreview, RentalTimeline } from '../../../types/return';
import { inr2, num, pct } from './format';

// Late return without a formal extension (#12). The server bills it
// automatically: extraHourRate × ceil(late hours left after the branch grace),
// at face value — no GST on drop / recovery charges (item 8). Staff can tick
// "Apply grace" on MANUAL-grace branches, or waive the charge with a reason
// (audit-logged).

const CHARGEABLE = new Set(['CHARGED', 'RATE_UNAVAILABLE', 'WAIVED']);

interface Props {
  timeline: RentalTimeline;
  // No drop bill (branch without Unified Payments): the branch manager collects.
  legacy: boolean;
  applyGrace: boolean;
  onApplyGraceChange: (v: boolean) => void;
  waive: boolean;
  onWaiveChange: (v: boolean) => void;
  waiveReason: string;
  onWaiveReasonChange: (t: string) => void;
  waiveError: string | null;
  disabled?: boolean;
}

// The server's preview matching the grace choice on screen, or null when the
// server hasn't priced that choice (it is then priced on compute).
function previewFor(t: RentalTimeline, manualGrace: boolean, applyGrace: boolean): LateChargePreview | null {
  const base = t.lateChargePreview;
  if (!manualGrace) return base;
  if (applyGrace) return t.lateChargePreviewWithGrace ?? (base?.graceApplied ? base : null);
  return base && !base.graceApplied ? base : null;
}

function AmountRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.amountLabel, strong && styles.amountLabelStrong, muted && styles.muted]}>{label}</Text>
      <Text style={[styles.amountValue, strong && styles.amountValueStrong, muted && styles.mutedStrike]}>{value}</Text>
    </View>
  );
}

export default function LateReturnCard({
  timeline,
  legacy,
  applyGrace,
  onApplyGraceChange,
  waive,
  onWaiveChange,
  waiveReason,
  onWaiveReasonChange,
  waiveError,
  disabled,
}: Props) {
  if (timeline.lateMinutes <= 0) return null;

  const manualGrace =
    timeline.gracePolicyEnabled && timeline.graceType === 'MANUAL' && timeline.graceMinutes > 0;
  const preview = previewFor(timeline, manualGrace, applyGrace);
  const status = preview?.status ?? null;
  const showWaive = timeline.extraTimeEnabled && (status == null || CHARGEABLE.has(status));
  const charged = status === 'CHARGED' && preview != null;
  const when = legacy ? 'when you complete the return' : 'when you compute the bill';

  return (
    <>
      <Text style={styles.sectionHeader}>Late Return</Text>
      <View style={styles.card}>
        <View style={styles.head}>
          <Ionicons name="alarm-outline" size={18} color="#dc3545" />
          <View style={{ flex: 1 }}>
            <Text style={styles.headTitle}>Returned {rentalMinutesLabel(timeline.lateMinutes)} late</Text>
            <Text style={styles.headSub}>
              Due {fmtIstShort(timeline.currentEndAt)}
              {timeline.returnedAt ? ` · as of ${fmtIstShort(timeline.returnedAt)}` : ''}
            </Text>
          </View>
        </View>

        {manualGrace && (
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>Apply grace ({rentalMinutesLabel(timeline.graceMinutes)})</Text>
              <Text style={styles.hint}>This branch applies the grace period only when staff tick it.</Text>
            </View>
            <Switch
              value={applyGrace}
              onValueChange={onApplyGraceChange}
              disabled={disabled}
              trackColor={{ false: Colors.ink4, true: Colors.orange }}
              thumbColor={Colors.white}
            />
          </View>
        )}
        {!manualGrace && timeline.graceApplied && (
          <Text style={styles.hint}>{rentalMinutesLabel(timeline.graceMinutes)} grace applied.</Text>
        )}

        <View style={styles.previewBox}>
          {preview == null ? (
            <Text style={styles.previewText}>The late charge is worked out {when}.</Text>
          ) : status === 'WITHIN_GRACE' ? (
            <Text style={styles.previewText}>Within the grace period — no late charge.</Text>
          ) : status === 'DISABLED' ? (
            <Text style={styles.previewText}>Late-return charges are turned off for this branch — nothing is billed.</Text>
          ) : status === 'RATE_UNAVAILABLE' ? (
            <Text style={styles.previewWarn}>
              {legacy
                ? "This vehicle has no extra-hour rate set, so the late return won't be billed."
                : "This vehicle has no extra-hour rate set, so the late return can't be billed. Ask the branch manager to set the vehicle's pricing, or waive the charge with a reason."}
            </Text>
          ) : status === 'WAIVED' ? (
            <Text style={styles.previewText}>
              {waive ? 'Late charge waived.' : `The late charge is worked out ${when}.`}
            </Text>
          ) : charged ? (
            <>
              <AmountRow
                label={`${preview.hours} hr × ${inr2(num(preview.rate))}/hr`}
                value={inr2(num(preview.taxable))}
                muted={waive}
              />
              {preview.gstUnavailableReason ? (
                <Text style={styles.previewWarn}>
                  GST rates aren't set up for this branch — ask the branch manager to set the GST rule before
                  {legacy ? ' completing the return.' : ' computing the bill.'}
                </Text>
              ) : num(preview.gst) > 0 ? (
                // A server before item 8 still added GST to the late line
                <>
                  <AmountRow
                    label={`GST${preview.gstRate ? ` ${pct(preview.gstRate)}` : ''}`}
                    value={inr2(num(preview.gst))}
                    muted={waive}
                  />
                  <AmountRow label="Late charge" value={inr2(num(preview.total))} strong muted={waive} />
                </>
              ) : (
                <AmountRow label="Late charge (no GST)" value={inr2(num(preview.total))} strong muted={waive} />
              )}
              {waive ? (
                <Text style={styles.previewText}>Will be waived — not billed.</Text>
              ) : (
                <Text style={styles.previewText}>
                  {legacy
                    ? num(preview.gst) > 0
                      ? 'Billed with GST and collected by the branch manager.'
                      : 'Billed at face value (no GST) and collected by the branch manager.'
                    : num(preview.gst) > 0
                      ? 'Added to the drop bill as a taxable line.'
                      : 'Added to the drop bill (no GST).'}
                  {' '}Measured to the minute {legacy ? 'the return is completed' : 'the bill is first computed'}.
                </Text>
              )}
            </>
          ) : null}
        </View>

        {showWaive && (
          <>
            <View style={[styles.toggleRow, { marginTop: 12 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Waive late charge</Text>
                <Text style={styles.hint}>Logged with your name and the reason.</Text>
              </View>
              <Switch
                value={waive}
                onValueChange={onWaiveChange}
                disabled={disabled}
                trackColor={{ false: Colors.ink4, true: Colors.orange }}
                thumbColor={Colors.white}
              />
            </View>
            {waive && (
              <>
                <TextInput
                  style={[styles.input, waiveError ? styles.inputError : undefined]}
                  value={waiveReason}
                  onChangeText={onWaiveReasonChange}
                  placeholder="Reason for waiving (required)"
                  placeholderTextColor={Colors.ink4}
                  editable={!disabled}
                  maxLength={300}
                />
                {waiveError && <Text style={styles.fieldError}>{waiveError}</Text>}
              </>
            )}
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  headTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  headSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  toggleLabel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 4 },
  previewBox: { backgroundColor: Colors.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  previewText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  previewWarn: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706', lineHeight: 17 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  amountLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, flex: 1 },
  amountLabelStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  amountValue: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  amountValueStrong: { fontFamily: Fonts.bodySemiBold, fontSize: 14 },
  muted: { color: Colors.ink3 },
  mutedStrike: { color: Colors.ink3, textDecorationLine: 'line-through' },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  inputError: { borderColor: '#e53e3e' },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 8 },
});
