import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';

export async function uploadAudio(url: string, uri: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { method: 'POST', body: new File(uri), headers: { 'Content-Type': 'audio/wav' }, signal });
  if (!response.ok) throw new Error('Audio upload failed. Keep this screen open and retry.');
  const result = await response.json();
  if (typeof result.storageId !== 'string') throw new Error('Invalid audio upload response.');
  return result.storageId;
}
