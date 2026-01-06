import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@claude-code-webui/shared';
import { api } from '@/services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,

      setToken: async (token: string) => {
        set({ token, isLoading: true });
        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, isAuthenticated: false, isLoading: false });
          }
        } catch {
          set({ token: null, isAuthenticated: false, isLoading: false });
        }
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
        api.post('/auth/logout').catch(() => {});
      },

      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isLoading: false });
          return;
        }

        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, user: null, isAuthenticated: false, isLoading: false });
          }
        } catch {
          set({ token: null, user: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: 'claude-webui-auth',
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        state?.checkAuth();
      },
    }
  )
);
