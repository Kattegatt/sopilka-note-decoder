import type { SoundPreset, SoundSettings } from "./domain";

export type BuiltInSoundPreset = Exclude<SoundPreset, "custom">;

export const SOUND_PRESETS: Record<BuiltInSoundPreset, SoundSettings> = {
  clean: { preset: "clean", breath: 10, brightness: 52, vibrato: 8 },
  soft: { preset: "soft", breath: 34, brightness: 34, vibrato: 20 },
  bright: { preset: "bright", breath: 42, brightness: 78, vibrato: 30 },
};

export const DEFAULT_SOUND_SETTINGS: SoundSettings = SOUND_PRESETS.soft;

function clampPercent(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}

export function soundSettingsForPreset(
  preset: BuiltInSoundPreset,
): SoundSettings {
  return { ...SOUND_PRESETS[preset] };
}

export function normalizeSoundSettings(value: unknown): SoundSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SOUND_SETTINGS };
  const candidate = value as Partial<SoundSettings>;
  const preset: SoundPreset = ["clean", "soft", "bright", "custom"].includes(candidate.preset ?? "")
    ? candidate.preset as SoundPreset
    : "custom";
  return {
    preset,
    breath: clampPercent(candidate.breath, DEFAULT_SOUND_SETTINGS.breath),
    brightness: clampPercent(candidate.brightness, DEFAULT_SOUND_SETTINGS.brightness),
    vibrato: clampPercent(candidate.vibrato, DEFAULT_SOUND_SETTINGS.vibrato),
  };
}
