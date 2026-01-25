import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { branchManagerService, type SignInInput } from '../services/branch.service';

interface BranchManagerUser {
    id: string;
    email: string;
    name: string;
    role: string;
}

interface BranchManagerAuthState {
    user: BranchManagerUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (data: SignInInput) => Promise<void>;
    logout: () => void;
}

export const useBranchManagerAuthStore = create<BranchManagerAuthState>()(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            isLoading: false,

            login: async (data: SignInInput) => {
                set({ isLoading: true });
                try {
                    const response = await branchManagerService.login(data);
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
            name: 'branch-manager-storage',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
        }
    )
);
