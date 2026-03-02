import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import CanonicalTag from '../components/single/CanonicalTag';
import { getOrCreateSessionId, clearSessionId } from '../utils/sessionUtils';
import { useAuth } from '../context/AuthContext';

// Analytics tracking component for Cloudflare Zaraz and Facebook Pixel
const AnalyticsTracker = () => {
  const location = useLocation();
  const { user } = useAuth();

  // 1. Auth/session lifecycle
  // Clear session ID when user logs in
  useEffect(() => {
    if (user) {
      clearSessionId();
    }
  }, [user]);

  // 2. Backend analytics
  // Track page visits with current auth state
  // Runs on location change so it picks up token after login
  useEffect(() => {
    const trackPageVisit = async () => {
      try {
        const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

        // Only send session ID if user is not authenticated
        const sessionId = user ? null : getOrCreateSessionId();

        const url = `${baseURL}/api/analytics/homepage-visit`;

        const token = localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Always use fetch with keepalive for reliability and auth support
        // keepalive ensures the request completes even during page unload (like sendBeacon)
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessionId }),
          keepalive: true,  // Ensures request completes even during page unload
          credentials: 'include',  // Send cookies if needed
        }).catch((error) => {
          // Only log errors in development to avoid console spam
          const isDevelopment = baseURL.includes('localhost') || baseURL.includes('127.0.0.1');
          if (isDevelopment) {
            console.warn('Failed to track page visit:', error);
          }
        });
      } catch (error) {
        console.warn('Failed to track page visit:', error);
      }
    };

    trackPageVisit();
  }, [location,user]);  // Re-run when location changes (includes after login redirect)

  // 3. Client-side analytics + SEO
  useEffect(() => {
    // Only track if analytics is enabled for this domain
    if (!(window as any).shouldLoadAnalytics) {
      return;
    }

    // Note: GA4 automatically tracks page_view events via Zaraz
    // No need to manually track pageviews - removed to prevent duplication

    // Track pageview on route change for Facebook Pixel
    if (typeof (window as any).fbq !== 'undefined') {
      (window as any).fbq('track', 'PageView');
    }

    const officialDomain = import.meta.env.VITE_OFFICIAL_DOMAIN;

    if (officialDomain) {
      // Construct the authoritative URL
      // We remove trailing slashes to be consistent
      const path = location.pathname === '/' ? '' : location.pathname;
      const canonicalUrl = `https://${officialDomain}${path}`;

      // Find existing tag or create new one
      let link = document.querySelector("link[rel='canonical']");

      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }

      // Update the href
      link.setAttribute('href', canonicalUrl);
    }
  }, [location]);

  return null;
};

/**
 * RootLayout - A wrapper layout that provides analytics tracking and canonical tags
 * for all routes. This is used as the root element in createBrowserRouter.
 */
const RootLayout = () => {
  return (
    <>
      <AnalyticsTracker />
      <CanonicalTag />
      <Outlet />
    </>
  );
};

export default RootLayout;
