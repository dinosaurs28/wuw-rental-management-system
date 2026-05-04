import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';

type ToastType = 'error' | 'success' | 'info';

interface ToastProps {
  visible: boolean;
  title: string;
  message?: string;
  type?: ToastType;
  onDismiss: () => void;
}

const CONFIG: Record<ToastType, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; bg: string }> = {
  error:   { icon: 'alert-circle',      color: '#e53e3e', bg: '#fff5f5' },
  success: { icon: 'checkmark-circle',  color: '#2d9d61', bg: '#f0faf4' },
  info:    { icon: 'information-circle', color: Colors.orange, bg: '#fff8f4' },
};

export default function Toast({ visible, title, message, type = 'error', onDismiss }: ToastProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 70,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        hide();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const hide = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  if (!visible) return null;

  const { icon, color, bg } = CONFIG[type];

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 12, opacity, transform: [{ translateY }], backgroundColor: bg },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message} numberOfLines={2}>{message}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
    zIndex: 9999,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    lineHeight: 18,
  },
});
