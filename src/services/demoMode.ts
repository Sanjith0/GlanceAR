import { useGlance } from '../state';

/**
 * The single demo-mode boundary.
 *
 * `GlanceProvider` already decides between the in-memory sample world and a
 * configured Convex backend from `EXPO_PUBLIC_CONVEX_URL`. Everything that is
 * simulated in this frontend (face enrollment, LinkedIn import, recognition
 * scenarios, seeded connections) keys off this one hook, and every simulated
 * result is labelled with `SAMPLE_LABEL` so a scan, import, message or
 * published event is never presented as something that really happened.
 */
export function useDemoMode(): boolean {
  return useGlance().mode === 'demo';
}

export const SAMPLE_LABEL = 'Sample';
