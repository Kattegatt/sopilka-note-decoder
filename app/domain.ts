export type Tuning = "C" | "D" | "F" | "G";
export type TuningMode = "original-key" | "preserve-fingerings";
export type OctaveShift = -1 | 0 | 1;
export type HoleState = "open" | "closed" | "half";
export type FingeringKind = "primary" | "alternate" | "quint-overblow";
export type SourceType = "abc" | "musicxml" | "mxl" | "midi";
export type SoundPreset = "clean" | "soft" | "bright" | "custom";

export interface SoundSettings {
  preset: SoundPreset;
  breath: number;
  brightness: number;
  vibrato: number;
}

export interface FingeringPattern {
  id: string;
  pitchOffsetFromBase: number;
  holes: Record<string, HoleState>;
  kind: FingeringKind;
  isDefault: boolean;
  sourceRef: string;
}

export interface InstrumentProfile {
  schemaVersion: 1;
  id: "melnytsia-podilska-soprano";
  name: string;
  validationStatus: "needs-review" | "validated";
  holeLayout: Array<{ id: string; label: string; x: number; y: number }>;
  soundsOctaveAbove: true;
  supportedTunings: Tuning[];
  fingerings: FingeringPattern[];
}

export interface Project {
  schemaVersion: 1;
  id: string;
  title: string;
  source: { type: SourceType; content: string; fileName?: string; tempoBpm?: number; trackCount?: number; voiceCount?: number };
  normalizedMei: string;
  selectedPart: string;
  selectedVoice: string;
  tuning: Tuning;
  tuningMode: TuningMode;
  octaveShift: OctaveShift;
  tempoPercent: number;
  sound: SoundSettings;
  fingeringOverrides: Record<string, string>;
  chordResolutions: Record<string, string>;
  display: { showNoteNames: boolean; showFingerings: boolean };
  updatedAt: string;
}

export interface VoiceChoice {
  id: string;
  staffN: string;
  layerN: string;
  label: string;
}

export interface ScoreNote {
  id: string;
  writtenMidi: number;
  pname: string;
  octave: number;
  accidental: number;
  measure: number;
  chordId?: string;
}

export interface ScoreChord {
  id: string;
  measure: number;
  notes: ScoreNote[];
}

export interface NoteTiming {
  noteId?: string;
  startMs: number;
}

export interface RenderedScore {
  pages: string[];
  notes: ScoreNote[];
  chords: ScoreChord[];
  midiBase64: string;
  timings: NoteTiming[];
  mei: string;
}

export const TUNING_SEMITONES: Record<Tuning, number> = { C: 0, D: 2, F: 5, G: 7 };
export const TUNING_INTERVALS: Record<Tuning, string> = { C: "", D: "+M2", F: "+P4", G: "+P5" };

const SCORE_TRANSPOSITIONS: Record<OctaveShift, Record<Tuning, string>> = {
  [-1]: { C: "-P8", D: "-m7", F: "-P5", G: "-P4" },
  0: TUNING_INTERVALS,
  1: { C: "+P8", D: "+M9", F: "+P11", G: "+P12" },
};

export function scoreTransposition(
  tuning: Tuning,
  tuningMode: TuningMode,
  octaveShift: OctaveShift,
) {
  const effectiveTuning = tuningMode === "preserve-fingerings" ? tuning : "C";
  return SCORE_TRANSPOSITIONS[octaveShift][effectiveTuning];
}

const NOTE_NAMES: Record<string, string> = {
  c: "До", d: "Ре", e: "Мі", f: "Фа", g: "Соль", a: "Ля", b: "Сі",
};

const ALTER_SYMBOLS: Record<number, string> = { [-2]: "♭♭", [-1]: "♭", 0: "", 1: "♯", 2: "♯♯" };

export function ukrainianNoteName(note: Pick<ScoreNote, "pname" | "accidental">) {
  return `${NOTE_NAMES[note.pname.toLowerCase()] ?? note.pname.toUpperCase()}${ALTER_SYMBOLS[note.accidental] ?? ""}`;
}

export function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

export function safeProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Project>;
  return candidate.schemaVersion === 1 && typeof candidate.id === "string" &&
    typeof candidate.title === "string" && !!candidate.source &&
    ["abc", "musicxml", "mxl", "midi"].includes(candidate.source.type ?? "");
}
