/* eslint-disable */
import { hasMarketingConsent, syncConsentToVendors } from './utils/consent';

export const initAnalytics = () => {
  // Only enable analytics on production domains
  const ANALYTICS_ENABLED_DOMAINS = [
    "www.arcadesbox.com",
    "arcadesbox.com",
  ];

  const hostname = window.location.hostname;
  const shouldLoadAnalytics = ANALYTICS_ENABLED_DOMAINS.includes(hostname);

  // Log for debugging in non-production environments
  if (!shouldLoadAnalytics) {
    console.log("[Analytics] Tracking disabled on:", hostname);
  }

  // Make this available globally for the AnalyticsTracker component
  window.shouldLoadAnalytics = shouldLoadAnalytics;

  // Defer Facebook Pixel loading until after page is interactive
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (shouldLoadAnalytics) {
        // Facebook Pixel
        // @ts-expect-error Facebook Pixel snippet
        !(function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
          if (f.fbq) return;
          n = f.fbq = function () {
            n.callMethod
              ? n.callMethod.apply(n, arguments)
              : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = !0;
          n.version = "2.0";
          n.queue = [];
          t = b.createElement(e);
          t.async = !0;
          t.src = v;
          s = b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t, s);
        })(
          window,
          document,
          "script",
          "https://connect.facebook.net/en_US/fbevents.js"
        );
        // @ts-expect-error Facebook Pixel global
        fbq("init", "1940362026887774");

        // Apply current consent state immediately. SDK defaults to "granted",
        // so without this every page would track once before the user even
        // sees the banner.
        syncConsentToVendors();

        // Initial PageView only fires for users who already accepted on a
        // previous visit. New users get a PageView once they click Accept
        // (handled by setConsent → syncConsentToVendors).
        if (hasMarketingConsent()) {
          // @ts-expect-error Facebook Pixel global
          fbq("track", "PageView");
        }

        console.log("[Analytics] Facebook Pixel enabled");
      }
    }, 2000); // 2 second delay
  });
};
