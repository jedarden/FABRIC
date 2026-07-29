/**
 * Hostname resolution utility
 *
 * Provides a mockable function for getting the local hostname.
 * This is separated into its own module to allow easy mocking in tests
 * without running into ESM module namespace limitations.
 */

import * as os from 'os';

/**
 * Get the local hostname with environment variable fallback.
 *
 * Priority order:
 * 1. HOSTNAME environment variable (container/pod context)
 * 2. HOST environment variable
 * 3. System hostname via os.hostname()
 */
export function getLocalHostname(): string {
  // Prefer environment variables if set (container/pod context)
  if (typeof process !== 'undefined' && process.env.HOSTNAME) {
    return process.env.HOSTNAME;
  }
  if (typeof process !== 'undefined' && process.env.HOST) {
    return process.env.HOST;
  }
  // Use system hostname as default for multi-host observability
  return os.hostname();
}
