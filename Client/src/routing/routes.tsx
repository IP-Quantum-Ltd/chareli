import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { SuspenseWrapper, ConfigProtectedRoute } from './RouteWrappers';
import { ProtectedRoute } from './ProtectedRoute';

const RootLayout = lazy(() => import('../layout/RootLayout'));
const ErrorPage = lazy(() => import('../pages/ErrorPage'));
const Home = lazy(() => import('../pages/Home/Home'));
const About = lazy(() => import('../pages/About/About'));
const RegisterInvitationPage = lazy(() =>
  import('../pages/RegisterInvitation').then((module) => ({
    default: module.RegisterInvitationPage,
  }))
);
const MainLayout = lazy(() => import('../layout/MainLayout'));
const GamePlay = lazy(() => import('../pages/GamePlay/GamePlay'));
const Categories = lazy(() => import('../pages/Categories/Categories'));
const ResetPasswordPage = lazy(() =>
  import('../pages/ResetPassword/ResetPasswordPage').then((module) => ({
    default: module.ResetPasswordPage,
  }))
);
const AdminLayout = lazy(() => import('../layout/AdminLayout'));
const AdminHome = lazy(() => import('../pages/Admin/Home/Home'));
const GameManagement = lazy(
  () => import('../pages/Admin/Management/GameManagement')
);
const UserManagement = lazy(
  () => import('../pages/Admin/UserManagement/UserManagement')
);
const Analytics = lazy(() => import('../pages/Admin/Analytics/Analytics'));
const Configuration = lazy(
  () => import('../pages/Admin/Configuration/Configuration')
);
const ViewGame = lazy(() => import('../pages/Admin/ViewGame'));
const CreateGame = lazy(() => import('../pages/Admin/CreateGame'));
const EditGame = lazy(() => import('../pages/Admin/EditGame'));
const GameCategories = lazy(
  () => import('../pages/Admin/Category/GameCategories')
);
const CategoryDetail = lazy(
  () => import('../pages/Admin/Category/CategoryDetail')
);
const UserManagementView = lazy(() => import('../pages/Admin/UserMgtView'));
const MyProposals = lazy(() => import('../pages/Admin/Proposals/MyProposals'));
const AdminProposals = lazy(() => import('../pages/Admin/Proposals/AdminProposals'));
const ProposalReview = lazy(() => import('../pages/Admin/Proposals/ProposalReview'));
const TeamManagement = lazy(() => import('../pages/Admin/Team/TeamManagement'));
const Settings = lazy(() => import('../pages/Admin/Settings'));
const ViewProfile = lazy(() => import('../pages/Admin/ViewProfile'));
const Terms = lazy(() => import('../pages/TermsOfService/Terms'));
const Privacy = lazy(() => import('../pages/PrivacyPolicy/Privacy'));
const CacheDashboard = lazy(
  () => import('../pages/Admin/Cache/CacheDashboard')
);
const ImageReprocessing = lazy(
  () => import('../pages/Admin/ImageReprocessing/ImageReprocessing')
);


// Route configuration using object format for createBrowserRouter
export const routes = [
  {
    // Root layout wrapper for analytics tracking and canonical tags
    element: <SuspenseWrapper><RootLayout /></SuspenseWrapper>,
    errorElement: <SuspenseWrapper><ErrorPage /></SuspenseWrapper>,
    children: [
      // Public routes with MainLayout
      {
        path: '/',
        element: <SuspenseWrapper><MainLayout /></SuspenseWrapper>,
        children: [
          { index: true, element: <SuspenseWrapper><Home /></SuspenseWrapper> },
          { path: 'about', element: <SuspenseWrapper><About /></SuspenseWrapper> },
          { path: 'categories', element: <SuspenseWrapper><Categories /></SuspenseWrapper> },
          { path: 'gameplay/:gameId', element: <SuspenseWrapper><GamePlay /></SuspenseWrapper> },
          { path: 'terms', element: <SuspenseWrapper><Terms /></SuspenseWrapper> },
          { path: 'privacy', element: <SuspenseWrapper><Privacy /></SuspenseWrapper> },
        ],
      },

      // Reset password routes
      {
        path: 'reset-password/:token',
        element: <SuspenseWrapper><ResetPasswordPage /></SuspenseWrapper>,
      },
      {
        path: 'reset-password/phone/:userId',
        element: <SuspenseWrapper><ResetPasswordPage /></SuspenseWrapper>,
      },

      // Register invitation
      {
        path: 'register-invitation/:token',
        element: <SuspenseWrapper><RegisterInvitationPage /></SuspenseWrapper>,
      },

      // Admin routes (general - for all admin users including viewers)
      {
        path: 'admin',
        element: <SuspenseWrapper><ProtectedRoute requireAdmin={true} /></SuspenseWrapper>,
        children: [
          {
            element: <SuspenseWrapper><AdminLayout /></SuspenseWrapper>,
            children: [
              { index: true, element: <SuspenseWrapper><AdminHome /></SuspenseWrapper> },
              { path: 'game-management', element: <SuspenseWrapper><GameManagement /></SuspenseWrapper> },
              { path: 'categories', element: <SuspenseWrapper><GameCategories /></SuspenseWrapper> },
              { path: 'categories/:categoryId', element: <SuspenseWrapper><CategoryDetail /></SuspenseWrapper> },
              { path: 'management', element: <SuspenseWrapper><UserManagement /></SuspenseWrapper> },
              { path: 'management/:userId', element: <SuspenseWrapper><UserManagementView /></SuspenseWrapper> },
              { path: 'team', element: <SuspenseWrapper><TeamManagement /></SuspenseWrapper> },
              { path: 'my-proposals', element: <SuspenseWrapper><MyProposals /></SuspenseWrapper> },
              { path: 'proposals', element: <SuspenseWrapper><AdminProposals /></SuspenseWrapper> },
              { path: 'proposals/:id/review', element: <SuspenseWrapper><ProposalReview /></SuspenseWrapper> },
              { path: 'analytics', element: <SuspenseWrapper><Analytics /></SuspenseWrapper> },
              { path: 'view-game/:gameId', element: <SuspenseWrapper><ViewGame /></SuspenseWrapper> },
              { path: 'create-game', element: <SuspenseWrapper><CreateGame /></SuspenseWrapper> },
              { path: 'edit-game/:gameId', element: <SuspenseWrapper><EditGame /></SuspenseWrapper> },
              { path: 'edit-proposal/:proposalId', element: <SuspenseWrapper><EditGame /></SuspenseWrapper> },
              { path: 'view-profile', element: <SuspenseWrapper><ViewProfile /></SuspenseWrapper> },
              { path: 'cache', element: <SuspenseWrapper><CacheDashboard /></SuspenseWrapper> },
              { path: 'image-reprocessing', element: <SuspenseWrapper><ImageReprocessing /></SuspenseWrapper> },
              // Config routes - require config access (excludes viewers)
              // Nested ProtectedRoute to check config permission
              {
                element: <ConfigProtectedRoute />,
                children: [
                  { path: 'config', element: <SuspenseWrapper><Configuration /></SuspenseWrapper> },
                  { path: 'settings', element: <SuspenseWrapper><Settings /></SuspenseWrapper> },
                ],
              },
            ],
          },
        ],
      },

      // Catch-all 404
      {
        path: '*',
        element: <SuspenseWrapper><ErrorPage /></SuspenseWrapper>,
      },
    ],
  },
];

// Create the browser router
export const router = createBrowserRouter(routes);

export default router;
