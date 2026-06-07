import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  employeeService,
  type SignInInput,
} from "../services/employee.service";

interface EmployeeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  branchPublicId?: string | null;
  branchName?: string | null;
}

interface EmployeeAuthState {
  user: EmployeeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: SignInInput) => Promise<void>;
  logout: () => void;
}

export const useEmployeeAuthStore = create<EmployeeAuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (data: SignInInput) => {
        set({ isLoading: true });
        try {
          const response = await employeeService.login(data);
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
        // Clear state
        set({ user: null, isAuthenticated: false });
        // Note: The persist middleware handles clearing storage if we clear the state here,
        // but strictly speaking, `sessionStorage` is cleared on tab close usually.
        // However, for explicit logout, we want to clear the persisted state.
      },
    }),
    {
      name: "employee-storage", // unique name
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }), // Only persist user and auth status
    },
  ),
);
