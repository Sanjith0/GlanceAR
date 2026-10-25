export type ConnectionFeedback = {
  id: string;
  phase: 'idle' | 'watching' | 'finishing' | 'retry' | 'confirmed' | 'complete';
};
export const CONNECTION_ACKNOWLEDGMENT_MS = 750;

/** A fulfilled stop promise is not evidence that the server saved a connection. */
export function reconcileConnectionFeedback(
  previous: ConnectionFeedback,
  input: { id: string; recording: boolean; connected: boolean; visible: boolean; cancelled?: boolean },
): ConnectionFeedback {
  const state = previous.id === input.id ? previous : { id: input.id, phase: 'idle' as const };
  if (input.cancelled) return state.phase === 'complete' ? state : { ...state, phase: 'complete' };
  if (input.connected) {
    if (state.phase === 'idle' || !input.visible) {
      return state.phase === 'complete' ? state : { ...state, phase: 'complete' };
    }
    if (state.phase === 'watching' || state.phase === 'finishing' || state.phase === 'retry') {
      return { ...state, phase: 'confirmed' };
    }
  } else {
    if (state.phase === 'confirmed') return { ...state, phase: 'complete' };
    if (input.recording && state.phase === 'idle') return { ...state, phase: 'watching' };
  }
  return state;
}

export function beginConnectionFinish(state: ConnectionFeedback): ConnectionFeedback {
  return state.phase === 'watching' || state.phase === 'retry' ? { ...state, phase: 'finishing' } : state;
}

export function settleConnectionFinish(state: ConnectionFeedback): ConnectionFeedback {
  return state.phase === 'finishing' ? { ...state, phase: 'retry' } : state;
}

export function completeConnectionAcknowledgment(state: ConnectionFeedback): ConnectionFeedback {
  return state.phase === 'confirmed' ? { ...state, phase: 'complete' } : state;
}
