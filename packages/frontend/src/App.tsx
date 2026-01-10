import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useBasicAuthStore } from '@/stores/basicAuthStore';
import { useSocket } from '@/hooks/useSocket';
import { Layout } from '@/components/layout/Layout';
import { Toaster } from '@/components/ui/toaster';

// Lazy load pages for code splitting
const BasicLoginPage = lazy(() => import('@/pages/BasicLoginPage').then(m => ({ default: m.BasicLoginPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage').then(m => ({ default: m.AuthCallbackPage })));
const ClaudeCallbackPage = lazy(() => import('@/pages/ClaudeCallbackPage').then(m => ({ default: m.ClaudeCallbackPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const SessionPage = lazy(() => import('@/pages/SessionPage').then(m => ({ default: m.SessionPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

// Route that requires basic auth (if enabled)
function BasicAuthRoute({ children }: { children: React.ReactNode }) {
  const { isBasicAuthenticated, isBasicAuthEnabled, isLoading } = useBasicAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // If basic auth is disabled, allow access
  if (isBasicAuthEnabled === false) {
    return <>{children}</>;
  }

  // If basic auth is enabled but not authenticated, redirect to basic login
  if (isBasicAuthEnabled === true && !isBasicAuthenticated) {
    return <Navigate to="/basic-login" replace />;
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { isBasicAuthenticated, isBasicAuthEnabled, isLoading: isBasicLoading } = useBasicAuthStore();

  // Initialize socket connection when authenticated
  useSocket();

  if (isLoading || isBasicLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // First check basic auth if enabled
  if (isBasicAuthEnabled === true && !isBasicAuthenticated) {
    return <Navigate to="/basic-login" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { initializeAuth } = useBasicAuthStore();

  // Initialize basic auth check on app mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/basic-login" element={<BasicLoginPage />} />
          <Route
            path="/login"
            element={
              <BasicAuthRoute>
                <LoginPage />
              </BasicAuthRoute>
            }
          />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/claude/callback" element={<ClaudeCallbackPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="session/:id" element={<SessionPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
