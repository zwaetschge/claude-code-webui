import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';

export function ClaudeCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setToken } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(searchParams.get('error_description') || 'Authentication was cancelled or failed.');
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMessage('Missing authorization code or state parameter.');
      return;
    }

    // Exchange code for tokens
    const exchangeCode = async () => {
      try {
        const response = await api.post<{
          success: boolean;
          data?: { token: string };
          error?: { message: string };
        }>('/auth/claude/callback', { code, state });

        if (response.data.success && response.data.data?.token) {
          setStatus('success');
          await setToken(response.data.data.token);
          setTimeout(() => navigate('/'), 1500);
        } else {
          setStatus('error');
          setErrorMessage(response.data.error?.message || 'Failed to complete authentication.');
        }
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    };

    exchangeCode();
  }, [searchParams, setToken, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background pattern-bg p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {status === 'loading' && 'Authenticating...'}
            {status === 'success' && 'Success!'}
            {status === 'error' && 'Authentication Failed'}
          </CardTitle>
          <CardDescription>
            {status === 'loading' && 'Please wait while we complete your sign in.'}
            {status === 'success' && 'Redirecting you to the dashboard...'}
            {status === 'error' && 'There was a problem signing you in.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === 'loading' && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {status === 'success' && (
            <CheckCircle className="h-12 w-12 text-green-500" />
          )}
          {status === 'error' && (
            <>
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-muted-foreground text-center">{errorMessage}</p>
              <button
                onClick={() => navigate('/login')}
                className="text-sm text-primary hover:underline"
              >
                Back to login
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
