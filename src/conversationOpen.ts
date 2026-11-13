/**
 * Who opens a conversation's screen. Several places notice a new conversation at the
 * same moment (the event page, LIVE Camera, and the app-wide watcher that pulls a
 * person in from any other screen). Each claims the conversation first, and only the
 * first claim navigates, so the screen is never opened twice. A claim lasts for the
 * session: someone who leaves a conversation is not dragged back into it.
 */
const opened = new Set<string>();

/** True for the first caller per conversation; that caller should navigate. */
export function claimConversationOpen(conversationId: string): boolean {
  if (opened.has(conversationId)) return false;
  opened.add(conversationId);
  return true;
}
/** Records that this conversation's screen is (being) shown, without asking to navigate. */
export const markConversationOpened = (conversationId: string): void => { opened.add(conversationId); };
export const conversationOpened = (conversationId: string): boolean => opened.has(conversationId);
/** Tests only. */
export const resetConversationOpens = (): void => { opened.clear(); };

/**
 * Where the app-wide watcher should send someone, or null to leave them where they are.
 * LIVE Camera for the same event is left alone: it opens the conversation itself so the
 * camera carries over without restarting.
 */
export function conversationToOpen(
  active: { id: string; eventId: string } | undefined, pathname: string,
): string | null {
  if (!active) return null;
  if (pathname === `/conversation/${active.id}`) { markConversationOpened(active.id); return null; }
  if (pathname === `/live/${active.eventId}`) return null;
  return claimConversationOpen(active.id) ? `/conversation/${active.id}` : null;
}
