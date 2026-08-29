"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Midi } from "@tonejs/midi";
import type { NoteTiming, SoundSettings } from "./domain";
import {
  createWaveguidePlaybackNode,
  destroyWaveguidePlaybackNode,
  getWaveguideNoteAudioParams,
  scheduleWaveguideNotes,
  WAVEGUIDE_PREROLL_SECONDS,
} from "./waveguide-engine";
import type { WaveguidePlaybackNode } from "./waveguide-engine";

interface MidiNote {
  midi: number;
  timeMs: number;
  durationMs: number;
}
export interface MetronomeClick {
  timeMs: number;
  accented: boolean;
}

interface PlaybackData {
  notes: MidiNote[];
  metronome: MetronomeClick[];
}

export function buildMetronomeClicks(
  midi: Midi,
  durationMs: number,
): MetronomeClick[] {
  const [numerator = 4, denominator = 4] = midi.header.timeSignatures[0]
    ?.timeSignature ?? [4, 4];
  const beatsPerMeasure = Math.max(1, Math.round(numerator));
  const beatTicks = Math.max(
    1,
    (midi.header.ppq * 4) / Math.max(1, denominator),
  );
  const clicks: MetronomeClick[] = [];
  let beat = 0;
  for (let tick = 0; ; tick += beatTicks, beat += 1) {
    const timeMs = midi.header.ticksToSeconds(tick) * 1000;
    if (timeMs > durationMs + 1) break;
    clicks.push({ timeMs, accented: beat % beatsPerMeasure === 0 });
  }
  return clicks;
}

function decodeMidi(value: string): PlaybackData {
  if (!value) return { notes: [], metronome: [] };
  const raw = value.includes(",") ? value.split(",").pop()! : value;
  const binary = atob(raw);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const midi = new Midi(bytes);
  const notes = midi.tracks
    .flatMap((track) =>
      track.notes.map((note) => ({
        midi: note.midi,
        timeMs: note.time * 1000,
        durationMs: note.duration * 1000,
      })),
    )
    .sort((a, b) => a.timeMs - b.timeMs);
  const durationMs = notes.reduce(
    (maximum, note) => Math.max(maximum, note.timeMs + note.durationMs),
    0,
  );
  return { notes, metronome: buildMetronomeClicks(midi, durationMs) };
}

export function usePlayback(
  midiBase64: string,
  timings: NoteTiming[],
  tempoPercent: number,
  soundSettings: SoundSettings,
) {
  const playbackData = useMemo(() => {
    try {
      return decodeMidi(midiBase64);
    } catch {
      return { notes: [], metronome: [] };
    }
  }, [midiBase64]);
  const { notes, metronome } = playbackData;
  const scale = tempoPercent / 100;
  const soundKey = `${soundSettings.breath}:${soundSettings.brightness}:${soundSettings.vibrato}`;
  const durationMs = notes.reduce(
    (maximum, note) => Math.max(maximum, note.timeMs + note.durationMs),
    0,
  );
  const [playing, setPlaying] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const contextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const connectedNodesRef = useRef<AudioNode[]>([]);
  const waveguideNodeRef = useRef<WaveguidePlaybackNode | null>(null);
  const animationRef = useRef(0);
  const startedAtRef = useRef(0);
  const startedPositionRef = useRef(0);
  const startedScaleRef = useRef(scale);
  const startedSoundKeyRef = useRef(soundKey);
  const playbackGenerationRef = useRef(0);

  const stopNodes = useCallback(() => {
    playbackGenerationRef.current += 1;
    if (waveguideNodeRef.current) {
      try {
        destroyWaveguidePlaybackNode(waveguideNodeRef.current);
      } catch {
        /* node is already destroyed */
      }
      try {
        waveguideNodeRef.current.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    waveguideNodeRef.current = null;
    sourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    });
    sourcesRef.current = [];
    connectedNodesRef.current.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    connectedNodesRef.current = [];
    cancelAnimationFrame(animationRef.current);
  }, []);

  const currentPosition = useCallback(() => {
    const context = contextRef.current;
    if (!context || !playing) return positionMs;
    return Math.max(
      startedPositionRef.current,
      startedPositionRef.current +
      (context.currentTime - startedAtRef.current) *
        1000 *
        startedScaleRef.current,
    );
  }, [playing, positionMs]);

  const pause = useCallback(() => {
    const nextPosition = currentPosition();
    stopNodes();
    setPositionMs(Math.min(nextPosition, durationMs));
    setPlaying(false);
  }, [currentPosition, durationMs, stopNodes]);

  const reset = useCallback(() => {
    stopNodes();
    setPlaying(false);
    setPositionMs(0);
  }, [stopNodes]);

  const startPlaybackAt = useCallback(
    async (requestedPosition: number, includeMetronome = metronomeEnabled) => {
      if (!notes.length) return;
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      stopNodes();
      const generation = playbackGenerationRef.current;
      contextRef.current ??= new AudioContextClass();
      const context = contextRef.current;
      await context.resume();
      if (generation !== playbackGenerationRef.current) return;
      const startPosition = Math.max(
        0,
        Math.min(requestedPosition, durationMs),
      );
      let waveguideNode: WaveguidePlaybackNode;
      try {
        waveguideNode = await createWaveguidePlaybackNode(context, soundSettings);
        setAudioUnavailable(false);
      } catch (error) {
        console.warn("Не вдалося запустити аудіомодель.", error);
        setAudioUnavailable(true);
        setPlaying(false);
        return;
      }
      if (generation !== playbackGenerationRef.current) {
        destroyWaveguidePlaybackNode(waveguideNode);
        return;
      }
      const playbackStartTime = context.currentTime + WAVEGUIDE_PREROLL_SECONDS;
      startedPositionRef.current = startPosition;
      startedAtRef.current = playbackStartTime;
      startedScaleRef.current = scale;
      startedSoundKeyRef.current = soundKey;
      setPositionMs(startPosition);
      const output = context.createGain();
      const dcBlocker = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      output.gain.value = 0;
      dcBlocker.type = "highpass";
      dcBlocker.frequency.value = 35;
      dcBlocker.Q.value = 0.7;
      compressor.threshold.value = -24;
      compressor.knee.value = 10;
      compressor.ratio.value = 10;
      compressor.attack.value = 0.001;
      compressor.release.value = 0.08;
      output.connect(compressor).connect(context.destination);
      connectedNodesRef.current = [dcBlocker, output, compressor];
      const sources: AudioScheduledSourceNode[] = [];
      const playableNotes = notes.filter(
        (note) => note.timeMs + note.durationMs > startPosition,
      );
      waveguideNodeRef.current = waveguideNode;
      waveguideNode.connect(dcBlocker).connect(output);
      scheduleWaveguideNotes(
        getWaveguideNoteAudioParams(waveguideNode),
        output.gain,
        playableNotes,
        playbackStartTime,
        startPosition,
        scale,
        soundSettings.breath,
      );
      if (includeMetronome) {
        metronome
          .filter((click) => click.timeMs >= startPosition)
          .forEach((click) => {
            const start =
              playbackStartTime +
              Math.max(0, click.timeMs - startPosition) / 1000 / scale;
            const oscillator = context.createOscillator();
            const envelope = context.createGain();
            oscillator.type = "square";
            oscillator.frequency.value = click.accented ? 1560 : 1040;
            envelope.gain.setValueAtTime(0.0001, start);
            envelope.gain.exponentialRampToValueAtTime(
              click.accented ? 0.24 : 0.14,
              start + 0.002,
            );
            envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
            oscillator.connect(envelope).connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.05);
            sources.push(oscillator);
          });
      }
      sourcesRef.current = sources;
      setPlaying(true);
    },
    [durationMs, metronome, metronomeEnabled, notes, scale, soundKey, soundSettings, stopNodes],
  );

  const play = useCallback(async () => {
    const startPosition = positionMs >= durationMs ? 0 : positionMs;
    await startPlaybackAt(startPosition);
  }, [durationMs, positionMs, startPlaybackAt]);

  const seek = useCallback(
    (requestedPosition: number) => {
      const nextPosition = Math.max(0, Math.min(requestedPosition, durationMs));
      if (playing && nextPosition < durationMs) {
        void startPlaybackAt(nextPosition);
        return;
      }
      stopNodes();
      setPositionMs(nextPosition);
      setPlaying(false);
    },
    [durationMs, playing, startPlaybackAt, stopNodes],
  );

  const toggleMetronome = useCallback(() => {
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    if (playing) void startPlaybackAt(currentPosition(), next);
  }, [currentPosition, metronomeEnabled, playing, startPlaybackAt]);

  useEffect(() => {
    if (
      playing &&
      (startedScaleRef.current !== scale ||
        startedSoundKeyRef.current !== soundKey)
    )
      void startPlaybackAt(currentPosition());
  }, [currentPosition, playing, scale, soundKey, startPlaybackAt]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const next = currentPosition();
      if (next >= durationMs) return reset();
      setPositionMs(next);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [currentPosition, durationMs, playing, reset]);

  useEffect(() => reset, [midiBase64, reset]);

  const activeNoteId = [...timings]
    .reverse()
    .find((timing) => timing.startMs <= positionMs)?.noteId;
  return {
    playing,
    play,
    pause,
    reset,
    seek,
    positionMs,
    durationMs,
    activeNoteId,
    metronomeEnabled,
    toggleMetronome,
    audioUnavailable,
  };
}
