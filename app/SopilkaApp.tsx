"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Project, RenderedScore, VoiceChoice } from "./domain";
import { formatTime, ukrainianNoteName } from "./domain";
import { fingeringsForNote } from "./instrument";
import {
  bufferToBase64,
  normalizeProjectSource,
  renderProjectScore,
} from "./music";
import { createProject } from "./project";
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
} from "./storage";
import { ScoreViewer } from "./ScoreViewer";
import { FingeringDiagram } from "./FingeringDiagram";
import { usePlayback } from "./usePlayback";
import { midiBase64ToMusicXml } from "./midi-import";
import { playbackTimeForNote } from "./timeline";
import { normalizeSoundSettings, soundSettingsForPreset } from "./sound";
import type { BuiltInSoundPreset } from "./sound";

function sourceLabel(project: Project) {
  if (project.source.type === "abc") return "ABC notation";
  if (project.source.type === "mxl") return "Стиснений MusicXML";
  if (project.source.type === "midi") return "MIDI";
  return "MusicXML";
}

function sourceTempo(project: Project) {
  if (project.source.type === "abc") {
    const match = project.source.content.match(
      /^Q:\s*(?:[^=\n]*=)?\s*(\d+(?:\.\d+)?)/m,
    );
    if (match) return Number(match[1]);
  }
  if (project.source.type === "musicxml") {
    const perMinute = project.source.content.match(
      /<per-minute>\s*(\d+(?:\.\d+)?)\s*<\/per-minute>/i,
    );
    const soundTempo = project.source.content.match(
      /\btempo=["'](\d+(?:\.\d+)?)["']/i,
    );
    if (perMinute || soundTempo) return Number((perMinute ?? soundTempo)![1]);
  }
  if (project.source.type === "midi") return project.source.tempoBpm ?? 120;
  return 120;
}

export function SopilkaApp() {
  const [project, setProject] = useState<Project>(() =>
    createProject("Ода до радості"),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [voices, setVoices] = useState<VoiceChoice[]>([]);
  const [rendered, setRendered] = useState<RenderedScore>();
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [sourceOpen, setSourceOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [soundOpen, setSoundOpen] = useState(false);
  const sourceFileRef = useRef<HTMLInputElement>(null);

  const refreshProjects = async () => setProjects(await listProjects());

  useEffect(() => {
    let active = true;
    listProjects().then(async (stored) => {
      if (!active) return;
      if (stored.length) {
        setProjects(stored);
        setProject(stored[0]);
      } else {
        const initial = createProject("Ода до радості");
        await saveProject(initial);
        if (active) {
          setProject(initial);
          setProjects([initial]);
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const narrowLayout = window.matchMedia("(max-width: 1240px)");
    const closePanelsForNarrowLayout = (
      event: MediaQueryListEvent | MediaQueryList,
    ) => {
      if (event.matches) {
        setSourceOpen(false);
        setSettingsOpen(false);
      }
    };
    closePanelsForNarrowLayout(narrowLayout);
    narrowLayout.addEventListener("change", closePanelsForNarrowLayout);
    return () =>
      narrowLayout.removeEventListener("change", closePanelsForNarrowLayout);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        window.matchMedia("(max-width: 1240px)").matches
      ) {
        setSourceOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const updated = { ...project, updatedAt: new Date().toISOString() };
      saveProject(updated).then(refreshProjects);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        setProcessing(true);
        setError("");
        normalizeProjectSource(project)
          .then(
            ({
              mei,
              voices: discovered,
              title,
              tempoBpm,
              trackCount,
              voiceCount,
            }) => {
              if (!active) return;
              const selected = discovered.some(
                (voice) => voice.id === project.selectedVoice,
              )
                ? project.selectedVoice
                : (discovered[0]?.id ?? "1:1");
              setVoices(discovered);
              setProject((current) => ({
                ...current,
                source: tempoBpm
                  ? { ...current.source, tempoBpm, trackCount, voiceCount }
                  : current.source,
                normalizedMei: mei,
                title: current.title === "Нова мелодія" ? title : current.title,
                selectedVoice: selected,
                selectedPart: selected.split(":")[0],
              }));
            },
          )
          .catch((reason: unknown) => {
            if (active) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Не вдалося прочитати ноти.",
              );
              setProcessing(false);
            }
          });
      },
      project.source.type === "abc" ? 420 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // The source payload is the normalization boundary; other project settings render from normalized MEI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.source.content, project.source.type]);

  useEffect(() => {
    if (!project.normalizedMei) return;
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      setProcessing(true);
      renderProjectScore(project)
        .then((score) => {
          if (!active) return;
          setRendered(score);
          setProcessing(false);
          setError("");
          if (
            selectedNoteId &&
            !score.notes.some((note) => note.id === selectedNoteId)
          )
            setSelectedNoteId(undefined);
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Не вдалося намалювати партитуру.",
            );
            setProcessing(false);
          }
        });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
    // The selected rendering controls are intentionally the only dependencies for this expensive WASM pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project.normalizedMei,
    project.selectedVoice,
    project.tuning,
    project.tuningMode,
    project.octaveShift,
    project.chordResolutions,
  ]);

  const sound = useMemo(
    () => normalizeSoundSettings(project.sound),
    [project.sound],
  );
  const playback = usePlayback(
    rendered?.midiBase64 ?? "",
    rendered?.timings ?? [],
    project.tempoPercent,
    sound,
  );
  const selectedNote = rendered?.notes.find(
    (note) => note.id === selectedNoteId,
  );
  const selectedFingerings = selectedNote
    ? fingeringsForNote(selectedNote, project.tuning)
    : [];
  const unresolvedChords = rendered?.chords ?? [];

  const progress = playback.durationMs
    ? Math.min(100, (playback.positionMs / playback.durationMs) * 100)
    : 0;
  const baseTempo = sourceTempo(project);
  const unavailableCount = useMemo(
    () =>
      rendered?.notes.filter(
        (note) => fingeringsForNote(note, project.tuning).length === 0,
      ).length ?? 0,
    [project.tuning, rendered],
  );

  function updateProject(patch: Partial<Project>) {
    setProject((current) => ({ ...current, ...patch }));
  }

  function chooseSoundPreset(preset: BuiltInSoundPreset) {
    updateProject({ sound: soundSettingsForPreset(preset) });
  }

  function updateSoundValue(
    key: "breath" | "brightness" | "vibrato",
    value: number,
  ) {
    updateProject({ sound: { ...sound, preset: "custom", [key]: value } });
  }

  async function handleSourceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024)
      return setError("Файл завеликий. Максимальний розмір — 10 МБ.");
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "mxl" || extension === "mid" || extension === "midi") {
      const content = bufferToBase64(await file.arrayBuffer());
      if (extension === "mid" || extension === "midi") {
        try {
          const imported = midiBase64ToMusicXml(content, file.name);
          updateProject({
            title: imported.title,
            source: {
              type: "midi",
              content,
              fileName: file.name,
              tempoBpm: imported.tempoBpm,
              trackCount: imported.trackCount,
              voiceCount: imported.voiceCount,
            },
            normalizedMei: "",
            chordResolutions: {},
            fingeringOverrides: {},
          });
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не вдалося прочитати MIDI-файл.",
          );
        }
      } else {
        updateProject({
          source: { type: "mxl", content, fileName: file.name },
          normalizedMei: "",
          chordResolutions: {},
          fingeringOverrides: {},
        });
      }
    } else {
      const content = await file.text();
      updateProject({
        source: {
          type: extension === "abc" ? "abc" : "musicxml",
          content,
          fileName: file.name,
        },
        normalizedMei: "",
        chordResolutions: {},
        fingeringOverrides: {},
      });
    }
    event.target.value = "";
  }

  async function createNew() {
    const next = createProject();
    await saveProject(next);
    setProject(next);
    setRendered(undefined);
    setSelectedNoteId(undefined);
    await refreshProjects();
  }

  async function openStored(id: string) {
    const stored = await loadProject(id);
    if (stored) {
      playback.reset();
      setProject(stored);
      setRendered(undefined);
      setSelectedNoteId(undefined);
    }
  }

  async function removeCurrent() {
    if (
      !window.confirm(`Видалити проєкт «${project.title}» із цього пристрою?`)
    )
      return;
    await deleteProject(project.id);
    const remaining = await listProjects();
    if (remaining.length) setProject(remaining[0]);
    else {
      const next = createProject();
      await saveProject(next);
      setProject(next);
    }
    await refreshProjects();
  }

  function resolveChord(chordId: string, noteId: string) {
    updateProject({
      chordResolutions: { ...project.chordResolutions, [chordId]: noteId },
    });
  }

  function chooseFingering(patternId: string) {
    if (!selectedNoteId) return;
    updateProject({
      fingeringOverrides: {
        ...project.fingeringOverrides,
        [selectedNoteId]: patternId,
      },
    });
  }

  function printScore() {
    if (unresolvedChords.length)
      return setNotice("Спочатку виберіть по одній ноті в кожному акорді.");
    window.print();
  }

  function toggleSourcePanel() {
    setSourceOpen((current) => {
      const next = !current;
      if (next && window.matchMedia("(max-width: 1240px)").matches)
        setSettingsOpen(false);
      return next;
    });
  }

  function toggleSettingsPanel() {
    setSettingsOpen((current) => {
      const next = !current;
      if (next && window.matchMedia("(max-width: 1240px)").matches)
        setSourceOpen(false);
      return next;
    });
  }

  function seekToNote(noteId: string) {
    const target = playbackTimeForNote(
      rendered?.timings ?? [],
      noteId,
      playback.positionMs,
    );
    if (target !== undefined) playback.seek(target);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1 className="product-title">
          Візуалізатор аплікатур{" "}
          <>
            <br />
          </>
          хроматичної сопілки
        </h1>
        <div className="panel-toggles" aria-label="Бічні панелі">
          <button
            type="button"
            className={sourceOpen ? "active" : ""}
            aria-expanded={sourceOpen}
            aria-controls="source-panel"
            onClick={toggleSourcePanel}
          >
            <span aria-hidden="true">Джерело</span>
          </button>
          <button
            type="button"
            className={settingsOpen ? "active" : ""}
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
            onClick={toggleSettingsPanel}
          >
            <span aria-hidden="true">Налаштування</span>
          </button>
        </div>
        <div className="project-actions">
          <select
            value={project.id}
            onChange={(event) => openStored(event.target.value)}
            aria-label="Відкрити локальний проєкт"
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={createNew}>
            Новий
          </button>
          <button
            type="button"
            className="icon-danger"
            onClick={removeCurrent}
            aria-label="Видалити проєкт"
          >
            ×
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`toast ${error ? "error" : ""}`} role="alert">
          <span>{error || notice}</span>
          <button
            type="button"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {(sourceOpen || settingsOpen) && (
        <button
          type="button"
          className="panel-backdrop"
          onClick={() => {
            setSourceOpen(false);
            setSettingsOpen(false);
          }}
          aria-label="Закрити бічну панель"
        />
      )}

      <section
        className={`workspace ${sourceOpen ? "" : "source-collapsed"} ${settingsOpen ? "" : "settings-collapsed"}`}
        aria-label="Робоча область партитури"
      >
        {sourceOpen && (
          <aside className="source-panel panel" id="source-panel">
            <div className="panel-heading">
              <div>
                <small>Джерело</small>
                <h2>Введення нот</h2>
              </div>
              <button
                className="panel-close"
                type="button"
                onClick={() => setSourceOpen(false)}
                aria-label="Згорнути панель джерела"
              >
                ×
              </button>
            </div>
            <div className="source-kind">
              <span>{sourceLabel(project)}</span>
              {project.source.fileName && (
                <small>{project.source.fileName}</small>
              )}
            </div>
            {project.source.type === "abc" ? (
              <textarea
                className="abc-textarea"
                value={project.source.content}
                onChange={(event) =>
                  updateProject({
                    source: { ...project.source, content: event.target.value },
                    normalizedMei: "",
                    chordResolutions: {},
                    fingeringOverrides: {},
                  })
                }
                spellCheck={false}
                aria-label="ABC notation"
              />
            ) : (
              <div className="file-summary">
                <span className="file-symbol">♫</span>
                <strong>{project.source.fileName ?? "Нотний файл"}</strong>
                <p>
                  {project.source.type === "midi"
                    ? `${project.source.trackCount ?? 1} доріжок · ${project.source.voiceCount ?? 1} голосів. Квантування до 1/32.`
                    : "Файл обробляється локально. Для зміни нот завантажте оновлену версію."}
                </p>
              </div>
            )}
            <input
              ref={sourceFileRef}
              type="file"
              hidden
              accept=".abc,.musicxml,.xml,.mxl,.mid,.midi"
              onChange={handleSourceFile}
            />
            <button
              className="upload-button"
              type="button"
              onClick={() => sourceFileRef.current?.click()}
            >
              Завантажити ABC / MusicXML / MIDI
            </button>
            {voices.length > 1 && (
              <label className="control-label">
                Партія та голос
                <select
                  value={project.selectedVoice}
                  onChange={(event) =>
                    updateProject({
                      selectedVoice: event.target.value,
                      selectedPart: event.target.value.split(":")[0],
                      chordResolutions: {},
                    })
                  }
                >
                  {voices.map((voice) => (
                    <option value={voice.id} key={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="privacy-note">
              <i /> Ноти не залишають цей пристрій
            </div>
          </aside>
        )}

        <section className="score-panel panel">
          <div className="score-heading">
            <div>
              <small>Партитура</small>
              <input
                value={project.title}
                onChange={(event) =>
                  updateProject({ title: event.target.value })
                }
                aria-label="Назва проєкту"
              />
            </div>
            <div className="score-meta">
              <span>Сопрано · {project.tuning}</span>
              {project.octaveShift !== 0 && (
                <span>
                  {project.octaveShift > 0 ? "+1" : "−1"} октава
                </span>
              )}
              <span>{rendered?.notes.length ?? 0} нот</span>
              {unavailableCount > 0 && (
                <span className="warning-pill">
                  {unavailableCount} без аплікатури
                </span>
              )}
            </div>
          </div>
          <div className="playback-strip">
            <button
              type="button"
              onClick={playback.reset}
              aria-label="На початок"
            >
              ↶
            </button>
            <button
              className="play"
              type="button"
              onClick={playback.playing ? playback.pause : playback.play}
              aria-label={playback.playing ? "Пауза" : "Відтворити"}
            >
              {playback.playing ? "Ⅱ" : "▶"}
            </button>
            <span>{formatTime(playback.positionMs)}</span>
            <div className="timeline">
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>{formatTime(playback.durationMs)}</span>
            <strong>
              {Math.round((baseTempo * project.tempoPercent) / 100)} BPM
            </strong>
            <div className="octave-control" role="group" aria-label="Транспонування на октаву">
              {([-1, 0, 1] as const).map((shift) => (
                <button
                  key={shift}
                  type="button"
                  className={project.octaveShift === shift ? "active" : ""}
                  aria-pressed={project.octaveShift === shift}
                  title={
                    shift === -1
                      ? "Опустити всі ноти на октаву"
                      : shift === 1
                        ? "Підняти всі ноти на октаву"
                        : "Без октавного транспонування"
                  }
                  onClick={() =>
                    updateProject({
                      octaveShift: shift,
                      fingeringOverrides: {},
                    })
                  }
                >
                  {shift === -1 ? "−8" : shift === 1 ? "+8" : "0"}
                </button>
              ))}
            </div>
            <button
              className={`metronome-toggle ${playback.metronomeEnabled ? "active" : ""}`}
              type="button"
              aria-pressed={playback.metronomeEnabled}
              onClick={playback.toggleMetronome}
              title={
                playback.metronomeEnabled
                  ? "Вимкнути метроном"
                  : "Увімкнути метроном"
              }
            >
              <span aria-hidden="true">♩</span>
              <b>Метроном</b>
            </button>
          </div>
          <div className="paper-preview">
            <ScoreViewer
              rendered={rendered}
              project={project}
              selectedNoteId={selectedNoteId}
              activeNoteId={playback.activeNoteId}
              onSelectNote={setSelectedNoteId}
              onSeekNote={seekToNote}
              loading={processing}
            />
          </div>
        </section>

        {settingsOpen && (
          <aside className="settings-panel panel" id="settings-panel">
            <div className="panel-heading">
              <div>
                <small>Інструмент</small>
                <h2>Налаштування</h2>
              </div>
              <button
                className="panel-close"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Згорнути панель налаштувань"
              >
                ×
              </button>
            </div>
            <label className="control-label">
              Стрій сопілки
              <select
                value={project.tuning}
                onChange={(event) =>
                  updateProject({
                    tuning: event.target.value as Project["tuning"],
                    fingeringOverrides: {},
                  })
                }
              >
                <option>C</option>
                <option>D</option>
                <option>F</option>
                <option>G</option>
              </select>
            </label>
            <label className="control-label">
              Режим
              <select
                value={project.tuningMode}
                onChange={(event) =>
                  updateProject({
                    tuningMode: event.target.value as Project["tuningMode"],
                    fingeringOverrides: {},
                  })
                }
              >
                <option value="original-key">Оригінальна тональність</option>
                <option value="preserve-fingerings">Зберегти аплікатури</option>
              </select>
            </label>
            <label className="range-control">
              Темп <strong>{project.tempoPercent}%</strong>
              <input
                type="range"
                min="25"
                max="200"
                step="5"
                value={project.tempoPercent}
                onChange={(event) =>
                  updateProject({ tempoPercent: Number(event.target.value) })
                }
              />
            </label>
            <section className={`sound-settings ${soundOpen ? "open" : ""}`}>
              <button
                className="sound-settings-toggle"
                type="button"
                aria-expanded={soundOpen}
                aria-controls="sound-settings-content"
                onClick={() => setSoundOpen((open) => !open)}
              >
                <strong>Звук сопілки</strong>
                <span>
                  <small>
                    {sound.preset === "custom"
                      ? "Власний"
                      : sound.preset === "clean"
                        ? "Чистий"
                        : sound.preset === "soft"
                          ? "М’який"
                          : "Яскравий"}
                  </small>
                  <i aria-hidden="true">⌄</i>
                </span>
              </button>
              {soundOpen && (
                <div
                  id="sound-settings-content"
                  className="sound-settings-content"
                >
                  {playback.audioUnavailable && (
                    <p className="sound-fallback" role="status">
                      Браузер не зміг запустити аудіомодель.
                    </p>
                  )}
                  <div className="sound-presets" aria-label="Пресет звуку">
                    {(
                      [
                        ["clean", "Чистий"],
                        ["soft", "М’який"],
                        ["bright", "Яскравий"],
                      ] as const
                    ).map(([preset, label]) => (
                      <button
                        key={preset}
                        type="button"
                        className={sound.preset === preset ? "active" : ""}
                        aria-pressed={sound.preset === preset}
                        onClick={() => chooseSoundPreset(preset)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="range-control sound-range">
                    Повітря <strong>{sound.breath}%</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={sound.breath}
                      onChange={(event) =>
                        updateSoundValue("breath", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="range-control sound-range">
                    Яскравість <strong>{sound.brightness}%</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={sound.brightness}
                      onChange={(event) =>
                        updateSoundValue(
                          "brightness",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label className="range-control sound-range">
                    Вібрато <strong>{sound.vibrato}%</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={sound.vibrato}
                      onChange={(event) =>
                        updateSoundValue("vibrato", Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              )}
            </section>
            <div className="toggle-row">
              <span>Назви нот</span>
              <button
                type="button"
                role="switch"
                aria-checked={project.display.showNoteNames}
                className={project.display.showNoteNames ? "on" : ""}
                onClick={() =>
                  updateProject({
                    display: {
                      ...project.display,
                      showNoteNames: !project.display.showNoteNames,
                    },
                  })
                }
              >
                <i />
              </button>
            </div>
            <div className="toggle-row">
              <span>Діаграми</span>
              <button
                type="button"
                role="switch"
                aria-checked={project.display.showFingerings}
                className={project.display.showFingerings ? "on" : ""}
                onClick={() =>
                  updateProject({
                    display: {
                      ...project.display,
                      showFingerings: !project.display.showFingerings,
                    },
                  })
                }
              >
                <i />
              </button>
            </div>

            {unresolvedChords.length > 0 && (
              <div className="issues-card">
                <strong>Потрібен вибір ноти</strong>
                {unresolvedChords.map((chord) => (
                  <div key={chord.id}>
                    <small>Такт {chord.measure}</small>
                    <div>
                      {chord.notes.map((note) => (
                        <button
                          type="button"
                          key={note.id}
                          onClick={() => resolveChord(chord.id, note.id)}
                        >
                          {ukrainianNoteName(note)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedNote ? (
              <div className="note-inspector">
                <div className="inspector-heading">
                  <div>
                    <small>Вибрана нота</small>
                    <strong>{ukrainianNoteName(selectedNote)}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedNoteId(undefined)}
                  >
                    ×
                  </button>
                </div>
                {selectedFingerings.length ? (
                  <div className="fingering-options">
                    {selectedFingerings.map((pattern) => (
                      <button
                        type="button"
                        key={pattern.id}
                        className={
                          project.fingeringOverrides[selectedNote.id] ===
                            pattern.id ||
                          (!project.fingeringOverrides[selectedNote.id] &&
                            pattern.isDefault)
                            ? "active"
                            : ""
                        }
                        onClick={() => chooseFingering(pattern.id)}
                      >
                        <FingeringDiagram pattern={pattern} compact />
                        <span>
                          {pattern.kind === "primary"
                            ? "Основна"
                            : pattern.kind === "alternate"
                              ? "Альтернативна"
                              : "Квінтова"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>Для цієї висоти в таблиці немає аплікатури.</p>
                )}
              </div>
            ) : (
              <div className="tip-card">
                <strong>Натисніть на діаграму</strong>
                <p>
                  Тут можна вибрати альтернативну або квінтову аплікатуру для
                  окремої ноти.
                </p>
              </div>
            )}

            <button
              className="print-button"
              type="button"
              disabled={unresolvedChords.length > 0}
              onClick={printScore}
            >
              Друк / PDF
            </button>
          </aside>
        )}
      </section>
    </main>
  );
}
