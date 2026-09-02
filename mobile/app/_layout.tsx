// MUST be first: patches global fetch to use XHR on Android (workaround for expo/expo#40061)
import '../lib/fetch-xhr-polyfill';
import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SplashScreen, Slot, useRouter, useSegments } from 'expo-router';
import { Colors } from '../constants/colors';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { queryClient } from '../lib/query-client';
import { useAuthStore } from '../store/auth';
import { useSavedStore } from '../store/saved';
import SplashAnimation from '../components/SplashAnimation';
import NoInternetScreen from '../components/NoInternetScreen';

// Public connectivity probes — checking the device has internet, NOT whether
// our backend is up. Backend failures are surfaced by individual queries.
const CONNECTIVITY_PROBES = [
  'https://www.gstatic.com/generate_204',
  'https://www.cloudflare.com/cdn-cgi/trace',
];

SplashScreen.preventAutoHideAsync();

// Route groups a guest genuinely cannot use — every screen under them acts on a
// specific customer's or employee's own records. Everything else (the fleet,
// vehicle detail, search, saved, legal, contact) is public and must stay
// reachable without an account: App Store guideline 5.1.1(v).
//
// This is deliberately an explicit deny-list keyed on the first segment, so a
// screen added later defaults to PUBLIC rather than silently walling itself off.
// The account-based tabs — (tabs)/trips and (tabs)/profile — are absent on
// purpose: they render <SignInRequired> in place, which explains what an account
// unlocks instead of throwing the user out of the tab they tapped.
const GUEST_BLOCKED_SEGMENTS = [
  '(employee)',     // employeeApi.* throughout — staff session
  'employee',       // ditto
  'booking',        // userApi.kyc/profile/cancelHold, POST .../booking
  'trip',           // userApi.kyc/cancelHold/invoiceDownload
  'profile',        // userApi.profile/updateProfile
  'delete-account', // userApi.deleteAccount
  'cancellations',  // userApi.cancellationHistory — one customer's fees
  'document-viewer',// renders a KYC document handed to it by an account screen
];

function RootLayoutNav() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isLoaded || segments.length < 1) return;
    const inEmployeeGroup = segments[0] === '(employee)' || segments[0] === 'employee';

    if (!token) {
      // Guests browse freely; only the account-based stacks bounce them, and
      // only as a backstop — the screens themselves prompt at the point of
      // action, which is where a sign-in makes sense to the user.
      if (GUEST_BLOCKED_SEGMENTS.includes(segments[0])) {
        router.replace('/(auth)/sign-in');
      }
      return;
    }

    if (user?.role === 'STAFF' && !inEmployeeGroup) {
      router.replace('/(employee)/dashboard');
    }
  }, [token, isLoaded, segments, user?.role]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const loadSaved = useSavedStore((s) => s.load);
  const [showSplash, setShowSplash] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const appState = useRef(AppState.currentState);

  const probeOnce = async (url: string, timeoutMs: number) => {
    // Use axios (XHR-based) instead of fetch — avoids the SDK 54 fetch
    // regression that gives false negatives on physical Android devices.
    try {
      const axios = (await import('axios')).default;
      await axios.head(url, { timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  };

  const checkNetwork = async () => {
    // Two passes over the probe list — any single success means we're online.
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const url of CONNECTIVITY_PROBES) {
        if (await probeOnce(url, 10_000)) {
          setIsOnline(true);
          return;
        }
      }
    }
    setIsOnline(false);
  };

  const handleRetry = async () => {
    setRetrying(true);
    await checkNetwork();
    setRetrying(false);
  };

  useEffect(() => {
    // Check once after splash so it doesn't delay the initial render
    const t = setTimeout(checkNetwork, 1600);
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        checkNetwork();
      }
      appState.current = next;
    });
    return () => { clearTimeout(t); sub.remove(); };
  }, []);

  // While offline, auto-recheck every 8s so the user doesn't have to tap Retry
  // for transient drops to recover.
  useEffect(() => {
    if (isOnline) return;
    const id = setInterval(checkNetwork, 8000);
    return () => clearInterval(id);
  }, [isOnline]);

  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    loadFromStorage();
    loadSaved();
  }, []);

  useEffect(() => {
    if (fontsLoaded && isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoaded]);

  if (!fontsLoaded || !isLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <RootLayoutNav />
        {showSplash && (
          <SplashAnimation onDone={() => setShowSplash(false)} />
        )}
        {!showSplash && !isOnline && (
          <NoInternetScreen onRetry={handleRetry} retrying={retrying} />
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
