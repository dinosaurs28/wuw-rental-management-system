import type { ReactNode } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

interface Props {
  uri?: string | null;
  height?: number;
  radius?: number;
  /** contain = cinematic "floating car" studio look; cover = fill */
  contain?: boolean;
  style?: ViewStyle;
  /** overlay content (chips, badges, controls) */
  children?: ReactNode;
}

// Cinematic near-black panel behind vehicle imagery (the Sixt "studio" treatment).
export default function StudioImage({ uri, height = 152, radius = 18, contain = true, style, children }: Props) {
  return (
    <View style={[{ height, borderRadius: radius, overflow: 'hidden', backgroundColor: Colors.cardDark }, style]}>
      <LinearGradient
        colors={['#23272f', '#15171c', '#0b0c10']}
        start={{ x: 0.25, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {uri ? (
        <Image source={{ uri }} style={styles.img} resizeMode={contain ? 'contain' : 'cover'} />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="car-sport-outline" size={40} color="rgba(255,255,255,0.16)" />
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: '100%' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
