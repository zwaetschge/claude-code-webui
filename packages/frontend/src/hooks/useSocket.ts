import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { socketService } from '@/services/socket';

export function useSocket(): void {
  const { isAuthenticated, token } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated && token) {
      try {
        socketService.connect();
      } catch (error) {
        console.error('Failed to connect socket:', error);
      }
    }

    return () => {
      if (!isAuthenticated) {
        socketService.disconnect();
      }
    };
  }, [isAuthenticated, token]);
}
