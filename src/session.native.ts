import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'glance.device-token.v1';
export async function getDeviceToken(): Promise<string> {
  const saved = await SecureStore.getItemAsync(KEY);
  if (saved) return saved;
  const token = Array.from(await Crypto.getRandomBytesAsync(32), (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return token;
}
