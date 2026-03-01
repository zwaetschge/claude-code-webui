import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { getStoredUiProvider } from '@/lib/providers';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setToken } = useAuthStore();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      navigate(`/connect?error=${error}`);
      return;
    }

    if (token) {
      setToken(token).then(() => {
        const storedProvider = getStoredUiProvider();
        api.put('/api/settings', { uiProvider: storedProvider }).catch(() => {});
        navigate('/');
      });
    } else {
      navigate('/connect');
    }
  }, [searchParams, setToken, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
