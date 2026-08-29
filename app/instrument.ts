import type { FingeringKind, FingeringPattern, HoleState, InstrumentProfile, ScoreNote, Tuning } from "./domain";
import { TUNING_SEMITONES } from "./domain";

export const HOLE_IDS = ["back-left", "back-right", "front-1", "front-2", "front-3", "front-4", "front-5", "front-6", "front-7", "front-8"] as const;
export const FINGERING_SOURCE_URL = "https://uk.sopilka-acropolis.com/fingering/fingerings-for-soprano-in-c/";

type HoleValue = 0 | 1;

interface SourcePattern {
  values: readonly HoleValue[];
  kind?: FingeringKind;
  suffix?: string;
}

interface SourceNote {
  note: string;
  midi: number;
  diagramId: number;
  patterns: readonly SourcePattern[];
}

// Explicit note mapping digitized from the Sopilka Acropolis diagrams.
// Hole order: rear upper, rear lower, then front holes 1–8 from top to bottom.
// 1 = closed, 0 = open. The first (white) diagram is the default; gold diagrams
// are alternatives, and gold diagrams marked “5” use quint overblowing.
const DIGITIZED_FINGERINGS: readonly SourceNote[] = [
  { note: "До1", midi: 60, diagramId: 1, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }] },
  { note: "До♯1", midi: 61, diagramId: 2, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0] }] },
  { note: "Ре1", midi: 62, diagramId: 3, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0] }] },
  { note: "Ре♯1", midi: 63, diagramId: 4, patterns: [{ values: [1, 0, 1, 1, 1, 1, 1, 1, 0, 0] }] },
  { note: "Мі1", midi: 64, diagramId: 5, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0] }] },
  { note: "Фа1", midi: 65, diagramId: 6, patterns: [{ values: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0] }] },
  { note: "Фа♯1", midi: 66, diagramId: 7, patterns: [{ values: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] }] },
  { note: "Соль1", midi: 67, diagramId: 8, patterns: [{ values: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0] }] },
  { note: "Соль♯1", midi: 68, diagramId: 9, patterns: [{ values: [1, 1, 1, 0, 1, 1, 1, 1, 1, 1] }] },
  { note: "Ля1", midi: 69, diagramId: 10, patterns: [{ values: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0] }] },
  { note: "Сі♭1", midi: 70, diagramId: 11, patterns: [{ values: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0] }] },
  { note: "Сі1", midi: 71, diagramId: 12, patterns: [{ values: [1, 1, 0, 0, 0, 0, 0, 0, 0, 1] }] },
  { note: "До2", midi: 72, diagramId: 13, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }] },
  { note: "До♯2", midi: 73, diagramId: 14, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0] }] },
  { note: "Ре2", midi: 74, diagramId: 15, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0] }] },
  { note: "Ре♯2", midi: 75, diagramId: 16, patterns: [{ values: [1, 0, 1, 1, 1, 1, 1, 1, 0, 0] }] },
  { note: "Мі2", midi: 76, diagramId: 17, patterns: [{ values: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0] }] },
  { note: "Фа2", midi: 77, diagramId: 18, patterns: [{ values: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0] }] },
  { note: "Фа♯2", midi: 78, diagramId: 19, patterns: [{ values: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] }] },
  {
    note: "Соль2", midi: 79, diagramId: 20, patterns: [
      { values: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0] },
      { values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], kind: "quint-overblow", suffix: "quint" },
    ],
  },
  {
    note: "Соль♯2", midi: 80, diagramId: 21, patterns: [
      { values: [1, 1, 1, 0, 1, 1, 0, 0, 0, 0] },
      { values: [0, 1, 1, 1, 0, 0, 0, 0, 0, 0], kind: "alternate", suffix: "alternative-a" },
      { values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], kind: "quint-overblow", suffix: "quint" },
    ],
  },
  {
    note: "Ля2", midi: 81, diagramId: 22, patterns: [
      { values: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0] },
      { values: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0], kind: "quint-overblow", suffix: "quint" },
    ],
  },
  {
    note: "Сі♭2", midi: 82, diagramId: 23, patterns: [
      { values: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0] },
      { values: [1, 0, 1, 1, 1, 1, 1, 1, 0, 0], kind: "quint-overblow", suffix: "quint" },
      { values: [0, 1, 1, 1, 1, 0, 1, 1, 0, 0], kind: "quint-overblow", suffix: "quint-b" },
    ],
  },
  {
    note: "Сі2", midi: 83, diagramId: 24, patterns: [
      { values: [1, 1, 0, 0, 0, 0, 0, 0, 1, 0] },
      { values: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0], kind: "quint-overblow", suffix: "quint" },
    ],
  },
  {
    note: "До3", midi: 84, diagramId: 25, patterns: [
      { values: [1, 1, 1, 1, 1, 1, 1, 0, 1, 1] },
      { values: [0, 1, 1, 1, 1, 0, 1, 0, 0, 0], kind: "quint-overblow", suffix: "quint" },
      { values: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0], kind: "quint-overblow", suffix: "quint-b" },
      { values: [0, 1, 0, 1, 1, 1, 0, 0, 0, 0], kind: "quint-overblow", suffix: "quint-c" },
    ],
  },
  {
    note: "До♯3", midi: 85, diagramId: 26, patterns: [
      { values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0] },
      { values: [1, 1, 1, 1, 1, 0, 0, 1, 1, 1], kind: "alternate", suffix: "alternative-a" },
      { values: [1, 1, 1, 1, 1, 0, 0, 0, 1, 1], kind: "alternate", suffix: "alternative-b" },
      { values: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0], kind: "alternate", suffix: "alternative-c" },
    ],
  },
  {
    note: "Ре3", midi: 86, diagramId: 27, patterns: [
      { values: [1, 1, 1, 1, 0, 0, 0, 1, 1, 0] },
      { values: [1, 1, 1, 1, 0, 0, 0, 0, 1, 1], kind: "alternate", suffix: "alternative-a" },
      { values: [1, 1, 1, 1, 0, 0, 1, 1, 0, 0], kind: "alternate", suffix: "alternative-b" },
      { values: [1, 1, 1, 1, 0, 0, 0, 0, 0, 1], kind: "alternate", suffix: "alternative-c" },
    ],
  },
  { note: "Ре♯3", midi: 87, diagramId: 28, patterns: [{ values: [1, 1, 1, 0, 1, 0, 0, 1, 0, 0] }] },
  {
    note: "Мі3", midi: 88, diagramId: 29, patterns: [
      { values: [1, 1, 1, 0, 0, 0, 0, 1, 0, 0] },
      { values: [1, 1, 1, 1, 1, 1, 1, 0, 0, 1], kind: "alternate", suffix: "alternative-a" },
    ],
  },
  { note: "Фа3", midi: 89, diagramId: 30, patterns: [{ values: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1] }] },
  { note: "Фа♯3", midi: 90, diagramId: 31, patterns: [{ values: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] }] },
  { note: "Соль3", midi: 91, diagramId: 32, patterns: [{ values: [1, 1, 0, 1, 0, 0, 0, 0, 0, 0] }] },
] as const;

function states(values: readonly HoleValue[]): Record<string, HoleState> {
  return Object.fromEntries(HOLE_IDS.map((id, index) => [id, values[index] ? "closed" : "open"]));
}

function makePattern(note: SourceNote, pattern: SourcePattern, index: number): FingeringPattern {
  const kind = pattern.kind ?? "primary";
  const suffix = pattern.suffix ?? "main";
  return {
    id: `c-${note.midi - 60}-${suffix}`,
    pitchOffsetFromBase: note.midi - 60,
    holes: states(pattern.values),
    kind,
    isDefault: index === 0,
    sourceRef: `${FINGERING_SOURCE_URL} · схема ${note.diagramId} · ${note.note} · ${suffix}`,
  };
}

const fingerings = DIGITIZED_FINGERINGS.flatMap((note) => note.patterns.map((pattern, index) => makePattern(note, pattern, index)));
const SUPPORTED_OFFSETS = DIGITIZED_FINGERINGS.map((note) => note.midi - 60);

export const SOPILKA_PROFILE: InstrumentProfile = {
  schemaVersion: 1,
  id: "melnytsia-podilska-soprano",
  name: "Українська хроматична сопілка · сопрано",
  validationStatus: "needs-review",
  holeLayout: [
    { id: "back-left", label: "Задній верхній", x: 7, y: 19 },
    { id: "back-right", label: "Задній нижній", x: 7, y: 73 },
    { id: "front-1", label: "Передній 1", x: 21, y: 15 },
    { id: "front-2", label: "Передній 2", x: 21, y: 25 },
    { id: "front-3", label: "Передній 3", x: 21, y: 33 },
    { id: "front-4", label: "Передній 4", x: 24, y: 39 },
    { id: "front-5", label: "Передній 5", x: 21, y: 49 },
    { id: "front-6", label: "Передній 6", x: 21, y: 58 },
    { id: "front-7", label: "Передній 7", x: 21, y: 69 },
    { id: "front-8", label: "Передній 8", x: 18, y: 78 },
  ],
  soundsOctaveAbove: true,
  supportedTunings: ["C", "D", "F", "G"],
  fingerings,
};

export function fingeringOffset(writtenMidi: number, tuning: Tuning) {
  return writtenMidi - 60 - TUNING_SEMITONES[tuning];
}

export function fingeringsForNote(note: Pick<ScoreNote, "writtenMidi">, tuning: Tuning) {
  const offset = fingeringOffset(note.writtenMidi, tuning);
  return SOPILKA_PROFILE.fingerings.filter((pattern) => pattern.pitchOffsetFromBase === offset);
}

export function defaultFingering(note: Pick<ScoreNote, "writtenMidi">, tuning: Tuning, overrideId?: string) {
  const options = fingeringsForNote(note, tuning);
  return options.find((pattern) => pattern.id === overrideId) ?? options.find((pattern) => pattern.isDefault) ?? options[0];
}

export function validateProfile(profile: InstrumentProfile) {
  const errors: string[] = [];
  const grouped = new Map<number, FingeringPattern[]>();
  for (const pattern of profile.fingerings) {
    if (Object.keys(pattern.holes).length !== 10) errors.push(`${pattern.id}: очікується 10 отворів`);
    const group = grouped.get(pattern.pitchOffsetFromBase) ?? [];
    group.push(pattern);
    grouped.set(pattern.pitchOffsetFromBase, group);
  }
  for (const [offset, patterns] of grouped) {
    if (patterns.filter((pattern) => pattern.isDefault).length !== 1) errors.push(`Позиція ${offset}: потрібна одна основна аплікатура`);
    const signatures = patterns.map((pattern) => HOLE_IDS.map((id) => pattern.holes[id]).join("|"));
    if (new Set(signatures).size !== signatures.length) errors.push(`Позиція ${offset}: дубль аплікатури`);
  }
  for (const offset of SUPPORTED_OFFSETS) {
    if (!grouped.has(offset)) errors.push(`Позиція ${offset}: аплікатура відсутня`);
  }
  for (const offset of grouped.keys()) {
    if (!SUPPORTED_OFFSETS.includes(offset)) errors.push(`Позиція ${offset}: поза оцифрованим діапазоном`);
  }
  return errors;
}
