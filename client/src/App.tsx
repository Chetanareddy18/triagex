import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import type { Role } from './lib/types';
import Landing from './pages/Landing';
import { Login, Register } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const IncidentList = lazy(() => import('./pages/IncidentList'));
const IncidentDetail = lazy(() => import('./pages/IncidentDetail'));
const NewIncident = lazy(() => import('./pages/NewIncident'));
const ModelCard = lazy(() => import('./pages/ModelCard'));
const UsersAdmin = lazy(() => import('./pages/admin/Users'));
const SlaAdmin = lazy(() => import('./pages/admin/SlaPolicies'));
const AuditAdmin = lazy(() => import('./pages/admin/Audit'));
const NotFound = lazy(() => import('./pages/NotFound'));

function FullScreenSpinner() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="incidents" element={<IncidentList />} />
          <Route path="incidents/new" element={<NewIncident />} />
          <Route path="incidents/:id" element={<IncidentDetail />} />
          <Route
            path="model"
            element={
              <RequireAuth roles={['agent', 'admin']}>
                <ModelCard />
              </RequireAuth>
            }
          />
          <Route path="admin/users" element={<RequireAuth roles={['admin']}><UsersAdmin /></RequireAuth>} />
          <Route path="admin/sla" element={<RequireAuth roles={['admin']}><SlaAdmin /></RequireAuth>} />
          <Route path="admin/audit" element={<RequireAuth roles={['admin']}><AuditAdmin /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
