import { describe, expect, it } from "vitest";
import type { Project } from "../app/domain";
import { scoreTransposition, TUNING_SEMITONES, safeProject } from "../app/domain";
import { createProject, DEFAULT_ABC, withProjectDefaults } from "../app/project";
import { FINGERING_SOURCE_URL, HOLE_IDS, SOPILKA_PROFILE, fingeringsForNote, validateProfile } from "../app/instrument";
import { buildPlaybackTimings, playbackTimeForNote } from "../app/timeline";

describe("instrument profile", () => {
  it("contains exactly ten states in every fingering and one default per pitch", () => {
    expect(validateProfile(SOPILKA_PROFILE)).toEqual([]);
    expect(SOPILKA_PROFILE.fingerings).toHaveLength(49);
    expect([...new Set(SOPILKA_PROFILE.fingerings.map((pattern) => pattern.pitchOffsetFromBase))]).toEqual(Array.from({ length: 32 }, (_, offset) => offset));
    expect(SOPILKA_PROFILE.fingerings.filter((pattern) => pattern.kind === "primary")).toHaveLength(32);
    expect(SOPILKA_PROFILE.fingerings.filter((pattern) => pattern.kind === "alternate")).toHaveLength(8);
    expect(SOPILKA_PROFILE.fingerings.filter((pattern) => pattern.kind === "quint-overblow")).toHaveLength(9);
    SOPILKA_PROFILE.fingerings.forEach((pattern) => expect(Object.keys(pattern.holes)).toEqual([...HOLE_IDS]));
    SOPILKA_PROFILE.fingerings.forEach((pattern) => expect(pattern.sourceRef).toContain(FINGERING_SOURCE_URL));
  });

  it("uses the explicit Sopilka Acropolis patterns instead of register heuristics", () => {
    const signature = (midi: number, option = 0) => HOLE_IDS.map((id) => fingeringsForNote({ writtenMidi: midi }, "C")[option].holes[id] === "closed" ? 1 : 0);

    expect(signature(60)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(signature(68)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 1]);
    expect(signature(71)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(signature(79, 1)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(fingeringsForNote({ writtenMidi: 80 }, "C").map((pattern) => pattern.kind)).toEqual(["primary", "alternate", "quint-overblow"]);
    expect(fingeringsForNote({ writtenMidi: 84 }, "C")).toHaveLength(4);
  });

  it("keeps geometry while shifting C, D, F and G fingerings", () => {
    const c = fingeringsForNote({ writtenMidi: 60 }, "C")[0];
    for (const tuning of SOPILKA_PROFILE.supportedTunings) {
      const shifted = fingeringsForNote({ writtenMidi: 60 + TUNING_SEMITONES[tuning] }, tuning)[0];
      expect(shifted.holes).toEqual(c.holes);
    }
  });

  it("marks pitches outside the digitized chart as unavailable", () => {
    expect(fingeringsForNote({ writtenMidi: 30 }, "C")).toEqual([]);
    expect(fingeringsForNote({ writtenMidi: 91 }, "C")).toHaveLength(1);
    expect(fingeringsForNote({ writtenMidi: 92 }, "C")).toEqual([]);
    expect(fingeringsForNote({ writtenMidi: 100 }, "G")).toEqual([]);
  });

  it("places both rear holes on one side at opposite heights", () => {
    const upper = SOPILKA_PROFILE.holeLayout.find((hole) => hole.id === "back-left");
    const lower = SOPILKA_PROFILE.holeLayout.find((hole) => hole.id === "back-right");
    expect(upper?.y).toBeLessThan(30);
    expect(lower?.y).toBeGreaterThan(65);
    expect(lower?.x).toBe(upper?.x);
  });

  it("keeps the staggered front-hole geometry from the source diagrams", () => {
    const centered = SOPILKA_PROFILE.holeLayout.find((hole) => hole.id === "front-1");
    const right = SOPILKA_PROFILE.holeLayout.find((hole) => hole.id === "front-4");
    const left = SOPILKA_PROFILE.holeLayout.find((hole) => hole.id === "front-8");
    expect(right?.x).toBeGreaterThan(centered?.x ?? 0);
    expect(left?.x).toBeLessThan(centered?.x ?? 0);
  });
});

describe("project contract", () => {
  it("starts new users with a basic public-domain flute melody", () => {
    expect(DEFAULT_ABC).toContain("T:Ода до радості");
    expect(DEFAULT_ABC).toContain("C:Людвіг ван Бетховен");
    expect(DEFAULT_ABC).not.toContain("червона калина");
  });

  it("round-trips schema version 1", () => {
    const project = createProject();
    expect(safeProject(JSON.parse(JSON.stringify(project)))).toBe(true);
  });

  it("adds sound defaults to older schema version 1 projects", () => {
    const project = createProject();
    const legacy = { ...project, sound: undefined } as unknown as Project;
    expect(withProjectDefaults(legacy).sound).toEqual(project.sound);
  });

  it("adds a neutral octave shift to older projects", () => {
    const project = createProject();
    const legacy = { ...project, octaveShift: undefined } as unknown as Project;
    expect(withProjectDefaults(legacy).octaveShift).toBe(0);
  });

  it("combines octave and tuning transposition without changing the source", () => {
    expect(scoreTransposition("G", "original-key", -1)).toBe("-P8");
    expect(scoreTransposition("D", "preserve-fingerings", -1)).toBe("-m7");
    expect(scoreTransposition("F", "preserve-fingerings", 0)).toBe("+P4");
    expect(scoreTransposition("G", "preserve-fingerings", 1)).toBe("+P12");
  });
});

describe("playback timeline", () => {
  it("maps repeated Verovio rendition ids back to the printed notes", () => {
    const notes = [
      { id: "note-1", writtenMidi: 60, pname: "c", octave: 4, accidental: 0, measure: 1 },
      { id: "note-2", writtenMidi: 62, pname: "d", octave: 4, accidental: 0, measure: 1 },
    ];
    const expansions: Record<string, string[]> = {
      "note-1": ["note-1", "note-1-rend2"],
      "note-2": ["note-2", "note-2-rend2"],
    };
    const timings = buildPlaybackTimings(notes, [
      { tstamp: 0, on: ["note-1"] },
      { tstamp: 500, off: ["note-1"], on: ["note-2"] },
      { tstamp: 1000, off: ["note-2"], on: ["note-1-rend2"] },
      { tstamp: 1500, off: ["note-1-rend2"], on: ["note-2-rend2"] },
      { tstamp: 2000, off: ["note-2-rend2"] },
    ], (id) => expansions[id] ?? []);

    expect(timings).toEqual([
      { noteId: "note-1", startMs: 0 },
      { noteId: "note-2", startMs: 500 },
      { noteId: "note-1", startMs: 1000 },
      { noteId: "note-2", startMs: 1500 },
      { startMs: 2000 },
    ]);
  });

  it("clears the cursor for rests", () => {
    const notes = [{ id: "note-1", writtenMidi: 60, pname: "c", octave: 4, accidental: 0, measure: 1 }];
    expect(buildPlaybackTimings(notes, [
      { tstamp: 0, on: ["note-1"] },
      { tstamp: 500, off: ["note-1"], restsOn: ["rest-1"] },
    ], (id) => [id])).toEqual([
      { noteId: "note-1", startMs: 0 },
      { startMs: 500 },
    ]);
  });

  it("keeps the original note id when Verovio returns an empty expansion id", () => {
    const notes = [{ id: "midi-note", writtenMidi: 60, pname: "c", octave: 4, accidental: 0, measure: 1 }];
    expect(buildPlaybackTimings(notes, [
      { tstamp: 0, on: ["midi-note"] },
      { tstamp: 500, off: ["midi-note"] },
    ], () => [""])).toEqual([
      { noteId: "midi-note", startMs: 0 },
      { startMs: 500 },
    ]);
  });

  it("chooses the occurrence closest to the current playback position", () => {
    const timings = [
      { noteId: "repeated-note", startMs: 100 },
      { noteId: "other-note", startMs: 500 },
      { noteId: "repeated-note", startMs: 900 },
    ];
    expect(playbackTimeForNote(timings, "repeated-note", 0)).toBe(100);
    expect(playbackTimeForNote(timings, "repeated-note", 760)).toBe(900);
    expect(playbackTimeForNote(timings, "missing-note", 0)).toBeUndefined();
  });
});
