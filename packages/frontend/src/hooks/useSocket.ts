import { useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { socketService } from '@/services/socket';

interface UseSocketReturn {
  socket: ReturnType<typeof socketService.getSocket>;
  isConnected: boolean;
}

export function useSocket(): UseSocketReturn {
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

  const socket = useMemo(() => socketService.getSocket(), [isAuthenticated, token]);
  const isConnected = socket?.connected ?? false;

  return { socket, isConnected };
}
