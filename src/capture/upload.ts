/** Uploads an in-memory browser WAV (a blob: URL from capture/audio) to a Convex upload URL. */
export async function uploadAudio(url: string, uri: string, signal?: AbortSignal): Promise<string> {
  const wav = await (await fetch(uri, { signal })).blob();
  const response = await fetch(url, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' }, signal });
  if (!response.ok) throw new Error('Audio upload failed. Keep this screen open and retry.');
  const result = await response.json();
  if (typeof result.storageId !== 'string') throw new Error('Invalid audio upload response.');
  return result.storageId;
}
