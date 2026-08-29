import { Midi } from "@tonejs/midi";

const DIVISIONS = 8;
const DURATION_PARTS = [32, 24, 16, 12, 8, 6, 4, 3, 2, 1] as const;

interface MidiChordEvent {
  start: number;
  duration: number;
  pitches: number[];
}

interface MidiSegment extends MidiChordEvent {
  offset: number;
  tieFromPrevious: boolean;
  tieToNext: boolean;
}

export interface MidiImportResult {
  musicXml: string;
  title: string;
  tempoBpm: number;
  trackCount: number;
  voiceCount: number;
}

function escapeXml(value: string) {
  const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}

function decodeBase64(value: string) {
  const binary = atob(value.includes(",") ? value.split(",").pop()! : value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function durationParts(duration: number) {
  const parts: number[] = [];
  let remaining = Math.max(0, Math.round(duration));
  while (remaining > 0) {
    const part = DURATION_PARTS.find((candidate) => candidate <= remaining) ?? 1;
    parts.push(part);
    remaining -= part;
  }
  return parts;
}

function durationNotation(duration: number) {
  const values: Record<number, { type: string; dotted?: boolean }> = {
    32: { type: "whole" }, 24: { type: "half", dotted: true }, 16: { type: "half" },
    12: { type: "quarter", dotted: true }, 8: { type: "quarter" }, 6: { type: "eighth", dotted: true },
    4: { type: "eighth" }, 3: { type: "16th", dotted: true }, 2: { type: "16th" }, 1: { type: "32nd" },
  };
  return values[duration] ?? values[1];
}

function pitchXml(midi: number, fifths: number) {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  const preferFlats = fifths < 0;
  const steps = preferFlats
    ? ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"]
    : ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  const alters = preferFlats
    ? [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0]
    : [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const alter = alters[pitchClass];
  return `<pitch><step>${steps[pitchClass]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${Math.floor(Math.round(midi) / 12) - 1}</octave></pitch>`;
}

function tieXml(stop: boolean, start: boolean) {
  if (!stop && !start) return { direct: "", notation: "" };
  return {
    direct: `${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}`,
    notation: `<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}</notations>`,
  };
}

function restXml(duration: number, voice: number) {
  return durationParts(duration).map((part) => {
    const notation = durationNotation(part);
    return `<note><rest/><duration>${part}</duration><voice>${voice}</voice><type>${notation.type}</type>${notation.dotted ? "<dot/>" : ""}</note>`;
  }).join("");
}

function chordXml(segment: MidiSegment, voice: number, fifths: number, beams = "") {
  const parts = durationParts(segment.duration);
  return parts.map((part, partIndex) => {
    const notation = durationNotation(part);
    const tie = tieXml(segment.tieFromPrevious || partIndex > 0, segment.tieToNext || partIndex < parts.length - 1);
    return segment.pitches.map((pitch, pitchIndex) => `<note>${pitchIndex ? "<chord/>" : ""}${pitchXml(pitch, fifths)}<duration>${part}</duration>${tie.direct}<voice>${voice}</voice><type>${notation.type}</type>${notation.dotted ? "<dot/>" : ""}${partIndex === 0 ? beams : ""}${tie.notation}</note>`).join("");
  }).join("");
}

function snapPerformedDuration(duration: number) {
  const rounded = Math.max(1, Math.round(duration));
  const candidate = [...DURATION_PARTS].sort((left, right) => Math.abs(left - rounded) - Math.abs(right - rounded) || right - left)[0];
  return Math.abs(candidate - rounded) <= 1 ? candidate : rounded;
}

function quantizedTrackEvents(midi: Midi, trackIndex: number) {
  const grouped = new Map<number, { duration: number; pitches: Set<number> }>();
  midi.tracks[trackIndex].notes.forEach((note) => {
    const start = Math.max(0, Math.round(note.ticks / midi.header.ppq * DIVISIONS));
    const duration = Math.max(1, Math.round(note.durationTicks / midi.header.ppq * DIVISIONS));
    const group = grouped.get(start) ?? { duration, pitches: new Set<number>() };
    group.duration = Math.max(group.duration, duration);
    group.pitches.add(note.midi);
    grouped.set(start, group);
  });
  const events = [...grouped.entries()].map(([start, group]) => ({ start, duration: group.duration, pitches: [...group.pitches].sort((a, b) => a - b) })).sort((a, b) => a.start - b.start);
  return events.map((event, index) => {
    const nextStart = events[index + 1]?.start;
    let duration = snapPerformedDuration(event.duration);
    if (nextStart !== undefined && nextStart > event.start) {
      const available = nextStart - event.start;
      // Score editors often export MIDI with a one-tick articulation gap. It is
      // performance data, not a written 1/32 rest, so join it back to the onset.
      if (Math.abs(available - event.duration) <= 1 || Math.abs(available - duration) <= 1) duration = available;
    }
    return { ...event, duration };
  });
}

function splitIntoVoices(events: MidiChordEvent[]) {
  const voices: MidiChordEvent[][] = [];
  const voiceEnds: number[] = [];
  events.forEach((event) => {
    let voiceIndex = voiceEnds.findIndex((end) => end <= event.start);
    if (voiceIndex < 0) {
      voiceIndex = voices.length;
      voices.push([]);
      voiceEnds.push(0);
    }
    voices[voiceIndex].push(event);
    voiceEnds[voiceIndex] = event.start + event.duration;
  });
  return voices;
}

function measureSegments(events: MidiChordEvent[], measureUnits: number, measureIndex: number) {
  const segments: MidiSegment[] = [];
  events.forEach((event) => {
    let cursor = event.start;
    let remaining = event.duration;
    let first = true;
    while (remaining > 0) {
      const currentMeasure = Math.floor(cursor / measureUnits);
      const duration = Math.min(remaining, measureUnits - cursor % measureUnits);
      if (currentMeasure === measureIndex) {
        segments.push({ ...event, offset: cursor % measureUnits, duration, tieFromPrevious: !first, tieToNext: remaining > duration });
      }
      cursor += duration;
      remaining -= duration;
      first = false;
    }
  });
  return segments.sort((a, b) => a.offset - b.offset);
}

function beamTags(segments: MidiSegment[], index: number) {
  const current = segments[index];
  if (durationParts(current.duration).length !== 1 || current.duration > 4) return "";
  const tags: string[] = [];
  [4, 2, 1].forEach((maximum, level) => {
    if (current.duration > maximum) return;
    const previous = segments[index - 1];
    const next = segments[index + 1];
    const joinsPrevious = !!previous && durationParts(previous.duration).length === 1 && previous.duration <= maximum && previous.offset + previous.duration === current.offset;
    const joinsNext = !!next && durationParts(next.duration).length === 1 && next.duration <= maximum && current.offset + current.duration === next.offset;
    let value = "";
    if (joinsPrevious && joinsNext) value = "continue";
    else if (joinsNext) value = "begin";
    else if (joinsPrevious) value = "end";
    else if (level > 0) {
      const primaryPrevious = !!previous && previous.duration <= 4 && previous.offset + previous.duration === current.offset;
      const primaryNext = !!next && next.duration <= 4 && current.offset + current.duration === next.offset;
      if (primaryNext) value = "forward hook";
      else if (primaryPrevious) value = "backward hook";
    }
    if (value) tags.push(`<beam number="${level + 1}">${value}</beam>`);
  });
  return tags.join("");
}

function voiceMeasureXml(events: MidiChordEvent[], voice: number, measureIndex: number, measureUnits: number, fifths: number) {
  const segments = measureSegments(events, measureUnits, measureIndex);
  let cursor = 0;
  let xml = "";
  segments.forEach((segment, index) => {
    if (segment.offset > cursor) xml += restXml(segment.offset - cursor, voice);
    xml += chordXml(segment, voice, fifths, beamTags(segments, index));
    cursor = Math.max(cursor, segment.offset + segment.duration);
  });
  if (cursor < measureUnits) xml += restXml(measureUnits - cursor, voice);
  return xml;
}

function keyFifths(key: string | undefined, scale: string | undefined) {
  const major: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  const minor: Record<string, number> = { A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };
  return (scale?.toLowerCase() === "minor" ? minor : major)[key ?? "C"] ?? 0;
}

export function midiBytesToMusicXml(bytes: Uint8Array, fileName = "MIDI"): MidiImportResult {
  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch {
    throw new Error("Не вдалося прочитати MIDI-файл.");
  }

  const sourceTracks = midi.tracks.map((track, originalIndex) => ({ track, originalIndex })).filter(({ track }) => track.notes.length > 0);
  if (!sourceTracks.length) throw new Error("У MIDI-файлі немає нотних доріжок.");

  const [numerator = 4, denominator = 4] = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const safeNumerator = Math.max(1, Math.round(numerator));
  const safeDenominator = [1, 2, 4, 8, 16].includes(denominator) ? denominator : 4;
  const measureUnits = Math.max(1, safeNumerator * DIVISIONS * 4 / safeDenominator);
  const tempoBpm = Math.max(20, Math.min(400, Math.round(midi.header.tempos[0]?.bpm ?? 120)));
  // MIDI text events do not define a universal character encoding. The file
  // name is therefore a safer title than potentially garbled non-ASCII meta text.
  const fileTitle = fileName.replace(/\.(?:mid|midi)$/i, "").trim();
  const title = fileTitle && fileTitle !== "MIDI" ? fileTitle : midi.header.name.trim() || "MIDI";
  const fifths = keyFifths(midi.header.keySignatures[0]?.key, midi.header.keySignatures[0]?.scale);

  const parts = sourceTracks.map(({ track, originalIndex }, partIndex) => ({
    id: `P${partIndex + 1}`,
    name: track.name.trim() || track.instrument.name || `Доріжка ${partIndex + 1}`,
    voices: splitIntoVoices(quantizedTrackEvents(midi, originalIndex)),
  }));
  const maximumEnd = Math.max(...parts.flatMap((part) => part.voices.flatMap((voice) => voice.map((event) => event.start + event.duration))));
  const measureCount = Math.max(1, Math.ceil(maximumEnd / measureUnits));

  const partList = parts.map((part) => `<score-part id="${part.id}"><part-name>${escapeXml(part.name)}</part-name></score-part>`).join("");
  const body = parts.map((part) => {
    const measures = Array.from({ length: measureCount }, (_, measureIndex) => {
      const timeSymbol = safeNumerator === 4 && safeDenominator === 4 ? ' symbol="common"' : "";
      const attributes = measureIndex === 0 ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths></key><time${timeSymbol}><beats>${safeNumerator}</beats><beat-type>${safeDenominator}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><words>♩ = ${tempoBpm}</words></direction-type><sound tempo="${tempoBpm}"/></direction>` : "";
      const voices = part.voices.map((voice, voiceIndex) => `${voiceIndex ? `<backup><duration>${measureUnits}</duration></backup>` : ""}${voiceMeasureXml(voice, voiceIndex + 1, measureIndex, measureUnits, fifths)}`).join("");
      return `<measure number="${measureIndex + 1}">${attributes}${voices}</measure>`;
    }).join("");
    return `<part id="${part.id}">${measures}</part>`;
  }).join("");

  return {
    musicXml: `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work><part-list>${partList}</part-list>${body}</score-partwise>`,
    title,
    tempoBpm,
    trackCount: parts.length,
    voiceCount: parts.reduce((sum, part) => sum + part.voices.length, 0),
  };
}

export function midiBase64ToMusicXml(content: string, fileName?: string) {
  return midiBytesToMusicXml(decodeBase64(content), fileName);
}
