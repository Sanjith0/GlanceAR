import { useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { useGlance } from './state';
import { conversationToOpen } from './conversationOpen';

/**
 * Pulls a person into a conversation that just started with them, whatever screen they
 * are on. Without it, only the person who started the conversation entered it unless
 * the other happened to be on LIVE Camera or the event page.
 */
export function ConversationAutoOpen() {
  const app = useGlance();
  const pathname = usePathname();
  const active = app.mode === 'live' ? app.snapshot?.conversations.find(c =>
    c.consentMode === 'event' && (c.status === 'consent' || c.status === 'recording')) : undefined;
  const id = active?.id, eventId = active?.eventId;
  useEffect(() => {
    const destination = conversationToOpen(id && eventId ? { id, eventId } : undefined, pathname);
    if (destination) router.push(destination);
  }, [id, eventId, pathname]);
  return null;
}
