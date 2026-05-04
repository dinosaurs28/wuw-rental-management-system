import { Redirect } from 'expo-router';
import { useAuthStore } from '../store/auth';

export default function Index() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  if (!token) return <Redirect href="/(auth)/welcome" />;
  if (user?.role === 'STAFF') return <Redirect href="/(employee)/dashboard" />;
  return <Redirect href="/(tabs)" />;
}
