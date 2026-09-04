import { Redirect } from 'expo-router';
import { useAuthStore } from '../store/auth';

export default function Index() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  if (token && user?.role === 'STAFF') return <Redirect href="/(employee)/dashboard" />;
  // Guests land on the fleet, not on a sign-in wall — browsing is public.
  return <Redirect href="/(tabs)" />;
}
