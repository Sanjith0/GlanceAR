import { requireOptionalNativeModule } from 'expo-modules-core';

export type CaptureCapabilities = {
  phoneCamera: boolean;
  glassesCamera: boolean;
  detector: string;
  reason: string;
};

export type GlanceCaptureModule = {
  getCapabilities(): CaptureCapabilities;
  requestCameraPermission(): Promise<boolean>;
  copyPrivateSetupJSON(value: string): Promise<boolean>;
};

// Optional lookup is deliberate: Expo Go must not crash or pretend to capture.
export default requireOptionalNativeModule<GlanceCaptureModule>('GlanceCapture');
