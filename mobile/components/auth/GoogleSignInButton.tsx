import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

WebBrowser.maybeCompleteAuthSession();

const IOS_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const WEB_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const isGoogleConfigured = !!(IOS_ID || ANDROID_ID || WEB_ID);

interface Props {
  /** Receives the verified Google id_token. The caller is responsible for
   *  exchanging it with the backend and storing the resulting JWT. */
  onIdToken: (idToken: string) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Renders nothing if Google OAuth env vars are absent — the hook below
 * throws at construction time on iOS/Android when no platform client ID
 * is configured, so the entire component must be unmounted in that case.
 * Use the exported `isGoogleConfigured` from a parent to gate rendering.
 */
export default function GoogleSignInButton({ onIdToken, onError }: Props) {
  const [busy, setBusy] = useState(false);

  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: IOS_ID,
    androidClientId: ANDROID_ID,
    webClientId: WEB_ID,
    clientId: WEB_ID,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params?.id_token;
    if (!idToken) {
      onError?.('Google did not return an id_token.');
      setBusy(false);
      return;
    }
    (async () => {
      try {
        await onIdToken(idToken);
      } catch (err: any) {
        onError?.(err.response?.data?.message ?? 'Google sign-in failed.');
      } finally {
        setBusy(false);
      }
    })();
  }, [response]);

  const handlePress = async () => {
    setBusy(true);
    const r = await promptAsync();
    if (r.type !== 'success') setBusy(false);
  };

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={handlePress}
      disabled={busy}
      activeOpacity={0.85}
    >
      {busy ? (
        <ActivityIndicator size="small" color={Colors.ink} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={Colors.ink} />
          <Text style={styles.btnText}>Continue with Google</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  btnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
