import { useAuth } from '../context/AuthContext';

export const usePermissions = () => {
  const { user } = useAuth();
  const userRole = user?.role?.name?.toLowerCase();

  const isSuperAdmin = userRole === 'superadmin';

  const permissions = {
    isSuperAdmin,
    isAdmin: userRole === 'admin',
    isEditor: userRole === 'editor',
    isViewer: userRole === 'viewer',
    isPlayer: userRole === 'player',

    // Permission checks
    canWrite:
      userRole === 'superadmin' ||
      userRole === 'admin' ||
      userRole === 'editor',
    canDelete: userRole === 'superadmin' || userRole === 'admin',
    canInvite: userRole === 'superadmin' || userRole === 'admin',
    canManageUsers: userRole === 'superadmin' || userRole === 'admin',
    canManageGames:
      userRole === 'superadmin' ||
      userRole === 'admin' ||
      userRole === 'editor',
    canAccessConfig: userRole === 'superadmin' || userRole === 'admin',
    canFilter:
      userRole === 'superadmin' ||
      userRole === 'admin' ||
      userRole === 'editor',
    canExport:
      userRole === 'superadmin' ||
      userRole === 'admin',
    canRevokeRoles: userRole === 'superadmin',
    canEditTeam: userRole === 'superadmin' || userRole === 'admin',
    canAccessCacheDashboard: userRole === 'superadmin', // Cache dashboard (dev/test only)
    canViewAnalytics:
      userRole === 'superadmin' ||
      userRole === 'admin' ||
      userRole === 'viewer',

    // Admin panel access
    hasAdminAccess:
      userRole === 'superadmin' ||
      userRole === 'admin' ||
      userRole === 'editor' ||
      userRole === 'viewer',

    // Read-only check
    isReadOnly: userRole === 'viewer',
  };

  return permissions;
};
