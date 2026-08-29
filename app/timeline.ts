import type { NoteTiming, ScoreNote } from "./domain";

export interface TimemapEvent {
  tstamp: number;
  on?: string[];
  off?: string[];
  restsOn?: string[];
}

export function buildPlaybackTimings(
  notes: ScoreNote[],
  events: TimemapEvent[],
  expansionIdsForElement: (id: string) => string[],
): NoteTiming[] {
  const scoreIdForPlaybackId = new Map<string, string>();
  notes.forEach((note) => {
    const playbackIds = new Set([
      note.id,
      ...expansionIdsForElement(note.id).map((id) => id.trim()).filter(Boolean),
    ]);
    playbackIds.forEach((id) => scoreIdForPlaybackId.set(id, note.id));
  });

  return events.flatMap((event) => {
    const noteId = event.on?.map((id) => scoreIdForPlaybackId.get(id)).find((id): id is string => Boolean(id));
    if (noteId) return [{ noteId, startMs: Math.max(0, event.tstamp) }];
    if (event.restsOn?.length || event.off?.length) return [{ startMs: Math.max(0, event.tstamp) }];
    return [];
  });
}

export function playbackTimeForNote(timings: NoteTiming[], noteId: string, positionMs = 0) {
  const occurrences = timings.filter((timing) => timing.noteId === noteId);
  if (!occurrences.length) return undefined;
  return occurrences.reduce((closest, candidate) => {
    const closestDistance = Math.abs(closest.startMs - positionMs);
    const candidateDistance = Math.abs(candidate.startMs - positionMs);
    if (candidateDistance < closestDistance) return candidate;
    if (candidateDistance === closestDistance && candidate.startMs > closest.startMs) return candidate;
    return closest;
  }).startMs;
}
