import React, { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import AdminNavbar from '../components/single/AdminNavbar';
import { NavLink } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { useProposals, useMyProposals } from '../backend/proposal.service';
import { GameProposalStatus } from '../backend/types';
import { Database, ImageIcon, Home, Gamepad2, Shapes, UserRound, Users2, Sliders, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

const allMenuItems = [
  {
    title: 'Home',
    icon: <Home size={20} />,
    path: '/admin',
    requiresConfig: false,
  },
  {
    title: 'Game Management',
    icon: <Gamepad2 size={20} />,
    path: '/admin/game-management',
    requiresConfig: false,
  },
  {
    title: 'My Proposals',
    icon: <FileText size={20} />,
    path: '/admin/my-proposals',
    requiresConfig: false,
  },
  {
    title: 'Review Queue',
    icon: <FileText size={20} />,
    path: '/admin/proposals',
    requiresConfig: false,
  },
  // {
  //   title: 'Edit Proposals',
  //   icon: <FileText size={20} />,
  //   path: '/admin/edit-proposals',
  //   requiresConfig: false,
  // }, // To be implemented for Admin Flow
  {
    title: 'Game Category',
    icon: <Shapes size={20} />,
    path: '/admin/categories',
    requiresConfig: false,
  },
  {
    title: 'User Management',
    icon: <UserRound size={20} />,
    path: '/admin/management',
    requiresConfig: false,
  },
  {
    title: 'Team Management',
    icon: <Users2 size={20} />,
    path: '/admin/team',
    requiresConfig: false,
  },
  // {
  //   title: "Analytics",
  //   icon: <FaChartLine size={20} />,
  //   path: "/admin/analytics",
  //   requiresConfig: false,
  // },
  {
    title: 'Configuration',
    icon: <Sliders size={20} />,
    path: '/admin/config',
    requiresConfig: true,
  },
];

// Check if cache dashboard is enabled (via environment variable)
const isCacheDashboardEnabled = () => {
  // Check if explicitly enabled via environment variable
  const enabledViaEnv = import.meta.env.VITE_ENABLE_CACHE_DASHBOARD === 'true';
  // Also enable for local development
  const mode = import.meta.env.MODE;
  const isLocalDev = mode === 'development' || mode === 'test';

  return enabledViaEnv || isLocalDev;
};

const AdminLayout: React.FC = () => {
  const permissions = usePermissions();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [navbarHeight, setNavbarHeight] = useState(73);
  const navbarRef = useRef<HTMLDivElement>(null);

  // Fetch proposal counts for badges - conditionally based on role
  // Only admins can access the all-proposals endpoint
  const isAdminOrSuper = permissions.isAdmin || permissions.isSuperAdmin;
  const { data: allProposals } = useProposals(undefined, isAdminOrSuper);
  // Only editors need their personal proposals for the counter
  const { data: myProposals } = useMyProposals(permissions.isEditor);

  // Calculate counts
  const pendingReviewCount = allProposals?.filter(p => p.status === GameProposalStatus.PENDING).length || 0;
  // Only count declined proposals that haven't had feedback dismissed
  const myActionableCount = myProposals?.filter(p =>
    p.status === GameProposalStatus.DECLINED && !p.feedbackDismissedAt
  ).length || 0;

  // Filter menu items based on permissions
  const menuItems = allMenuItems.filter((item) => {
    // 1. Config Check
    if (item.requiresConfig && !permissions.canAccessConfig) {
      return false;
    }

    // 2. Role-based Visibility Checks
    switch (item.title) {
      case 'Home':
        // Hide Home from Editors (strictly per request)
        return !permissions.isEditor;

      case 'Game Management':
        return permissions.canManageGames; // Editors, Admins, SuperAdmins

      case 'My Proposals':
        return permissions.isEditor;

      case 'Review Queue':
        return permissions.isAdmin || permissions.isSuperAdmin;

      case 'Game Category':
        // Hide Categories from Editors (since they can't manage them or shouldn't see them)
        return !permissions.isEditor;

      case 'User Management':
        return permissions.canManageUsers; // Admins, SuperAdmins

      case 'Team Management':
        return permissions.canEditTeam; // Admins, SuperAdmins

      default:
        return true;
    }
  });

  // Add Cache Dashboard for superadmin when enabled
  if (permissions.canAccessCacheDashboard && isCacheDashboardEnabled()) {
    menuItems.push({
      title: 'Cache Dashboard',
      icon: <Database size={20} />,
      path: '/admin/cache',
      requiresConfig: false,
    });
    menuItems.push({
      title: 'Image Reprocessing',
      icon: <ImageIcon size={20} />,
      path: '/admin/image-reprocessing',
      requiresConfig: false,
    });
  }

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  // Helper to get badge count for a menu item
  const getBadgeCount = (title: string): number => {
    switch (title) {
      case 'Review Queue':
        return pendingReviewCount;
      case 'My Proposals':
        return myActionableCount;
      default:
        return 0;
    }
  };

  // Measure navbar height dynamically
  useEffect(() => {
    const measureNavbarHeight = () => {
      if (navbarRef.current) {
        const height = navbarRef.current.offsetHeight;
        setNavbarHeight(height);
      }
    };

    // Measure on mount and when window resizes
    measureNavbarHeight();
    window.addEventListener('resize', measureNavbarHeight);

    // Use ResizeObserver to detect navbar height changes
    const resizeObserver = new ResizeObserver(measureNavbarHeight);
    if (navbarRef.current) {
      resizeObserver.observe(navbarRef.current);
    }

    return () => {
      window.removeEventListener('resize', measureNavbarHeight);
      resizeObserver.disconnect();
    };
  }, []);

  // Check if screen is mobile and set initial sidebar state
  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 1024; // lg breakpoint
      setIsMobile(mobile);
      // On mobile, default sidebar to hidden
      if (mobile) {
        setIsSidebarCollapsed(true);
      }
    };

    // Check on initial load
    checkScreenSize();

    // Add event listener for window resize
    window.addEventListener('resize', checkScreenSize);

    // Cleanup event listener
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Admin route cursor override logic removed - using normal system cursors throughout

  return (
    <div className="admin-layout min-h-screen bg-[#fef7ed] dark:bg-[#0f1221] text-gray-900 dark:text-white transition-colors duration-300">
      <div ref={navbarRef} className="fixed top-0 left-0 right-0 z-50">
        <AdminNavbar />
      </div>

      <div className="flex" style={{ paddingTop: `${navbarHeight}px` }}>
        <div
          className={`fixed z-20 transition-all duration-300 transform ${
            isSidebarCollapsed
              ? '-translate-x-full lg:translate-x-0 w-16'
              : 'translate-x-0 w-60'
          }`}
          style={{
            height: `calc(100vh - ${navbarHeight}px)`,
            top: `${navbarHeight}px`,
          }}
        >
          <aside className="h-full bg-[#F1F5F9] dark:bg-[#0f1221]/95 backdrop-blur-sm transition-colors duration-300 border-r border-gray-200 dark:border-gray-800">
            <div className="flex flex-col h-full relative">
              <nav className="flex-1">
                <ul className="space-y-5 px-2 py-4">
                  {menuItems.map((item, index) => {
                    const badgeCount = getBadgeCount(item.title);
                    return (
                      <li key={index}>
                        <NavLink
                          to={item.path}
                          end={item.path === '/admin'}
                          className={({ isActive }) =>
                            `flex items-center p-2 rounded-lg transition-colors ${
                              isActive
                                ? 'bg-[#6A7282] text-white'
                                : 'hover:text-[#6A7282] hover:bg-[#E2E8F0] dark:text-white dark:hover:text-[#6A7282] text-[#121C2D]'
                            } ${isSidebarCollapsed ? 'justify-center' : ''}`
                          }
                          onClick={() => {
                            if (isMobile) {
                              setIsSidebarCollapsed(true);
                            }
                          }}
                        >
                          <span className={`relative ${isSidebarCollapsed ? '' : 'mr-3'}`}>
                            {item.icon}
                            {/* Badge for collapsed state */}
                            {isSidebarCollapsed && badgeCount > 0 && (
                              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                {badgeCount > 9 ? '9+' : badgeCount}
                              </span>
                            )}
                          </span>
                          {!isSidebarCollapsed && (
                            <span className="text-lg flex-1">{item.title}</span>
                          )}
                          {/* Badge for expanded state */}
                          {!isSidebarCollapsed && badgeCount > 0 && (
                            <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                              {badgeCount}
                            </span>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {/* Collapse toggle button */}
              <div className="border-t border-gray-200 dark:border-gray-800 p-4">
                <button
                  onClick={toggleSidebar}
                  className={`absolute ${
                    isSidebarCollapsed ? '-right-12' : '-right-4'
                  } bg-[#6A7282] dark:bg-[#6A7282] rounded-full p-1.5 text-white hover:bg-[#5A626F] dark:hover:bg-[#5A626F] shadow-lg transition-all duration-300`}
                  style={{ bottom: '20px' }}
                >
                  {isSidebarCollapsed ? (
                    <ChevronRight
                      size={18}
                      className="cursor-pointer"
                    />
                  ) : (
                    <ChevronLeft
                      size={18}
                      className="cursor-pointer"
                    />
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
        {/* Main content with responsive margins */}
        <main
          className={`flex-1 transition-all duration-300 ${
            isSidebarCollapsed ? 'lg:ml-16' : 'ml-0 lg:ml-60'
          } bg-[#fef7ed] dark:bg-[#0f1221] overflow-y-auto relative`}
          style={{ minHeight: `calc(100vh - ${navbarHeight}px)` }}
          onClick={() => {
            if (!isSidebarCollapsed && window.innerWidth < 1024) {
              setIsSidebarCollapsed(true);
            }
          }}
        >
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;

