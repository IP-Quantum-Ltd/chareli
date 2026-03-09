import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

interface ProtectedRouteProps {
  requireAdmin?: boolean;
  requireConfig?: boolean;
}

export const ProtectedRoute = ({
  requireAdmin = false,
  requireConfig = false
}: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading } = useAuth();
  const permissions = usePermissions();

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#E328AF]"></div>
    </div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  // Check admin panel access (includes viewers)
  if (requireAdmin && !permissions.hasAdminAccess) {
    return <Navigate to="/" replace />;
  }

  // Check config access (excludes viewers)
  if (requireConfig && !permissions.canAccessConfig) {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
};
