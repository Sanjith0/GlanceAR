import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Honors the system reduce-motion preference on native and the web media query. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => setReduced(query.matches);
      query.addEventListener?.('change', update);
      return () => query.removeEventListener?.('change', update);
    }
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (!cancelled) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { cancelled = true; subscription.remove(); };
  }, []);
  return reduced;
}
