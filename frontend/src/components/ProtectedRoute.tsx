import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from './overlays';
import type { Role } from '../types';

export function ProtectedRoute({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !hasRole(...roles)) return <BackToDashboard />;
  return <>{children}</>;
}

/** An old link or bookmark to a page another role uses: back to the dashboard, with a word about why. */
function BackToDashboard() {
  useEffect(() => {
    toast('That page belongs to another team, so here is your dashboard', 'info');
  }, []);
  return <Navigate to="/" replace />;
}
