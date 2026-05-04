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
      set({ token, user, isLoaded: true });
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
