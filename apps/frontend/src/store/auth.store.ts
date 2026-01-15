import { create } from 'zustand';
import { authService } from '../services/auth.service';

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

    // Actions
    checkAuth: () => Promise<void>;
    login: (userData: User) => void;
    signup: (userData: User) => void;
    logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true, // Start loading to check session

    checkAuth: async () => {
        set({ isLoading: true });
        try {
            const response = await authService.checkAuth();
            // Assuming response.user contains the user data if authenticated
            if (response && response.user) {
                set({ user: response.user, isAuthenticated: true, isLoading: false });
            } else if (response && response.isAuthenticated) {
                // Fallback if backend just returns isAuthenticated: true but no user object in root
                // You might need to adjust based on actual API response structure of /me
                set({ user: response.user || { id: "session_user" }, isAuthenticated: true, isLoading: false });
            } else {
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
        set({ user: null, isAuthenticated: false });
    }
}));
