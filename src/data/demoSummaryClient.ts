import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { Recap } from '../domain';

/**
 * Optional local backend for real same-camera demo summaries. Separate from
 * EXPO_PUBLIC_CONVEX_URL so the demo stays in its fictional, memory-only data mode.
 */
export const demoSummaryURL = process.env.EXPO_PUBLIC_DEMO_SUMMARY_URL ?? '';

export async function summarizeDemoAudio(wav: Blob): Promise<Recap> {
  const client = new ConvexHttpClient(demoSummaryURL);
  const uploadUrl: string = await client.mutation(anyApi.demoAudio.generateUploadUrl, {});
  const upload = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  if (!upload.ok) throw new Error('The recording could not be uploaded for summarizing.');
  const { storageId } = await upload.json() as { storageId: string };
  const { recap } = await client.action(anyApi.demoSummary.summarize, { storageId }) as { recap: Recap };
  return recap;
}
