import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  step?: number;
  title: string;
  subtitle?: string;
  icon?: IoniconName;
  state?: 'locked' | 'active' | 'completed';
  children?: ReactNode;
  rightSlot?: ReactNode;
  /** Hint shown when locked, describing what the user needs to do to unlock. */
  lockedHint?: string;
}

export default function SectionCard({
  step,
  title,
  subtitle,
  icon,
  state = 'active',
  children,
  rightSlot,
  lockedHint,
}: Props) {
  const locked = state === 'locked';
  const completed = state === 'completed';

  return (
    <View style={[styles.card, locked && styles.cardLocked]}>
      <View style={styles.header}>
        <View style={[styles.stepBadge, completed && styles.stepBadgeDone, locked && styles.stepBadgeLocked]}>
          {locked ? (
            <Ionicons name="lock-closed" size={13} color={Colors.ink3} />
          ) : completed ? (
            <Ionicons name="checkmark" size={14} color={Colors.white} />
          ) : icon ? (
            <Ionicons name={icon} size={14} color={Colors.white} />
          ) : step != null ? (
            <Text style={styles.stepNumber}>{step}</Text>
          ) : null}
        </View>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, locked && styles.textLocked]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, locked && styles.textLocked]}>{subtitle}</Text>
          ) : null}
        </View>
        {rightSlot ? <View style={styles.right}>{rightSlot}</View> : null}
      </View>

      {locked && lockedHint ? (
        <View style={styles.unlockHint}>
          <Ionicons name="arrow-up" size={13} color={Colors.ink3} />
          <Text style={styles.unlockHintText}>{lockedHint}</Text>
        </View>
      ) : null}

      {!locked && children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginBottom: 12,
  },
  cardLocked: {
    backgroundColor: '#f9f9f7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeDone: { backgroundColor: '#059669' },
  stepBadgeLocked: { backgroundColor: '#e8e8e6' },
  stepNumber: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.white,
  },
  stepNumberLocked: { color: Colors.ink3 },
  titleBlock: { flex: 1, gap: 2 },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
  },
  textLocked: { color: Colors.ink3 },
  right: {},
  body: {
    marginTop: 14,
  },
  unlockHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  unlockHintText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.ink3,
    flex: 1,
  },
});
