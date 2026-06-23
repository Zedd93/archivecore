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

const CHUNK_RELOAD_KEY = 'archivecore-chunk-reload-attempted';

function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
}

function lazyWithReload<T extends { default: React.ComponentType<any> }>(
  importer: () => Promise<T>
) {
  return lazy(() =>
    importer()
      .then((module) => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return module;
      })
      .catch((error) => {
        if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<T>(() => {});
        }

        throw error;
      })
  );
}

// Lazy-loaded pages (code-split chunks)
const BoxListPage = lazyWithReload(() => import('@/pages/BoxListPage'));
const BoxDetailPage = lazyWithReload(() => import('@/pages/BoxDetailPage'));
const FolderListPage = lazyWithReload(() => import('@/pages/FolderListPage'));
const OrderListPage = lazyWithReload(() => import('@/pages/OrderListPage'));
const OrderDetailPage = lazyWithReload(() => import('@/pages/OrderDetailPage'));
const LoansPage = lazyWithReload(() => import('@/pages/LoansPage'));
const HRListPage = lazyWithReload(() => import('@/pages/HRListPage'));
const HRDetailPage = lazyWithReload(() => import('@/pages/HRDetailPage'));
const LocationsPage = lazyWithReload(() => import('@/pages/LocationsPage'));
const LabelsPage = lazyWithReload(() => import('@/pages/LabelsPage'));
const SearchPage = lazyWithReload(() => import('@/pages/SearchPage'));
const ReportsPage = lazyWithReload(() => import('@/pages/ReportsPage'));
const UsersPage = lazyWithReload(() => import('@/pages/admin/UsersPage'));
const TenantsPage = lazyWithReload(() => import('@/pages/admin/TenantsPage'));
const AuditPage = lazyWithReload(() => import('@/pages/admin/AuditPage'));
const RetentionPage = lazyWithReload(() => import('@/pages/admin/RetentionPage'));
const TransferListPage = lazyWithReload(() => import('@/pages/TransferListPage'));
const TransferListDetailPage = lazyWithReload(() => import('@/pages/TransferListDetailPage'));
const ImportPage = lazyWithReload(() => import('@/pages/ImportPage'));
const SettingsPage = lazyWithReload(() => import('@/pages/SettingsPage'));
const PublicSharePage = lazyWithReload(() => import('@/pages/PublicSharePage'));

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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/boxes" element={<Suspense fallback={suspenseFallback}><BoxListPage /></Suspense>} />
        <Route path="/boxes/:id" element={<Suspense fallback={suspenseFallback}><BoxDetailPage /></Suspense>} />
        <Route path="/folders" element={<Suspense fallback={suspenseFallback}><FolderListPage /></Suspense>} />
        <Route path="/orders" element={<Suspense fallback={suspenseFallback}><OrderListPage /></Suspense>} />
        <Route path="/orders/:id" element={<Suspense fallback={suspenseFallback}><OrderDetailPage /></Suspense>} />
        <Route path="/loans" element={<Suspense fallback={suspenseFallback}><LoansPage /></Suspense>} />
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
                background: 'var(--toast-bg)',
                color: 'var(--toast-color)',
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
