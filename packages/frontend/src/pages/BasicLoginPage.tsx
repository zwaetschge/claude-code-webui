import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, AlertCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBasicAuthStore } from '@/stores/basicAuthStore';
import { useAuthStore } from '@/stores/authStore';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { UI_PROVIDER_META } from '@/lib/providers';
import { PlumBackground } from '@/components/effects/PlumBackground';

export function BasicLoginPage() {
  const navigate = useNavigate();
  const { login } = useBasicAuthStore();
  const { setToken, isAuthenticated, isLoading: isAuthLoading } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairBot, setIsRepairBot] = useState(false);

  useEffect(() => {
    fetch('/api/instance-info')
      .then((r) => r.json())
      .then((data) => setIsRepairBot(!!data.repairBotMode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate('/');
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await login(username, password);

    if (result.success && result.token) {
      await setToken(result.token);
      navigate('/');
    } else {
      setError(result.error || 'Login failed');
    }

    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      {/* Repair Bot Banner */}
      {isRepairBot && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-600 text-white text-center py-1.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          EMERGENCY REPAIR WEBUI
          <AlertTriangle className="h-4 w-4 shrink-0" />
        </div>
      )}

      {/* Plum frosted glass background with animated lights */}
      <PlumBackground enableCursorGlow />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-10 px-6 py-12 lg:grid lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6 text-center lg:text-left">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card/80 shadow-lg ring-1 ring-border/60 backdrop-blur-sm">
              <img
                src="/logos/plum.png"
                alt="Plum Code WebUI"
                className="h-7 w-7 object-contain"
              />
            </div>
            <div className="text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                Plum Code WebUI
              </p>
              <p className="text-sm text-muted-foreground">A violet command center for CLI coding</p>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Orchestrate every CLI session from one plum-tinted cockpit.
            </h1>
            <p className="text-base text-muted-foreground">
              Manage sessions, switch providers, and keep context stitched together with a single dashboard.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            {(['claude', 'codex', 'zai', 'gemini'] as const).map((provider) => (
              <span key={provider} className="ui-pill ui-pill-subtle gap-2 backdrop-blur-sm">
                <ProviderLogo provider={provider} className="h-4 w-4" alt="" />
                <span className="text-xs font-medium">{UI_PROVIDER_META[provider].label}</span>
              </span>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Session Handoff</p>
              <p className="text-sm text-muted-foreground">
                Switch providers without losing context or momentum.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Shared Skills</p>
              <p className="text-sm text-muted-foreground">
                Reuse agents, skills, and tools across every CLI.
              </p>
            </div>
          </div>
        </div>

        <Card className="w-full max-w-md animate-fade-in glass gradient-border shadow-xl backdrop-blur-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-semibold">Sign in</CardTitle>
            <CardDescription className="text-sm text-muted-foreground/80">
              Use your Plum credentials to unlock the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-3 rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive animate-scale-in">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="pl-10"
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="pl-10 pr-10"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base gap-3"
                size="lg"
                disabled={isLoading || !username || !password}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
