import { useSyncExternalStore } from 'react';
import type { LiveCameraLease } from './liveCameraStream';

/**
 * Camera picker for the Glance Glasses Live iPhone shell (ios-glasses-live).
 * The shell injects window.__glanceGlassesCamera; ordinary browsers never see
 * the picker. Only the conversation (finish gesture) camera can use the glasses.
 * Face registration and LIVE Camera recognition always use the iPhone camera.
 */
export type CameraDevice = 'phone' | 'glasses';

const STORAGE_KEY = 'glance.conversationCamera';
const listeners = new Set<() => void>();
let memory: CameraDevice | null = null;

type ShellWindow = { __glanceGlassesCamera?: { available?: boolean } };

export function glassesShellAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as ShellWindow).__glanceGlassesCamera?.available;
}

export function getCameraDevice(): CameraDevice {
  if (!glassesShellAvailable()) return 'phone';
  if (memory) return memory;
  try { return window.localStorage?.getItem(STORAGE_KEY) === 'glasses' ? 'glasses' : 'phone'; } catch { return 'phone'; }
}

export function setCameraDevice(device: CameraDevice): void {
  memory = device;
  try { window.localStorage?.setItem(STORAGE_KEY, device); } catch { /* private mode */ }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCameraDevice(): CameraDevice {
  return useSyncExternalStore(subscribe, getCameraDevice, () => 'phone');
}

/** Live Meta glasses video through the shell's shim (world-facing, not mirrored). */
export async function acquireGlassesStream(signal?: AbortSignal): Promise<LiveCameraLease> {
  const video = { glanceSource: 'glasses' } as MediaTrackConstraints;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  if (signal?.aborted) {
    stream.getTracks().forEach(track => track.stop());
    throw new DOMException('Camera request cancelled.', 'AbortError');
  }
  let released = false;
  return {
    stream,
    mirrored: false,
    release: () => {
      if (released) return;
      released = true;
      stream.getTracks().forEach(track => track.stop());
    },
  } as LiveCameraLease;
}
