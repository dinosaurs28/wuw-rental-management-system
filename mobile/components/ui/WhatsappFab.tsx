import { Alert, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const WHATSAPP_NUMBER = (process.env.EXPO_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

interface Props {
  bookingId?: string;
  bottom?: number;
  right?: number;
}

export default function WhatsappFab({ bookingId, bottom = 96, right = 20 }: Props) {
  if (!WHATSAPP_NUMBER) return null;

  const onPress = async () => {
    const message = bookingId
      ? `Hi, I need help with my booking [#${bookingId}]`
      : 'Hi, I need help with my booking';
    const text = encodeURIComponent(message);

    const appUrl = `whatsapp://send?phone=${WHATSAPP_NUMBER}&text=${text}`;
    const webUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;

    try {
      const supported = await Linking.canOpenURL(appUrl);
      await Linking.openURL(supported ? appUrl : webUrl);
    } catch {
      Alert.alert('Unable to open WhatsApp', 'Please install WhatsApp or try again.');
    }
  };

  return (
    <View style={[styles.wrap, { bottom, right }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.fab}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityLabel="Chat on WhatsApp"
        accessibilityRole="button"
      >
        <Ionicons name="logo-whatsapp" size={26} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 50,
    elevation: 8,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
});
