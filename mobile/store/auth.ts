import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User } from '../types/api';

const TOKEN_KEY = 'wuw_access_token';
const USER_KEY = 'wuw_user';

interface AuthState {
  token: string | null;
  user: User | null;
  isLoaded: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoaded: false,

  signIn: async (token, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },

  signOut: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null });
  },

  loadFromStorage: async () => {
    try {
      const [token, userStr] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);
      const user = userStr ? (JSON.parse(userStr) as User) : null;
      // Route immediately on the cached session for a fast launch…
      set({ token, user, isLoaded: true });
      // …then revalidate the token and refresh role/profile in the background.
      // A 401 is auto-handled by the axios interceptor (it calls signOut), which
      // flips token→null and re-routes to the auth stack. Other errors keep cache.
      if (token) {
        try {
          const { authApi } = await import('../lib/api');
          const res = await authApi.me();
          const fresh = res?.data?.data as
            | { isAuthenticated?: boolean; name?: string; email?: string; role?: string; publicId?: string }
            | undefined;
          if (fresh?.isAuthenticated && fresh.publicId) {
            if (get().user) {
              // Merge fresh role/profile into the cached user.
              get().updateUser({
                name: fresh.name,
                email: fresh.email,
                role: fresh.role,
                publicId: fresh.publicId,
              });
            } else {
              // No cached user (e.g. an interrupted sign-in left token without user).
              // /auth/me returns the full required User shape — reconstruct from it.
              const reconstructed = {
                name: fresh.name ?? '',
                email: fresh.email ?? '',
                role: fresh.role ?? '',
                publicId: fresh.publicId,
              } as User;
              set({ user: reconstructed });
              await SecureStore.setItemAsync(USER_KEY, JSON.stringify(reconstructed));
            }
          }
        } catch {
          // network/transient error → keep the cached session as-is
        }
      }
    } catch {
      set({ token: null, user: null, isLoaded: true });
    }
  },

  updateUser: (partial) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...partial };
    set({ user: updated });
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
  },
}));
