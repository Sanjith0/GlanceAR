import { ConvexReactClient } from "convex/react";
import { anyApi, type FunctionReference } from "convex/server";
import type { FaceDirectory, GlanceDataClient, Snapshot, PresenceTicket, RecordingLease } from "../domain";

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
    setEventPermission: (token, eventId, enabled) => mutate("setEventPermission", { token, eventId, enabled }),
    createConversation: (token, eventId, partnerId, mode, source) =>
      mutate("createConversation", { token, eventId, partnerId, ...(mode ? { mode } : {}), ...(source ? { source } : {}) }),
    consentRecording: (token, id) => session("consentRecording", token, id),
    startRecording: (token, conversationId) => mutate("startRecording", { token, conversationId }),
    heartbeat: async (token, conversationId, stillConsenting = () => true) => {
      if (!stillConsenting()) return null;
      const ticket = await mutate<PresenceTicket | null>("presenceTicket", { token, conversationId });
      if (!ticket || !stillConsenting()) return null;
      const lease = await mutate<RecordingLease | null>("heartbeat", { token, conversationId, ticketId: ticket.ticketId });
      return stillConsenting() ? lease : null;
    },
    stop: (token, conversationId) => mutate("stop", { token, conversationId }),
    finishConnection: (token, conversationId, method) => mutate("finishConnection", { token, conversationId, method }),
    signalHand: (token, conversationId) => mutate("signalHand", { token, conversationId }),
    abandonAudio: (token, id) => session("abandonAudio", token, id),
    sendMessage: (token, conversationId, text) => mutate("sendMessage", { token, conversationId, text }),
    confirmExchange: (token, id) => session("confirmExchange", token, id),
    createUploadUrl: (token, conversationId) => mutate("createUploadUrl", { token, conversationId }),
    attachAudio: (token, conversationId, storageId, mimeType) => mutate("attachAudio", { token, conversationId, storageId, mimeType }),
    retryProcessing: (token, id) => session("retryProcessing", token, id),
    cancel: (token, id) => session("cancel", token, id),
    deleteConversation: (token, id) => session("deleteConversation", token, id),
    saveFaceScan: (token, scan) => mutate("saveFaceScan", { token, ...scan }),
    deleteFaceScan: (token) => mutate("deleteFaceScan", { token }),
    subscribeFaceDirectory: (token, eventId, onValue, onError) => {
      const watch = client.watchQuery(anyApi.glance.faceDirectory, { token, eventId });
      const notify = () => {
        try {
          const value: FaceDirectory | undefined = watch.localQueryResult();
          if (value) onValue(value);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error("Face directory sync failed."));
        }
      };
      const unsubscribe = watch.onUpdate(notify);
      notify();
      return unsubscribe;
    },
    reportSighting: (token, eventId, seenId, source) =>
      mutate("reportSighting", { token, eventId, seenId, ...(source ? { source } : {}) }),
    close: () => client.close(),
  };
}
