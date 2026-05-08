import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import Button from '../../components/ui/Button';

export default function PhoneSignIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.inner,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 80 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>
              Sign in with{'\n'}
              <Text style={styles.titleAccent}>phone.</Text>
            </Text>
            <Text style={styles.subtitle}>
              Phone-based sign in is not yet available on mobile. Coming soon.
            </Text>
          </View>

          <View style={styles.notice}>
            <Ionicons name="time-outline" size={20} color={Colors.orange} style={{ marginRight: 10 }} />
            <Text style={styles.noticeText}>Coming soon</Text>
          </View>

          <Button title="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  inner: { paddingHorizontal: 24, flexGrow: 1 },
  back: { marginBottom: 32, width: 36, height: 36, justifyContent: 'center' },
  titleBlock: { marginBottom: 28 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 38,
    color: Colors.ink,
    lineHeight: 44,
    letterSpacing: -1.2,
  },
  titleAccent: {
    fontFamily: Fonts.displayItalic,
    color: Colors.orange,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    marginTop: 10,
    lineHeight: 22,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.orangeSoft,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  noticeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
});
