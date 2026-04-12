import { create } from "zustand";
import { authService } from "../services/auth.service";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  // add other user properties as needed
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasBookingIntent: boolean;

  // Actions
  checkAuth: () => Promise<void>;
  login: (userData: User) => void;
  signup: (userData: User) => void;
  logout: () => Promise<void>;
  setBookingIntent: () => void;
  clearBookingIntent: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Start loading to check session
  hasBookingIntent: false,

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      // Always pass google=true to get full profile data (works for both email and Google users)
      const response = await authService.checkAuth(true);

      if (response?.data?.isAuthenticated && response.data.publicId) {
        // Full profile returned - always use fresh data from server
        set({
          user: {
            id: response.data.publicId,
            email: response.data.email || "",
            name: response.data.name || "",
            role: response.data.role || "",
          },
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        // Not authenticated or no profile data - clear everything
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (error) {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: (userData: User) => {
    set({ user: userData, isAuthenticated: true });
  },

  signup: (userData: User) => {
    set({ user: userData, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await authService.logout();
    } catch (e) {
      console.error("Logout failed", e);
    }
    set({ user: null, isAuthenticated: false, hasBookingIntent: false });
  },

  setBookingIntent: () => set({ hasBookingIntent: true }),
  clearBookingIntent: () => set({ hasBookingIntent: false }),
}));
