import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/types";
import { SessionProvider } from "@/auth/session";
import { AuthCallback, AuthGuard, AdminGuard, LoginPage } from "@/auth/pages";
import AppShell from "@/layout/AppShell";

const Playground = lazy(() => import("@/features/Playground"));
const Overview = lazy(() => import("@/features/Overview"));
const Profiles = lazy(() => import("@/features/Profiles").then((m) => ({ default: m.default })));
const ProfileDetail = lazy(() => import("@/features/Profiles").then((m) => ({ default: m.ProfileDetail })));
const Keys = lazy(() => import("@/features/Keys"));
const Tokens = lazy(() => import("@/features/Tokens"));
const Controller = lazy(() => import("@/features/Controller"));
const SettingsPage = lazy(() => import("@/features/Ops").then((m) => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <SessionProvider>
      <TooltipProvider>
        <Toaster position="bottom-right" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/app" element={<AuthGuard><AppShell /></AuthGuard>}>
                <Route index element={<Navigate to="playground" replace />} />
                <Route path="playground" element={<Playground />} />
                <Route path="overview" element={<Overview />} />
                <Route path="profiles" element={<Profiles />} />
                <Route path="profiles/:id" element={<ProfileDetail />} />
                <Route path="keys" element={<Keys />} />
                <Route path="tokens" element={<Tokens />} />
                <Route path="controller" element={<AdminGuard><Controller /></AdminGuard>} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/app/playground" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </SessionProvider>
  </QueryClientProvider>
);

export default App;
