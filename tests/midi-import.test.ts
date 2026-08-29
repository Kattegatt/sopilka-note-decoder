import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { midiBytesToMusicXml } from "../app/midi-import";
import { buildPlaybackTimings } from "../app/timeline";
import { buildMetronomeClicks } from "../app/usePlayback";

function exampleMidi() {
  const midi = new Midi();
  midi.name = "Test melody";
  midi.header.setTempo(90);
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [3, 4] }];
  midi.header.update();

  const lead = midi.addTrack();
  lead.name = "Lead";
  lead.addNote({ midi: 60, ticks: 0, durationTicks: 960 });
  lead.addNote({ midi: 64, ticks: 0, durationTicks: 960 });
  lead.addNote({ midi: 62, ticks: 480, durationTicks: 480 });

  const answer = midi.addTrack();
  answer.name = "Answer";
  answer.addNote({ midi: 67, ticks: 0, durationTicks: 480 });
  answer.addNote({ midi: 69, ticks: 480, durationTicks: 480 });
  return midi.toArray();
}

describe("MIDI import", () => {
  it("builds accented metronome clicks from tempo and meter", () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    midi.header.timeSignatures = [{ ticks: 0, timeSignature: [3, 4] }];
    midi.header.update();

    const clicks = buildMetronomeClicks(midi, 1500);
    expect(clicks.map((click) => Math.round(click.timeMs))).toEqual([0, 500, 1000, 1500]);
    expect(clicks.map((click) => click.accented)).toEqual([true, false, false, true]);
  });

  it("converts tracks, chords, overlapping voices, tempo and meter to MusicXML", () => {
    const result = midiBytesToMusicXml(exampleMidi(), "fallback.mid");
    expect(result.title).toBe("fallback");
    expect(result.tempoBpm).toBe(90);
    expect(result.trackCount).toBe(2);
    expect(result.voiceCount).toBe(3);
    expect(result.musicXml).toContain("<beats>3</beats><beat-type>4</beat-type>");
    expect(result.musicXml).toContain("<words>♩ = 90</words>");
    expect(result.musicXml).toContain("<part-name>Lead</part-name>");
    expect(result.musicXml).toContain("<part-name>Answer</part-name>");
    expect(result.musicXml).toContain("<chord/>");
    expect(result.musicXml).toContain("<voice>2</voice>");
    expect(result.musicXml).toContain("<backup>");
  });

  it("rejects MIDI without note tracks", () => {
    expect(() => midiBytesToMusicXml(new Midi().toArray(), "empty.mid")).toThrow("немає нотних доріжок");
  });

  it("preserves sounding pitches, uses the key spelling and removes articulation gaps", () => {
    const midi = new Midi();
    midi.header.setTempo(80);
    midi.header.keySignatures = [{ ticks: 0, key: "Bb", scale: "major" }];
    midi.header.update();
    const track = midi.addTrack();
    // Score editors commonly shorten a quarter note slightly for articulation.
    track.addNote({ midi: 70, ticks: 0, durationTicks: 420 });
    // Legato export can also overlap the following onset slightly.
    track.addNote({ midi: 73, ticks: 480, durationTicks: 540 });
    track.addNote({ midi: 75, ticks: 960, durationTicks: 420 });

    const bytes = midi.toArray();
    const keyEvent = bytes.findIndex((value, index) => value === 0xff && bytes[index + 1] === 0x59 && bytes[index + 2] === 0x02);
    expect(keyEvent).toBeGreaterThanOrEqual(0);
    bytes[keyEvent + 3] = 0xfe; // MIDI key-signature value −2 = B-flat major.
    const xml = midiBytesToMusicXml(bytes, "pitch.mid").musicXml;
    expect(xml.match(/<pitch>/g)).toHaveLength(3);
    expect(xml).toContain("<pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>8</duration>");
    expect(xml).toContain("<pitch><step>D</step><alter>-1</alter><octave>5</octave></pitch><duration>8</duration>");
    expect(xml).toContain("<pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>8</duration>");
    expect(xml).not.toContain("<metronome>");
    expect(xml).toContain("<words>♩ = 80</words>");
  });

  it("adds beam groups to consecutive short notes", () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.addNote({ midi: 60, ticks: 0, durationTicks: 210 });
    track.addNote({ midi: 62, ticks: 240, durationTicks: 210 });
    const xml = midiBytesToMusicXml(midi.toArray(), "beams.mid").musicXml;
    expect(xml).toContain('<beam number="1">begin</beam>');
    expect(xml).toContain('<beam number="1">end</beam>');
  });

  it("produces MusicXML accepted by Verovio", async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import("verovio/wasm"),
      import("verovio/esm"),
    ]);
    const wasmModule = await createVerovioModule();
    const toolkit = new VerovioToolkit(wasmModule) as unknown as {
      setOptions(options: Record<string, unknown>): void;
      loadData(data: string): boolean | number;
      getMEI(): string;
      destroy(): void;
    };
    try {
      toolkit.setOptions({ inputFrom: "xml" });
      expect(toolkit.loadData(midiBytesToMusicXml(exampleMidi(), "example.mid").musicXml)).toBeTruthy();
      expect(toolkit.getMEI()).toContain("<note");
    } finally {
      toolkit.destroy();
    }
  });

  it("maps a generated MIDI timeline back to every printed note", async () => {
    const midi = new Midi();
    midi.header.setTempo(90);
    const track = midi.addTrack();
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480 });
    track.addNote({ midi: 62, ticks: 480, durationTicks: 480 });
    track.addNote({ midi: 64, ticks: 960, durationTicks: 480 });

    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import("verovio/wasm"),
      import("verovio/esm"),
    ]);
    const wasmModule = await createVerovioModule();
    const sourceToolkit = new VerovioToolkit(wasmModule) as unknown as {
      setOptions(options: Record<string, unknown>): void;
      loadData(data: string): boolean | number;
      getMEI(): string;
      destroy(): void;
    };
    sourceToolkit.setOptions({ inputFrom: "xml" });
    expect(sourceToolkit.loadData(midiBytesToMusicXml(midi.toArray(), "cursor.mid").musicXml)).toBeTruthy();
    const mei = sourceToolkit.getMEI();
    sourceToolkit.destroy();

    const playbackToolkit = new VerovioToolkit(wasmModule) as unknown as {
      setOptions(options: Record<string, unknown>): void;
      loadData(data: string): boolean | number;
      getMEI(): string;
      renderToTimemap(options?: Record<string, unknown>): Array<{ tstamp: number; on?: string[]; off?: string[]; restsOn?: string[] }>;
      getExpansionIdsForElement(id: string): string[];
      destroy(): void;
    };
    try {
      playbackToolkit.setOptions({ inputFrom: "mei" });
      expect(playbackToolkit.loadData(mei)).toBeTruthy();
      const noteIds = [...playbackToolkit.getMEI().matchAll(/<note\b[^>]*xml:id="([^"]+)"/g)].map((match) => match[1]);
      const notes = noteIds.map((id, index) => ({ id, writtenMidi: 60 + index * 2, pname: "c", octave: 4, accidental: 0, measure: 1 }));
      const timings = buildPlaybackTimings(
        notes,
        playbackToolkit.renderToTimemap({ includeRests: true }),
        (id) => playbackToolkit.getExpansionIdsForElement(id),
      );
      expect(timings.filter((timing) => timing.noteId).map((timing) => timing.noteId)).toEqual(noteIds);
    } finally {
      playbackToolkit.destroy();
    }
  });
});
