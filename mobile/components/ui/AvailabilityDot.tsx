import { View } from 'react-native';
import { availabilityColor } from '../../lib/availability';

// Colored dot driven by real availableCount (green 3+ / amber 1-2 / red 0).
export default function AvailabilityDot({ count, size = 7 }: { count?: number | null; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: availabilityColor(count) }}
    />
  );
}
