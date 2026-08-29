import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOUND_SETTINGS,
  normalizeSoundSettings,
  soundSettingsForPreset,
} from "../app/sound";
import {
  applyWaveguideSoundSettings,
  destroyWaveguidePlaybackNode,
  getWaveguideNoteAudioParams,
  scheduleWaveguideNotes,
  WAVEGUIDE_PREROLL_SECONDS,
  waveguideFrequencyForMidi,
  waveguidePressureForMidi,
} from "../app/waveguide-engine";
import { midiToFrequency } from "../app/domain";

describe("sound settings", () => {
  it("provides defaults for projects created before sound controls", () => {
    expect(normalizeSoundSettings(undefined)).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it("creates independent built-in presets", () => {
    const soft = soundSettingsForPreset("soft");
    soft.breath = 0;
    expect(soundSettingsForPreset("soft").breath).toBeGreaterThan(0);
  });

  it("clamps imported values and drops the removed engine selection", () => {
    expect(normalizeSoundSettings({ engine: "synth", preset: "custom", breath: -5, brightness: 140, vibrato: 25 })).toEqual({
      preset: "custom",
      breath: 0,
      brightness: 100,
      vibrato: 25,
    });
  });

  it("maps controls to a restrained instrument sound", () => {
    const values = new Map<string, number>();
    const paths = [
      "/Sopilka_Waveguide_Flute/Physical_and_Nonlinearity/Physical_Parameters/Noise_Gain",
      "/Sopilka_Waveguide_Flute/Physical_and_Nonlinearity/Physical_Parameters/Pressure",
      "/Sopilka_Waveguide_Flute/Envelopes_and_Vibrato/Vibrato_Parameters/Vibrato_Gain",
    ];
    const node = {
      getParams: () => paths,
      setParamValue: (path: string, value: number) => values.set(path, value),
    };
    applyWaveguideSoundSettings(node as never, {
      preset: "custom",
      breath: 60,
      brightness: 70,
      vibrato: 30,
    });
    expect(values.get(paths[0])).toBeLessThan(0.02);
    expect(values.get(paths[1])).toBeLessThan(1);
    expect(values.get(paths[2])).toBeLessThan(0.05);
  });

  it("applies less than half a semitone of pitch calibration", () => {
    for (const midi of [60, 69, 72, 84, 91]) {
      const ratio = waveguideFrequencyForMidi(midi) / midiToFrequency(midi);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(2 ** (0.5 / 12));
    }
  });

  it("raises physical pressure instead of boosting broken upper notes", () => {
    expect(waveguidePressureForMidi(48)).toBe(0.875);
    expect(waveguidePressureForMidi(69)).toBe(0.925);
    expect(waveguidePressureForMidi(72)).toBe(0.925);
    expect(waveguidePressureForMidi(81)).toBe(1);
    expect(waveguidePressureForMidi(91)).toBe(1.175);
    expect(waveguidePressureForMidi(62)).toBeGreaterThan(0.9);
    expect(waveguidePressureForMidi(62)).toBeLessThan(0.925);
  });

  it("prepares each retune while muted before its audible start", () => {
    const createParam = () => {
      const events: Array<["cancel" | "set" | "ramp", number, number?]> = [];
      return {
        events,
        cancelScheduledValues: (time: number) => events.push(["cancel", time]),
        setValueAtTime: (value: number, time: number) => events.push(["set", time, value]),
        linearRampToValueAtTime: (value: number, time: number) => events.push(["ramp", time, value]),
      };
    };
    const frequency = createParam();
    const gain = createParam();
    const gate = createParam();
    const pressure = createParam();
    const masterGain = createParam();
    scheduleWaveguideNotes(
      { frequency, gain, gate, pressure } as never,
      masterGain as never,
      [
        { midi: 60, timeMs: 0, durationMs: 500 },
        { midi: 62, timeMs: 500, durationMs: 500 },
      ],
      10,
      250,
      1,
      40,
    );

    expect(frequency.events[1][1]).toBeCloseTo(
      10 - WAVEGUIDE_PREROLL_SECONDS,
    );
    expect(frequency.events[2][1]).toBeCloseTo(
      10.25 - WAVEGUIDE_PREROLL_SECONDS,
    );
    const ramps = masterGain.events.filter(([type]) => type === "ramp");
    expect(ramps.map(([, time]) => time)).toEqual([
      10.004,
      10.236,
      10.254,
      10.7475,
    ]);
    expect(ramps[0][2]).toBeCloseTo(0.14);
    expect(ramps[1][2]).toBe(0);
    expect(ramps[2][2]).toBeCloseTo(0.14);
    expect(ramps[3][2]).toBe(0);
    expect(gate.events).toContainEqual(["set", 9.988, 1]);
    expect(gate.events).toContainEqual(["set", 10.7475, 0]);
    expect(gate.events.filter(([, , value]) => value === 1)).toHaveLength(1);
    expect(pressure.events[1][2]).toBeCloseTo(waveguidePressureForMidi(60));
    expect(pressure.events[2][2]).toBeCloseTo(waveguidePressureForMidi(62));
  });

  it("schedules parameters without AudioWorklet on restrictive hosting", () => {
    vi.useFakeTimers();
    const values: Array<[string, number]> = [];
    const paths = [
      "/Sopilka_Waveguide_Flute/Basic_Parameters/freq",
      "/Sopilka_Waveguide_Flute/Basic_Parameters/gain",
      "/Sopilka_Waveguide_Flute/Basic_Parameters/gate",
      "/Sopilka_Waveguide_Flute/Physical_and_Nonlinearity/Physical_Parameters/Pressure",
    ];
    const node = {
      context: { currentTime: 10 },
      getParams: () => paths,
      setParamValue: (path: string, value: number) => values.push([path, value]),
      destroy: vi.fn(),
    };
    const params = getWaveguideNoteAudioParams(node as never);
    params.frequency.setValueAtTime(440, 10);
    params.gate.setValueAtTime(1, 10.05);
    expect(values).toEqual([[paths[0], 440]]);
    vi.advanceTimersByTime(50);
    expect(values).toContainEqual([paths[2], 1]);

    params.pressure.setValueAtTime(0.9, 11);
    destroyWaveguidePlaybackNode(node as never);
    vi.advanceTimersByTime(1000);
    expect(values).not.toContainEqual([paths[3], 0.9]);
    expect(node.destroy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
