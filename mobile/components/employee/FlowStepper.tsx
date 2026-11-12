// Client TODO 11 (Nov 12 2026): the step indicator of the Pickup and Return
// flows. Every step reached (and any step whose earlier steps are complete) can
// be tapped; the screen decides where the tap lands (lib/flowSteps resolveJump).
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { FlowStep, StepState } from '../../lib/flowSteps';

interface Props<K extends string> {
  steps: FlowStep<K>[];
  states: StepState[];
  onSelect: (key: K) => void;
  disabled?: boolean;
}

export default function FlowStepper<K extends string>({ steps, states, onSelect, disabled }: Props<K>) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {steps.map((s, i) => {
        const state = states[i] ?? 'locked';
        const current = state === 'current';
        const done = state === 'done';
        const locked = state === 'locked';
        return (
          <View key={s.key} style={styles.item}>
            {i > 0 && <View style={[styles.line, (done || current) && styles.lineDone]} />}
            <TouchableOpacity
              style={styles.hit}
              onPress={() => onSelect(s.key)}
              disabled={disabled || current}
              hitSlop={6}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: current, disabled: locked }}
              accessibilityLabel={`Step ${i + 1}: ${s.label}${done ? ', done' : ''}`}
            >
              <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent, locked && styles.dotLocked]}>
                {done ? (
                  <Ionicons name="checkmark" size={12} color={Colors.white} />
                ) : (
                  <Text style={[styles.num, current && styles.numCurrent]}>{i + 1}</Text>
                )}
              </View>
              <Text
                style={[styles.label, current && styles.labelCurrent, locked && styles.labelLocked]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.hairline,
    backgroundColor: Colors.bg,
  },
  item: { flex: 1, alignItems: 'center', position: 'relative' },
  line: {
    position: 'absolute',
    top: 11,
    left: '-50%',
    right: '50%',
    height: 2,
    backgroundColor: Colors.ink4,
    marginHorizontal: 14,
  },
  lineDone: { backgroundColor: Colors.orange },
  hit: { alignItems: 'center', gap: 4, minWidth: 44 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.ink3,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  dotCurrent: { borderColor: Colors.orange, borderWidth: 2 },
  dotLocked: { borderColor: Colors.ink4 },
  num: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3 },
  numCurrent: { color: Colors.orange },
  label: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  labelCurrent: { color: Colors.ink, fontFamily: Fonts.bodySemiBold },
  labelLocked: { color: Colors.ink4 },
});
