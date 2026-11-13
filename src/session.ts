/**
 * The web device credential. With a backend it is kept in this browser's local
 * storage, so reopening the app or reloading the page returns to the same profile
 * and the same face scan instead of starting over. Without a backend (the sample
 * walkthrough) it stays in memory and nothing is written to browser storage.
 * Clearing site data signs this browser out of that profile.
 */
const KEY = 'glance.device-token.v1';
const persist = Boolean(process.env.EXPO_PUBLIC_CONVEX_URL);
let token: string | undefined;

function stored(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    return value && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  } catch { return undefined; } // private mode or blocked storage: fall back to memory
}

export async function getDeviceToken(): Promise<string> {
  if (token) return token;
  token = persist ? stored() : undefined;
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    if (persist) { try { globalThis.localStorage?.setItem(KEY, token); } catch { /* memory only this time */ } }
  }
  return token;
}
