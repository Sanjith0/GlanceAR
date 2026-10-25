import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Conversation } from './domain';
import { useGlance } from './state';
import {
  createAudioLeaseTicket, deleteAudioCapture, isAudioCaptureAvailable, prepareAudioCapture,
  renewAudioLease, startAudioCapture, stopAudioCapture, subscribeAudioStopped,
} from './capture/audio';
import { uploadAudio } from './capture/upload';
import { CaptureController, initialCaptureView } from '../modules/glance-audio/src/CaptureController';

/** Focus, not mounted back-stack presence, grants a hook permission to acknowledge consent. */
export function useConversationCapture(
  conversation: Conversation | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const { client, token, mode, demo, snapshot } = useGlance();
  const [view, setView] = useState(initialCaptureView);
  const controller = useMemo(() => new CaptureController({
    audio: {
      available: isAudioCaptureAvailable, prepare: prepareAudioCapture, ticket: createAudioLeaseTicket,
      start: startAudioCapture, renew: renewAudioLease, stop: stopAudioCapture, delete: deleteAudioCapture,
    },
    upload: uploadAudio,
    onView: setView,
  }), []);
  useLayoutEffect(() => {
    controller.mount();
    return () => controller.unmount();
  }, [controller]);
  useLayoutEffect(() => {
    controller.configure({ conversation, client: enabled && mode === 'live' ? client : null, token, meId: snapshot?.me.id });
  }, [controller, conversation, client, enabled, mode, token, snapshot?.me.id]);
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    controller.setFocused(true);
    return () => controller.setFocused(false);
  }, [controller, enabled]));
  useEffect(() => {
    if (!enabled) return;
    controller.setAppActive(AppState.currentState === 'active');
    const unsubscribe = subscribeAudioStopped(event => controller.onStopped(event));
    const state = AppState.addEventListener('change', next => controller.setAppActive(next === 'active'));
    const timer = setInterval(() => { void controller.heartbeat(); }, 1_000);
    void controller.heartbeat();
    return () => { unsubscribe(); state.remove(); clearInterval(timer); };
  }, [controller, enabled]);
  const start = async () => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) { demo({ type: 'start', id: conversation.id }); return; }
    await controller.start();
  };
  const stop = async (reason?: string) => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) {
      if (conversation.consentMode === 'event' && (reason === 'gesture' || reason === 'finish_button')) {
        demo({ type: 'finish', id: conversation.id, method: reason === 'gesture' ? 'gesture' : 'button' });
      } else demo({ type: 'stop', id: conversation.id });
      return;
    }
    await controller.stop(reason);
  };
  const cancel = async () => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) { demo({ type: 'cancel', id: conversation.id }); return; }
    await controller.cancel();
  };
  return {
    ...view, available: enabled && isAudioCaptureAvailable(), start, stop, cancel,
    retryUpload: () => enabled ? controller.retryUpload() : Promise.resolve(),
    // Disabled/demo controllers have no scope and resolve immediately; an old
    // owned scope from a source/context change must still acknowledge its close.
    discardLocal: () => controller.discardLocal(),
  };
}
