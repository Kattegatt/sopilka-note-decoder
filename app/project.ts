import type { Project } from "./domain";
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from "./sound";

export const DEFAULT_ABC = `X:1
T:Ода до радості
C:Людвіг ван Бетховен
M:4/4
L:1/4
Q:1/4=92
K:C
|: E E F G | G F E D | C C D E | E3/2 D/2 D2 |
   E E F G | G F E D | C C D E | D3/2 C/2 C2 :|`;

export function createProject(title = "Нова мелодія"): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}`,
    title,
    source: { type: "abc", content: DEFAULT_ABC },
    normalizedMei: "",
    selectedPart: "1",
    selectedVoice: "1:1",
    tuning: "C",
    tuningMode: "original-key",
    octaveShift: 0,
    tempoPercent: 100,
    sound: { ...DEFAULT_SOUND_SETTINGS },
    fingeringOverrides: {},
    chordResolutions: {},
    display: { showNoteNames: true, showFingerings: true },
    updatedAt: now,
  };
}

export function withProjectDefaults(project: Project): Project {
  const octaveShift = [-1, 0, 1].includes(project.octaveShift)
    ? project.octaveShift
    : 0;
  return {
    ...project,
    octaveShift: octaveShift as Project["octaveShift"],
    sound: normalizeSoundSettings(project.sound),
  };
}
