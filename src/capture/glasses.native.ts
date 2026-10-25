export type GlassesStatus = {
  available: boolean;
  reason: string;
  sdkVersion: string;
  implementation: 'standalone-native-harness';
  modelSupport: 'unverified';
  microphoneSource: 'phone';
};

export const GLASSES_SETUP_DOCUMENT = 'docs/IOS-GLASSES.md';

export async function getGlassesStatus(): Promise<GlassesStatus> {
  return {
    available: false,
    reason: 'Meta DAT is implemented in ios-glasses/, a separate native iPhone harness. It is not bridged into this Expo app. Meta Adventurer compatibility has not been verified.',
    sdkVersion: '1.0.1',
    implementation: 'standalone-native-harness',
    modelSupport: 'unverified',
    microphoneSource: 'phone',
  };
}

export async function connectGlasses(): Promise<never> {
  const status = await getGlassesStatus();
  throw new Error(status.reason);
}
