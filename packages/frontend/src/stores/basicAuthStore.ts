import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/services/api';

interface BasicAuthState {
  isBasicAuthenticated: boolean;
  basicAuthToken: string | null;
  isBasicAuthEnabled: boolean | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; token?: string; error?: string }>;
  logout: () => void;
  checkBasicAuth: () => Promise<void>;
  checkBasicAuthStatus: () => Promise<void>;
  initializeAuth: () => Promise<void>;
}

export const useBasicAuthStore = create<BasicAuthState>()(
  persist(
    (set, get) => ({
      isBasicAuthenticated: false,
      basicAuthToken: null,
      isBasicAuthEnabled: null,
      isLoading: true,

      login: async (username: string, password: string) => {
        try {
          const response = await api.post<{ success: boolean; data?: { token: string }; error?: { message: string } }>(
            '/api/basic-auth/login',
            { username, password }
          );

          if (response.data.success && response.data.data?.token) {
            const token = response.data.data.token;
            set({
              isBasicAuthenticated: true,
              basicAuthToken: token,
            });
            return { success: true, token };
          }

          return { success: false, error: 'Login failed' };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Login failed';
          const axiosError = error as { response?: { data?: { error?: { message?: string } } } };
          return {
            success: false,
            error: axiosError.response?.data?.error?.message || errorMessage,
          };
        }
      },

      logout: () => {
        set({
          isBasicAuthenticated: false,
          basicAuthToken: null,
        });
        api.post('/api/basic-auth/logout').catch(() => {});
      },

      checkBasicAuth: async () => {
        const { basicAuthToken } = get();

        if (!basicAuthToken) {
          set({ isBasicAuthenticated: false });
          return;
        }

        try {
          const response = await api.get<{ success: boolean; data: { valid: boolean } }>(
            '/api/basic-auth/verify',
            { headers: { Authorization: `Bearer ${basicAuthToken}` } }
          );

          if (response.data.success && response.data.data.valid) {
            set({ isBasicAuthenticated: true });
          } else {
            set({ isBasicAuthenticated: false, basicAuthToken: null });
          }
        } catch {
          set({ isBasicAuthenticated: false, basicAuthToken: null });
        }
      },

      checkBasicAuthStatus: async () => {
        try {
          const response = await api.get<{ success: boolean; data: { enabled: boolean } }>(
            '/api/basic-auth/status'
          );

          if (response.data.success) {
            set({ isBasicAuthEnabled: response.data.data.enabled });
          }
        } catch {
          // If we can't reach the API, assume basic auth is disabled
          set({ isBasicAuthEnabled: false });
        }
      },

      // Initialize both checks and only set isLoading to false when both are done
      initializeAuth: async () => {
        set({ isLoading: true });
        try {
          // Run both checks in parallel
          await Promise.all([
            get().checkBasicAuthStatus(),
            get().checkBasicAuth(),
          ]);
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'claude-webui-basic-auth',
      partialize: (state) => ({ basicAuthToken: state.basicAuthToken }),
    }
  )
);
