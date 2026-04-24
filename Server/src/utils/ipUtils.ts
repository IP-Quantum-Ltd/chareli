import NodeCache from 'node-cache';
import { isIP } from 'net';

// Initialize cache with 24h TTL
const ipCache = new NodeCache({ stdTTL: 86400 });

function isPrivateIP(ip: string): boolean {
  return ip === '127.0.0.1' ||
         ip === '::1' ||
         ip === 'localhost' ||
         ip.startsWith('192.168.') ||
         ip.startsWith('10.') ||
         ip.startsWith('172.16.');
}

/**
 * Extract the real client IP address from request headers
 * Handles comma-separated IPs from proxy chains.
 * Returns '' for malformed input so callers can short-circuit before making
 * upstream geolocation API calls — protects rate-limited / metered services
 * from garbage forwarded by misbehaving clients.
 */
export function extractClientIP(forwardedHeader: string | string[] | undefined, fallbackIP?: string): string {
  let ipAddress = '';

  if (Array.isArray(forwardedHeader)) {
    // If it's an array, take the first element and split by comma
    ipAddress = forwardedHeader[0].split(',')[0].trim();
  } else if (forwardedHeader) {
    // If it's a string, split by comma and take the first IP
    ipAddress = forwardedHeader.split(',')[0].trim();
  } else {
    // Fallback to other IP sources
    ipAddress = fallbackIP || '';
  }

  // net.isIP returns 0 for invalid, 4 for IPv4, 6 for IPv6. Allow loopback
  // strings like 'localhost' through so dev environments still resolve
  // correctly via the existing isPrivateIP path downstream.
  if (isPrivateIP(ipAddress)) return ipAddress;
  return isIP(ipAddress) === 0 ? '' : ipAddress;
}

/**
 * Get country name from IP address using multiple geolocation services
 * Returns cached results when available, falls back to secondary service if primary fails
 */
export async function getCountryFromIP(ipAddress: string): Promise<string | null> {
  // Defense in depth: reject empty, malformed, or non-IP-shaped input before
  // touching cache or upstream services. extractClientIP filters most callers,
  // but /signup-analytics/test-ip/:ip is unauthenticated and accepts arbitrary
  // URL params — without this check, anyone can burn our ipapi.co quota by
  // hitting that endpoint with garbage.
  if (!ipAddress) return null;
  if (!isPrivateIP(ipAddress) && isIP(ipAddress) === 0) return null;

  try {
    // Check cache first
    const cached = ipCache.get<string>(ipAddress);
    if (cached) {
      console.log('IP cache hit:', ipAddress);
      return cached;
    }

    // Handle private/local IPs
    if (isPrivateIP(ipAddress)) {
      return 'Local';
    }

    console.log('Fetching country for IP:', ipAddress);
    
    // Try primary service (ipapi.co)
    try {
      const response = await fetch(`https://ipapi.co/${ipAddress}/json/`);
      const data = await response.json() as {
        error?: string;
        country_name?: string;
      };

      if (!data.error && data.country_name) {
        ipCache.set(ipAddress, data.country_name);
        return data.country_name;
      }
    } catch (primaryError) {
      console.log('Primary service failed, trying fallback...');
    }

    // Fallback to ip-api.com (free, no rate limit for non-commercial)
    try {
      const fallbackResponse = await fetch(`http://ip-api.com/json/${ipAddress}?fields=status,country`);
      const fallbackData = await fallbackResponse.json() as {
        status?: string;
        country?: string;
      };

      if (fallbackData.status === 'success' && fallbackData.country) {
        ipCache.set(ipAddress, fallbackData.country);
        return fallbackData.country;
      }
    } catch (fallbackError) {
      console.log('Fallback service also failed');
    }

    // If both services fail, return 'Unknown' instead of null
    console.log('All IP services failed for:', ipAddress);
    const unknownCountry = 'Unknown';
    ipCache.set(ipAddress, unknownCountry);
    return unknownCountry;

  } catch (error) {
    console.error('Error getting country from IP:', error);
    return 'Unknown';
  }
}

/**
 * Clear the IP cache (useful for testing or manual cache invalidation)
 */
export function clearIPCache(): void {
  ipCache.flushAll();
}

/**
 * Get cache statistics
 */
export function getIPCacheStats() {
  return {
    keys: ipCache.keys().length,
    hits: ipCache.getStats().hits,
    misses: ipCache.getStats().misses
  };
}
