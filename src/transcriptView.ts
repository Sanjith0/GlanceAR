import type { Profile, SpeakerTurn } from './domain';

/** One line of a transcript as the chat shows it. */
export type TranscriptLine = { key: string; name: string; text: string; startMs: number; tone: 0 | 1 };

/** Said wherever names stand in for speaker numbers: they are matched from the audio, not verified. */
export const NAME_ESTIMATE_NOTE = 'Names are matched to voices by loudness and can be the wrong way round.';

/**
 * Transcript turns with the name to show for each: the participant the voice was matched
 * to, otherwise the anonymous label ("Speaker 1"), otherwise nothing (an unsplit recording).
 * `named` is true when at least one line carries a participant's name.
 */
export function transcriptLines(turns: SpeakerTurn[] | undefined, participants: Pick<Profile, 'id' | 'name'>[]): { lines: TranscriptLine[]; named: boolean } {
  let named = false;
  const lines = (turns ?? []).map((turn, index): TranscriptLine => {
    const person = turn.speakerId ? participants.findIndex(candidate => candidate.id === turn.speakerId) : -1;
    if (person >= 0) named = true;
    const tone = person >= 0 ? person % 2 : (Number(turn.speaker.replace(/\D/g, '')) || 1) % 2;
    return { key: `${index}-${turn.startMs}`, name: person >= 0 ? participants[person]!.name : turn.speaker, text: turn.text, startMs: turn.startMs, tone: tone as 0 | 1 };
  });
  return { lines, named };
}
