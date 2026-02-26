import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import AppLayout from '@/components/layout/AppLayout';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Eager-loaded pages (critical path)
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';

// Lazy-loaded pages (code-split chunks)
const BoxListPage = lazy(() => import('@/pages/BoxListPage'));
const BoxDetailPage = lazy(() => import('@/pages/BoxDetailPage'));
const OrderListPage = lazy(() => import('@/pages/OrderListPage'));
const OrderDetailPage = lazy(() => import('@/pages/OrderDetailPage'));
const HRListPage = lazy(() => import('@/pages/HRListPage'));
const HRDetailPage = lazy(() => import('@/pages/HRDetailPage'));
const LocationsPage = lazy(() => import('@/pages/LocationsPage'));
const LabelsPage = lazy(() => import('@/pages/LabelsPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const TenantsPage = lazy(() => import('@/pages/admin/TenantsPage'));
const AuditPage = lazy(() => import('@/pages/admin/AuditPage'));
const RetentionPage = lazy(() => import('@/pages/admin/RetentionPage'));
const TransferListPage = lazy(() => import('@/pages/TransferListPage'));
const TransferListDetailPage = lazy(() => import('@/pages/TransferListDetailPage'));
const ImportPage = lazy(() => import('@/pages/ImportPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const PublicSharePage = lazy(() => import('@/pages/PublicSharePage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary-500 mx-auto" size={40} />
          <p className="mt-4 text-sm text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-primary-500" size={40} />
      </div>
    );
  }

  const suspenseFallback = (
    <div className="flex justify-center py-12">
      <Loader2 className="animate-spin text-primary-500" size={32} />
    </div>
  );

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/share/:token" element={<Suspense fallback={suspenseFallback}><PublicSharePage /></Suspense>} />

      {/* Protected */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/boxes" element={<Suspense fallback={suspenseFallback}><BoxListPage /></Suspense>} />
        <Route path="/boxes/:id" element={<Suspense fallback={suspenseFallback}><BoxDetailPage /></Suspense>} />
        <Route path="/orders" element={<Suspense fallback={suspenseFallback}><OrderListPage /></Suspense>} />
        <Route path="/orders/:id" element={<Suspense fallback={suspenseFallback}><OrderDetailPage /></Suspense>} />
        <Route path="/hr" element={<Suspense fallback={suspenseFallback}><HRListPage /></Suspense>} />
        <Route path="/hr/:id" element={<Suspense fallback={suspenseFallback}><HRDetailPage /></Suspense>} />
        <Route path="/locations" element={<Suspense fallback={suspenseFallback}><LocationsPage /></Suspense>} />
        <Route path="/labels" element={<Suspense fallback={suspenseFallback}><LabelsPage /></Suspense>} />
        <Route path="/transfer-lists" element={<Suspense fallback={suspenseFallback}><TransferListPage /></Suspense>} />
        <Route path="/transfer-lists/:id" element={<Suspense fallback={suspenseFallback}><TransferListDetailPage /></Suspense>} />
        <Route path="/import" element={<Suspense fallback={suspenseFallback}><ImportPage /></Suspense>} />
        <Route path="/search" element={<Suspense fallback={suspenseFallback}><SearchPage /></Suspense>} />
        <Route path="/reports" element={<Suspense fallback={suspenseFallback}><ReportsPage /></Suspense>} />
        <Route path="/admin/users" element={<Suspense fallback={suspenseFallback}><UsersPage /></Suspense>} />
        <Route path="/admin/tenants" element={<Suspense fallback={suspenseFallback}><TenantsPage /></Suspense>} />
        <Route path="/admin/audit" element={<Suspense fallback={suspenseFallback}><AuditPage /></Suspense>} />
        <Route path="/admin/retention" element={<Suspense fallback={suspenseFallback}><RetentionPage /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={suspenseFallback}><SettingsPage /></Suspense>} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#fff',
                color: '#1f2937',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                borderRadius: '0.75rem',
                padding: '12px 16px',
              },
              ariaProps: {
                role: 'status',
                'aria-live': 'polite',
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
