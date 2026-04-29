import './App.css';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './routing/routes';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from 'sonner';
import { cdnFetch } from './utils/cdnFetch';
import { BackendRoute } from './backend/constants';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

const App: React.FC = () => {
  // When the server bumps the CDN version (publish / unpublish / upload /
  // delete), invalidate the react-query caches whose data is sourced from
  // the CDN. Without this, long-lived tabs would hold on to stale games /
  // categories until the user manually refreshes.
  useEffect(() => {
    return cdnFetch.onVersionChange(() => {
      queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <div className="font-dmmono">
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{
                duration: 10000,
                style: {
                  background: 'white',
                  color: '#6A7282',
                  fontSize: '17px',
                },
              }}
            />
            <RouterProvider router={router} />
          </div>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
