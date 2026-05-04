import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar as RNStatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: React.ReactNode;
  transparent?: boolean;
  lightContent?: boolean;
}

export default function ScreenHeader({
  title,
  subtitle,
  showBack = false,
  right,
  transparent = false,
  lightContent = false,
}: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 8 },
        transparent && styles.transparent,
      ]}
    >
      <View style={styles.row}>
        {showBack ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Text style={[styles.backIcon, lightContent && styles.light]}>←</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        <View style={styles.titleBlock}>
          <Text style={[styles.title, lightContent && styles.light]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text style={[styles.subtitle, lightContent && styles.subtitleLight]}>
              {subtitle}
            </Text>
          )}
        </View>

        <View style={styles.rightSlot}>{right ?? <View style={styles.backBtn} />}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.bg,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  transparent: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 22,
    color: Colors.ink,
  },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 1,
  },
  light: { color: Colors.white },
  subtitleLight: { color: 'rgba(255,255,255,0.6)' },
  rightSlot: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
