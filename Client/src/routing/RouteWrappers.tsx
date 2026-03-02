import { Suspense } from 'react';
import { ProtectedRoute } from './ProtectedRoute';

export const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#0F1221] text-white">
    <span className="text-lg font-dmmono">Loading...</span>
  </div>
);

// Wrapper component to provide Suspense for lazy-loaded routes
export const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<RouteFallback />}>{children}</Suspense>
);

// Config-protected route wrapper
export const ConfigProtectedRoute = () => (
  <SuspenseWrapper>
    <ProtectedRoute requireAdmin={true} requireConfig={true} />
  </SuspenseWrapper>
);
