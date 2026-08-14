import type { ReactNode } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

interface Props {
  uri?: string | null;
  height?: number;
  radius?: number;
  /** contain = cinematic "floating car" studio look; cover = fill the frame */
  contain?: boolean;
  /** darken top + bottom edges so overlaid chips stay legible on any photo */
  scrim?: boolean;
  style?: ViewStyle;
  /** overlay content (chips, badges, controls) */
  children?: ReactNode;
}

// Near-black panel behind vehicle imagery. Use `contain` for transparent cut-outs,
// `cover` + `scrim` for real catalog photos that carry their own backgrounds.
export default function StudioImage({ uri, height = 152, radius = 18, contain = true, scrim = false, style, children }: Props) {
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
      {scrim ? (
        <>
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={styles.scrimTop} pointerEvents="none" />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.scrimBottom} pointerEvents="none" />
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: '100%' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '42%' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '42%' },
});
