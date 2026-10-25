/**
 * Set by the Glance Glasses Live iPhone shell (ios-glasses-live) before the app
 * loads. When present, navigator.mediaDevices.getUserMedia({ video }) returns the
 * live Meta glasses camera instead of an iPhone camera; everything else is unchanged.
 */
type GlassesBridge = { available?: boolean; label?: string };

export function glassesCameraActive(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as unknown as { __glanceGlassesCamera?: GlassesBridge }).__glanceGlassesCamera;
  return Boolean(bridge?.available);
}
