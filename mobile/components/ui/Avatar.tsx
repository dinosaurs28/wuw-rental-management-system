import { Image, StyleSheet, View } from 'react-native';
import { Colors } from '../../constants/colors';

interface AvatarProps {
  seed: string;
  size?: number;
}

export default function Avatar({ seed, size = 42 }: AvatarProps) {
  const radius = size / 2;
  const uri = `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${encodeURIComponent(seed)}&size=128&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#e8e8e8',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.hairline,
  },
});
