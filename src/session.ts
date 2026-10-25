// Web preview never stores authentication in cookies or browser storage.
let token: string | undefined;
export async function getDeviceToken(): Promise<string> {
  token ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  return token;
}
