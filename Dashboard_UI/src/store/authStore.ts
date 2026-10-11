import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { apiErrorMessage, login as loginRequest } from "../api/routes";

interface AuthState {
  token: string | null;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist<AuthState, [], [], Pick<AuthState, "token">>(
    (set) => ({
      token: null,
      isLoading: false,
      error: null,

      /** Resolves true on success so callers can navigate. */
      login: async (username, password) => {
        set({ isLoading: true, error: null });

        try {
          const data = await loginRequest({
            user_name: username,
            password,
          });

          set({ token: data.access_token, isLoading: false, error: null });
          return true;
        } catch (err) {
          set({ error: apiErrorMessage(err), isLoading: false });
          return false;
        }
      },

      logout: () => set({ token: null, error: null }),
      clearError: () => set({ error: null }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ token }) => ({ token }),
    },
  ),
);
