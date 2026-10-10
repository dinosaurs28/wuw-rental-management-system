import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { pausedLabel, savedAtLabel, type OperationDraftSummary } from '../../lib/operationDraft';
import type { OperationDraftController } from '../../hooks/useOperationDraft';

// Paused pickup / drop (client item 2) — the bits the pickup and drop screens
// and the queue cards share. State lives in hooks/useOperationDraft.

// Header action: save what's entered and leave; resume later from the queue.
export function ContinueLaterButton({ draft }: { draft: OperationDraftController }) {
  if (!draft.canPause) return null;
  return (
    <TouchableOpacity
      style={styles.pauseBtn}
      onPress={draft.continueLater}
      hitSlop={8}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Save and continue later"
    >
      <Ionicons name="pause-circle-outline" size={16} color={Colors.ink2} />
      <Text style={styles.pauseText}>Continue later</Text>
    </TouchableOpacity>
  );
}

// Under the screen title: whether what's entered is saved for later.
export function DraftSaveStatus({ draft }: { draft: OperationDraftController }) {
  if (!draft.canPause) return null;
  if (draft.saveState === 'saving') return <Text style={styles.status} numberOfLines={1}>Saving…</Text>;
  if (draft.saveState === 'error') {
    return <Text style={[styles.status, styles.statusError]} numberOfLines={1}>Not saved — check the connection</Text>;
  }
  if (!draft.lastSavedAt) return null;
  return <Text style={styles.status} numberOfLines={1}>Saved {savedAtLabel(draft.lastSavedAt)}</Text>;
}

// "Resumed — saved 10:42 am by Ravi", shown when the form was restored.
export function ResumedBanner({ draft }: { draft: OperationDraftController }) {
  const resumed = draft.resumed;
  if (!resumed) return null;
  const when = savedAtLabel(resumed.updatedAt);
  return (
    <View style={styles.banner}>
      <Ionicons name="play-circle-outline" size={16} color={Colors.availLow} />
      <Text style={styles.bannerText}>
        Resumed — saved{when ? ` ${when}` : ''}{resumed.updatedByName ? ` by ${resumed.updatedByName}` : ''}. Photos and details entered earlier are back.
      </Text>
      <TouchableOpacity onPress={draft.dismissResumed} hitSlop={8} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={16} color={Colors.ink3} />
      </TouchableOpacity>
    </View>
  );
}

// "Paused · 10:42 am by Ravi" chip on a queue / recovery card.
export function PausedChip({ draft }: { draft: OperationDraftSummary | null | undefined }) {
  if (!draft) return null;
  return (
    <View style={styles.chip}>
      <Ionicons name="pause" size={11} color={Colors.availLow} />
      <Text style={styles.chipText} numberOfLines={1}>{pausedLabel(draft)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pauseBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  pauseText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  status: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  statusError: { color: Colors.availNone },

  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.availLowSoft,
  },
  bannerText: { flex: 1, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18, color: Colors.ink2 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.availLowSoft,
  },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.availLow },
});
