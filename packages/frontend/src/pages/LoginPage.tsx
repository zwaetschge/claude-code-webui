import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Github, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';

const errorMessages: Record<string, string> = {
  github: 'GitHub authentication failed. Please try again.',
  google: 'Google authentication failed. Please try again.',
  claude: 'Claude authentication failed. Please try again.',
  claude_not_logged_in: 'Claude CLI not logged in. Run "claude /login" first.',
  unauthorized: 'You are not authorized. Please sign in.',
  expired: 'Your session has expired. Please sign in again.',
};

interface AuthProviders {
  github: boolean;
  google: boolean;
  claude: boolean;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading } = useAuthStore();
  const error = searchParams.get('error');

  // Fetch available auth providers
  const { data: providers } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: AuthProviders }>('/auth/providers');
      return response.data.data;
    },
  });

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/');
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleGitHubLogin = () => {
    window.location.href = '/auth/github';
  };

  const handleGoogleLogin = () => {
    window.location.href = '/auth/google';
  };

  const handleClaudeLogin = () => {
    window.location.href = '/auth/claude';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background pattern-bg p-4">
      {/* Decorative elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 bg-[#D97757]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-[#D97757]/10 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative animate-fade-in card-hover gradient-border">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-2xl bg-[#D97757]/10 animate-glow">
              <img
                src="/claude-logo.png"
                alt="Claude"
                className="h-12 w-12 object-contain"
              />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Claude Code</CardTitle>
          <CardDescription className="text-base text-muted-foreground/80">
            WebUI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {error && (
            <div className="flex items-center gap-3 rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive animate-scale-in">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p>{errorMessages[error] || 'An error occurred. Please try again.'}</p>
            </div>
          )}

          {providers?.claude && (
            <Button
              onClick={handleClaudeLogin}
              className="w-full h-12 text-base gap-3 bg-[#D97757] hover:bg-[#C86747] text-white"
              size="lg"
            >
              <img src="/claude-logo.png" alt="" className="h-5 w-5 object-contain brightness-0 invert" />
              Continue with Claude
            </Button>
          )}

          {providers?.github && (
            <Button
              onClick={handleGitHubLogin}
              className="w-full h-12 text-base gap-3"
              variant="outline"
              size="lg"
            >
              <Github className="h-5 w-5" />
              Continue with GitHub
            </Button>
          )}

          {providers?.google && (
            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              className="w-full h-12 text-base gap-3"
              size="lg"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>
          )}

          {!providers?.claude && !providers?.github && !providers?.google && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">
                No authentication providers configured.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
