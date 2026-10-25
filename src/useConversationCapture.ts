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
import { BrowserRecorder } from './capture/browserAudio';
import { CaptureController, initialCaptureView } from '../modules/glance-audio/src/CaptureController';

/** Focus, not mounted back-stack presence, grants a hook permission to acknowledge consent. */
export function useConversationCapture(
  conversation: Conversation | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const { client, token, mode, demo, snapshot, demoSummaries, summarizeDemo } = useGlance();
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
  // Same-camera demo: a real browser recording for the summary, from conversation
  // start until finish. Leaving, stopping or cancelling discards it unheard.
  const recorder = useMemo(() => new BrowserRecorder(), []);
  const [demoFocused, setDemoFocused] = useState(false);
  const [demoAudio, setDemoAudio] = useState<{ id: string; error?: string } | null>(null);
  useFocusEffect(useCallback(() => {
    setDemoFocused(true);
    return () => setDemoFocused(false);
  }, []));
  const recordId = enabled && mode === 'demo' && demoSummaries && demoFocused && conversation?.consentMode === 'event'
    && conversation.status === 'recording' ? conversation.id : null;
  useEffect(() => {
    if (!recordId) return;
    let current = true;
    recorder.start(recordId).then(() => { if (current) setDemoAudio({ id: recordId }); }, (error: unknown) => {
      if (!current) return;
      setDemoAudio({ id: recordId, error: error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone permission is off, so this conversation will use the sample recap.'
        : 'The microphone could not start, so this conversation will use the sample recap.' });
    });
    return () => { current = false; recorder.discard(recordId); };
  }, [recordId, recorder]);
  const demoAudioFor = demoAudio && demoAudio.id === conversation?.id ? demoAudio : null;
  const start = async () => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) { demo({ type: 'start', id: conversation.id }); return; }
    await controller.start();
  };
  const stop = async (reason?: string) => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) {
      if (conversation.consentMode === 'event' && (reason === 'gesture' || reason === 'finish_button')) {
        // Close the microphone before connecting, as the native recorder does.
        const wav = await recorder.stop(conversation.id);
        demo({ type: 'finish', id: conversation.id, method: reason === 'gesture' ? 'gesture' : 'button', awaitingSummary: Boolean(wav) });
        if (wav) void summarizeDemo(conversation.id, wav);
      } else {
        recorder.discard(conversation.id);
        demo({ type: 'stop', id: conversation.id });
      }
      return;
    }
    await controller.stop(reason);
  };
  const cancel = async () => {
    if (!enabled) return;
    if (mode === 'demo' && conversation) {
      recorder.discard(conversation.id);
      demo({ type: 'cancel', id: conversation.id });
      return;
    }
    await controller.cancel();
  };
  return {
    ...view, available: enabled && isAudioCaptureAvailable(), start, stop, cancel,
    /** Demo only: the browser microphone is recording this conversation for its summary. */
    demoRecording: Boolean(demoAudioFor && !demoAudioFor.error && recordId),
    demoAudioError: recordId ? demoAudioFor?.error : undefined,
    retryUpload: () => enabled ? controller.retryUpload() : Promise.resolve(),
    // Disabled/demo controllers have no scope and resolve immediately; an old
    // owned scope from a source/context change must still acknowledge its close.
    discardLocal: () => controller.discardLocal(),
  };
}
