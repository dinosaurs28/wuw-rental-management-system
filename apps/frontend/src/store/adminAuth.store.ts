import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { adminService, type SignInInput } from '../services/admin.service';

interface AdminUser {
    id: string;
    email: string;
    name: string;
    role: string;
}

interface AdminAuthState {
    user: AdminUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (data: SignInInput) => Promise<void>;
    logout: () => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            isLoading: false,

            login: async (data: SignInInput) => {
                set({ isLoading: true });
                try {
                    const response = await adminService.login(data);
                    set({
                        user: response.user,
                        isAuthenticated: true,
                        isLoading: false,
                    });
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },

            logout: () => {
                set({ user: null, isAuthenticated: false });
            },
        }),
        {
            name: 'admin-storage',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
        }
    )
);
