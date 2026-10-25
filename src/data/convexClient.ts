import { ConvexReactClient } from "convex/react";
import { anyApi, type FunctionReference } from "convex/server";
import type { GlanceDataClient, Snapshot, PresenceTicket, RecordingLease } from "../domain";

/** Callers own SecureStore and local microphone/files. Never include token in logs. */
export function createGlanceClient(url: string): GlanceDataClient {
  const client = new ConvexReactClient(url, { unsavedChangesWarning: false });
  const mutate = <T>(name: string, args: Record<string, unknown>): Promise<T> =>
    client.mutation(anyApi.glance[name] as FunctionReference<"mutation">, args);
  const session = (name: string, token: string, conversationId: string) =>
    mutate<void>(name, { token, conversationId });
  const queryArgs = (token: string, eventId?: string) => ({ token, ...(eventId ? { eventId } : {}) });
  return {
    register: (token, profile) => mutate("register", { token, ...profile }),
    updateProfile: (token, profile) => mutate("updateProfile", { token, ...profile }),
    snapshot: (token, eventId) => client.query(anyApi.glance.snapshot, queryArgs(token, eventId)),
    subscribe: (token, eventId, onValue, onError) => {
      const watch = client.watchQuery(anyApi.glance.snapshot, queryArgs(token, eventId));
      const notify = () => {
        try {
          const value: Snapshot | undefined = watch.localQueryResult();
          if (value) onValue(value);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error("Subscription failed."));
        }
      };
      const unsubscribe = watch.onUpdate(notify);
      notify();
      return unsubscribe;
    },
    createEvent: (token, title, location) => mutate("createEvent", { token, title, location }),
    joinEvent: (token, inviteCode) => mutate("joinEvent", { token, inviteCode }),
    createConversation: (token, eventId, partnerId) => mutate("createConversation", { token, eventId, partnerId }),
    consentRecording: (token, id) => session("consentRecording", token, id),
    startRecording: (token, conversationId) => mutate("startRecording", { token, conversationId }),
    heartbeat: async (token, conversationId, stillConsenting = () => true) => {
      if (!stillConsenting()) return null;
      const ticket = await mutate<PresenceTicket | null>("presenceTicket", { token, conversationId });
      if (!ticket || !stillConsenting()) return null;
      const lease = await mutate<RecordingLease | null>("heartbeat", { token, conversationId, ticketId: ticket.ticketId });
      return stillConsenting() ? lease : null;
    },
    stop: (token, id) => session("stop", token, id),
    confirmExchange: (token, id) => session("confirmExchange", token, id),
    createUploadUrl: (token, conversationId) => mutate("createUploadUrl", { token, conversationId }),
    attachAudio: (token, conversationId, storageId, mimeType) => mutate("attachAudio", { token, conversationId, storageId, mimeType }),
    retryProcessing: (token, id) => session("retryProcessing", token, id),
    cancel: (token, id) => session("cancel", token, id),
    deleteConversation: (token, id) => session("deleteConversation", token, id),
    close: () => client.close(),
  };
}
