import type { SoundSettings } from "./domain";
import { midiToFrequency } from "./domain";

export interface WaveguidePlaybackNode extends AudioNode {
  setParamValue(path: string, value: number): void;
  getParams(): string[];
  destroy(): void;
}

interface SchedulableParam {
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
}

export interface WaveguideNoteAudioParams {
  frequency: SchedulableParam;
  gain: SchedulableParam;
  gate: SchedulableParam;
  pressure: SchedulableParam;
}

export interface WaveguideScheduledNote {
  midi: number;
  timeMs: number;
  durationMs: number;
}

type FaustFactory = Awaited<
  ReturnType<
    typeof import("@grame/faustwasm")["FaustWasmInstantiator"]["loadDSPFactory"]
  >
>;

const ROOT = "/Sopilka_Waveguide_Flute";
export const WAVEGUIDE_PREROLL_SECONDS = 0.012;
let factoryPromise: Promise<FaustFactory> | undefined;
type ScheduledTimer = {
  id: ReturnType<typeof setTimeout>;
  time: number;
};
const scheduledParamTimers = new WeakMap<
  WaveguidePlaybackNode,
  Map<string, Set<ScheduledTimer>>
>();

function assetUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}faust/waveguide/${fileName}`;
}

async function loadFactory() {
  factoryPromise ??= import("@grame/faustwasm").then(
    ({ FaustWasmInstantiator }) =>
      FaustWasmInstantiator.loadDSPFactory(
        assetUrl("dsp-module.wasm"),
        assetUrl("dsp-meta.json"),
      ),
  );
  try {
    return await factoryPromise;
  } catch (error) {
    factoryPromise = undefined;
    throw error;
  }
}

function setKnownParam(node: WaveguidePlaybackNode, path: string, value: number) {
  if (node.getParams().includes(path)) node.setParamValue(path, value);
}

export function applyWaveguideSoundSettings(
  node: WaveguidePlaybackNode,
  settings: SoundSettings,
) {
  const breath = settings.breath / 100;
  const brightness = settings.brightness / 100;
  const vibrato = settings.vibrato / 100;
  setKnownParam(
    node,
    `${ROOT}/Physical_and_Nonlinearity/Physical_Parameters/Noise_Gain`,
    0.001 + breath * 0.018,
  );
  setKnownParam(
    node,
    `${ROOT}/Physical_and_Nonlinearity/Physical_Parameters/Pressure`,
    0.86 + brightness * 0.12,
  );
  setKnownParam(
    node,
    `${ROOT}/Physical_and_Nonlinearity/Nonlinear_Filter_Parameters/Nonlinearity`,
    brightness * 0.015,
  );
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Vibrato_Parameters/Vibrato_Freq`, 5.1);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Vibrato_Parameters/Vibrato_Gain`, vibrato * 0.16);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Pressure_Envelope_Parameters/Press_Env_Attack`, 0.005);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Pressure_Envelope_Parameters/Press_Env_Decay`, 0.018);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Pressure_Envelope_Parameters/Press_Env_Release`, 0.035);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Global_Envelope_Parameters/Glob_Env_Attack`, 0.004);
  setKnownParam(node, `${ROOT}/Envelopes_and_Vibrato/Global_Envelope_Parameters/Glob_Env_Release`, 0.025);
  setKnownParam(node, `${ROOT}/Reverb/reverbGain`, 0.025);
}

export function getWaveguideNoteAudioParams(
  node: WaveguidePlaybackNode,
): WaveguideNoteAudioParams {
  const paths = {
    frequency: `${ROOT}/Basic_Parameters/freq`,
    gain: `${ROOT}/Basic_Parameters/gain`,
    gate: `${ROOT}/Basic_Parameters/gate`,
    pressure: `${ROOT}/Physical_and_Nonlinearity/Physical_Parameters/Pressure`,
  };
  const parameters = (
    node as WaveguidePlaybackNode & { parameters?: AudioParamMap }
  ).parameters;
  if (parameters) {
    const frequency = parameters.get(paths.frequency);
    const gain = parameters.get(paths.gain);
    const gate = parameters.get(paths.gate);
    const pressure = parameters.get(paths.pressure);
    if (!frequency || !gain || !gate || !pressure) {
      throw new Error("Аудіомодель не надала параметри точного планування.");
    }
    return { frequency, gain, gate, pressure };
  }

  const knownPaths = new Set(node.getParams());
  if (Object.values(paths).some((path) => !knownPaths.has(path))) {
    throw new Error("Аудіомодель не надала параметри планування.");
  }
  const scheduledParam = (path: string): SchedulableParam => ({
    cancelScheduledValues(time) {
      const timers = scheduledParamTimers.get(node)?.get(path);
      if (!timers) return;
      timers.forEach((timer) => {
        if (timer.time < time) return;
        clearTimeout(timer.id);
        timers.delete(timer);
      });
    },
    setValueAtTime(value, time) {
      const delayMs = Math.max(0, (time - node.context.currentTime) * 1000);
      if (delayMs <= 1) {
        node.setParamValue(path, value);
        return;
      }
      let nodeTimers = scheduledParamTimers.get(node);
      if (!nodeTimers) {
        nodeTimers = new Map();
        scheduledParamTimers.set(node, nodeTimers);
      }
      let timers = nodeTimers.get(path);
      if (!timers) {
        timers = new Set();
        nodeTimers.set(path, timers);
      }
      const timer = {} as ScheduledTimer;
      timer.time = time;
      timer.id = setTimeout(() => {
        timers.delete(timer);
        node.setParamValue(path, value);
      }, delayMs);
      timers.add(timer);
    },
  });
  return {
    frequency: scheduledParam(paths.frequency),
    gain: scheduledParam(paths.gain),
    gate: scheduledParam(paths.gate),
    pressure: scheduledParam(paths.pressure),
  };
}

export function destroyWaveguidePlaybackNode(node: WaveguidePlaybackNode) {
  scheduledParamTimers.get(node)?.forEach((timers) => {
    timers.forEach((timer) => clearTimeout(timer.id));
  });
  scheduledParamTimers.delete(node);
  node.destroy();
}

export function waveguideFrequencyForMidi(midi: number) {
  const compensationCents = midi <= 69
    ? 14
    : midi <= 84
      ? 14 + (midi - 69) * (28 / 15)
      : 42 - (midi - 84) * (20 / 7);
  return midiToFrequency(midi) * 2 ** (compensationCents / 1200);
}

const PRESSURE_COMPENSATION: Array<[midi: number, pressure: number]> = [
  [48, 0.875],
  [60, 0.9],
  [69, 0.925],
  [72, 0.925],
  [75, 0.95],
  [78, 0.975],
  [81, 1],
  [84, 1.025],
  [87, 1.075],
  [91, 1.175],
  [96, 1.25],
];

export function waveguidePressureForMidi(midi: number) {
  const first = PRESSURE_COMPENSATION[0];
  const last = PRESSURE_COMPENSATION.at(-1)!;
  if (midi <= first[0]) return first[1];
  if (midi >= last[0]) return last[1];
  const upperIndex = PRESSURE_COMPENSATION.findIndex(([pointMidi]) => pointMidi >= midi);
  const lower = PRESSURE_COMPENSATION[upperIndex - 1];
  const upper = PRESSURE_COMPENSATION[upperIndex];
  const position = (midi - lower[0]) / (upper[0] - lower[0]);
  return lower[1] + (upper[1] - lower[1]) * position;
}

export function scheduleWaveguideNotes(
  params: WaveguideNoteAudioParams,
  masterGain: AudioParam,
  notes: WaveguideScheduledNote[],
  audioStartTime: number,
  startPositionMs: number,
  tempoScale: number,
  breathPercent: number,
) {
  const instrumentGain = Math.min(1, 0.7 + breathPercent / 400);
  const automationStartTime = Math.max(
    0,
    audioStartTime - WAVEGUIDE_PREROLL_SECONDS,
  );
  params.frequency.cancelScheduledValues(automationStartTime);
  params.gain.cancelScheduledValues(automationStartTime);
  params.gate.cancelScheduledValues(automationStartTime);
  params.pressure.cancelScheduledValues(automationStartTime);
  masterGain.cancelScheduledValues(automationStartTime);
  params.gain.setValueAtTime(instrumentGain, automationStartTime);
  params.gate.setValueAtTime(0, automationStartTime);
  masterGain.setValueAtTime(0, automationStartTime);
  notes.forEach((note, index) => {
    const outputGain = 0.14;
    const start =
      audioStartTime +
      Math.max(0, note.timeMs - startPositionMs) / 1000 / tempoScale;
    const elapsed = Math.max(0, startPositionMs - note.timeMs);
    const nextNoteTime = notes[index + 1]?.timeMs;
    const writtenEnd = note.timeMs + note.durationMs;
    const effectiveEndMs = nextNoteTime === undefined
      ? writtenEnd
      : Math.min(writtenEnd, nextNoteTime);
    const nominalEnd = start + Math.max(
      0.025,
      (effectiveEndMs - note.timeMs - elapsed) / 1000 / tempoScale,
    );
    const noteLength = nominalEnd - start;
    const joinsNextNote = nextNoteTime !== undefined && nextNoteTime <= writtenEnd + 1;
    const silentGap = joinsNextNote
      ? WAVEGUIDE_PREROLL_SECONDS + 0.002
      : Math.min(0.0025, Math.max(0.0008, noteLength * 0.04));
    const end = Math.max(start + 0.012, nominalEnd - silentGap);
    const attackDuration = Math.min(0.004, noteLength * 0.1);
    const releaseDuration = Math.min(0.006, noteLength * 0.1);
    const attackEnd = Math.min(end, start + attackDuration);
    const releaseStart = Math.max(attackEnd, end - releaseDuration);
    const triggerTime = Math.max(
      automationStartTime,
      start - WAVEGUIDE_PREROLL_SECONDS,
    );

    params.frequency.setValueAtTime(waveguideFrequencyForMidi(note.midi), triggerTime);
    params.pressure.setValueAtTime(waveguidePressureForMidi(note.midi), triggerTime);
    // Keep the physical model running between notes. Re-triggering its internal
    // envelope while the previous release is still active can leave it silent.
    // Articulation is handled by the click-free external gain envelope instead.
    if (index === 0) params.gate.setValueAtTime(1, triggerTime);
    masterGain.setValueAtTime(0, start);
    masterGain.linearRampToValueAtTime(outputGain, attackEnd);
    masterGain.setValueAtTime(outputGain, releaseStart);
    masterGain.linearRampToValueAtTime(0, end);
    if (index === notes.length - 1) params.gate.setValueAtTime(0, end);
  });
}

export async function createWaveguidePlaybackNode(
  context: AudioContext,
  settings: SoundSettings,
): Promise<WaveguidePlaybackNode> {
  const [{ FaustMonoDspGenerator }, factory] = await Promise.all([
    import("@grame/faustwasm"),
    loadFactory(),
  ]);
  const generator = new FaustMonoDspGenerator();
  const createNode = (useScriptProcessor: boolean) => generator.createNode(
      context,
      "sopilka-instrument",
      factory,
      useScriptProcessor,
      1024,
      "sopilka-instrument-processor",
    );
  let node;
  try {
    node = await createNode(!context.audioWorklet);
  } catch (error) {
    if (!context.audioWorklet) throw error;
    console.info(
      "AudioWorklet недоступний на цьому хостингу; використовується сумісний аудіорежим.",
    );
    node = await createNode(true);
  }
  if (!node) throw new Error("Не вдалося створити аудіовузол.");
  const playbackNode = node as WaveguidePlaybackNode;
  applyWaveguideSoundSettings(playbackNode, settings);
  getWaveguideNoteAudioParams(playbackNode);
  return playbackNode;
}
