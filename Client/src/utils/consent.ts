/**
 * Marketing-tracker consent state, persisted in localStorage and propagated
 * to the third-party SDKs we use (Cloudflare Zaraz → GA4/Ads, Meta Pixel).
 *
 * GDPR/CPRA model: marketing trackers must default to off until the user
 * explicitly opts in. 'pending' (no choice yet) and 'declined' both block;
 * only 'accepted' permits firing. First-party `/api/analytics` writes are
 * deliberately not gated here — they're operational, not marketing.
 *
 * Note on Zaraz: calling zaraz.consent.set is necessary but not sufficient
 * — each tool in the Cloudflare Zaraz dashboard must also be assigned a
 * required consent purpose (ad_storage / analytics_storage). Until that's
 * configured dashboard-side, trackEvent's hasMarketingConsent check is the
 * load-bearing gate for our Zaraz traffic.
 */

const STORAGE_KEY = 'cookieConsent';

export type ConsentState = 'accepted' | 'declined' | 'pending';

export function getConsentState(): ConsentState {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'accepted' || v === 'declined') return v;
  } catch {
    /* localStorage may throw in private browsing — fall through to pending */
  }
  return 'pending';
}

export function hasMarketingConsent(): boolean {
  return getConsentState() === 'accepted';
}

/**
 * Record the user's choice and propagate to vendor SDKs. Safe to call before
 * Meta Pixel / Zaraz finish loading — vendor calls are no-ops when the SDK
 * is missing, and `syncConsentToVendors` re-applies state once they load.
 */
export function setConsent(state: 'accepted' | 'declined'): void {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* swallow — vendor calls below still apply for the page lifetime */
  }
  notifyVendors(state);
}

/**
 * Re-apply the stored consent state to vendor SDKs. Call after a vendor SDK
 * finishes loading (e.g. Meta Pixel loads ~2s after window.load) so the SDK
 * starts in the correct state instead of the SDK's default of "granted".
 */
export function syncConsentToVendors(): void {
  // Pending is treated as denied for vendor purposes — opt-in default.
  notifyVendors(getConsentState() === 'accepted' ? 'accepted' : 'declined');
}

function notifyVendors(state: 'accepted' | 'declined'): void {
  const granted = state === 'accepted';

  // Cloudflare Zaraz consent. Each tool in the Zaraz dashboard must be
  // configured with a required purpose for these flags to actually gate
  // firing — otherwise this is no-op state-tracking.
  const zaraz = (window as { zaraz?: { consent?: { set?: (s: Record<string, 'granted' | 'denied'>) => void } } }).zaraz;
  if (zaraz?.consent?.set) {
    try {
      zaraz.consent.set({
        ad_storage: granted ? 'granted' : 'denied',
        analytics_storage: granted ? 'granted' : 'denied',
      });
    } catch (err) {
      console.error('[consent] zaraz.consent.set failed:', err);
    }
  }

  // Meta Pixel. The SDK respects this internally — subsequent fbq('track', ...)
  // calls will be dropped if revoked. No need to gate every call site.
  const fbq = (window as { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq === 'function') {
    try {
      fbq('consent', granted ? 'grant' : 'revoke');
    } catch (err) {
      console.error('[consent] fbq consent call failed:', err);
    }
  }
}
