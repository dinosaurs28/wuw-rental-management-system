import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Fonts } from '../constants/colors';
import Button from '../components/ui/Button';
import { useAuthStore } from '../store/auth';

/**
 * Guest access.
 *
 * App Store guideline 5.1.1(v) requires that anything which is not
 * account-based stays reachable without an account. Browsing vehicles,
 * branches, categories and legal pages is public — the backend already serves
 * all of it unauthenticated via /api/public. Only account-based actions
 * (booking, trips, profile) may ask the user to sign in, and only at the point
 * the action is taken.
 *
 * Never gate a whole screen that merely *displays* public data.
 */

/** True when nobody is signed in. Browsing must work in this state. */
export function useIsGuest(): boolean {
  return !useAuthStore((s) => s.token);
}

/**
 * Sends a guest to sign-in, remembering where they were headed so the flow
 * resumes after authentication instead of dumping them on the home tab.
 */
export function useRequireAuth() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);

  /**
   * Returns true when the caller may proceed. When it returns false it has
   * already navigated to sign-in, so the caller must simply stop.
   *
   *   if (!requireAuth({ returnTo: `/vehicle/${id}` })) return;
   *   proceedWithBooking();
   */
  return (opts?: { returnTo?: string }): boolean => {
    if (token) return true;
    router.push({
      pathname: '/(auth)/sign-in',
      params: opts?.returnTo ? { returnTo: opts.returnTo } : {},
    });
    return false;
  };
}

interface SignInRequiredProps {
  /** What the user is trying to reach, e.g. "Your trips". */
  title: string;
  /** Why an account is needed. One short sentence. */
  description: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Where to come back to after signing in. */
  returnTo?: string;
  /** Optional extra content rendered under the actions. */
  children?: ReactNode;
}

/**
 * Full-screen state for a tab that is genuinely account-based (Trips,
 * Profile). It explains what signing in unlocks rather than blocking the app.
 *
 * Do NOT use this to cover a screen that shows public content.
 */
export function SignInRequired({
  title,
  description,
  icon = 'person-circle-outline',
  returnTo,
  children,
}: SignInRequiredProps) {
  const router = useRouter();
  const params = returnTo ? { returnTo } : {};

  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={38} color={Colors.orange} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{description}</Text>
      <View style={styles.actions}>
        <Button
          title="Sign in"
          onPress={() => router.push({ pathname: '/(auth)/sign-in', params })}
        />
        <Button
          title="Create an account"
          variant="secondary"
          onPress={() => router.push({ pathname: '/(auth)/sign-up', params })}
          style={styles.secondary}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink3,
    textAlign: 'center',
    marginBottom: 28,
  },
  actions: { width: '100%' },
  secondary: { marginTop: 10 },
});
