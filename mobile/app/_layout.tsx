import { useEffect } from 'react';
import { View } from 'react-native';
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

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const token = useAuthStore((s) => s.token);
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isLoaded || segments.length === 0) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!token && !inAuthGroup) {
      router.replace('/(auth)/welcome');
    }
  }, [token, isLoaded, segments]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const isLoaded = useAuthStore((s) => s.isLoaded);

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
  }, []);

  useEffect(() => {
    if (fontsLoaded && isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isLoaded]);

  if (!fontsLoaded || !isLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <RootLayoutNav />
    </QueryClientProvider>
  );
}
