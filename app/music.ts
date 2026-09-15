import DOMPurify from "dompurify";
import type { Project, RenderedScore, ScoreChord, ScoreNote, VoiceChoice } from "./domain";
import { scoreTransposition } from "./domain";
import { buildPlaybackTimings } from "./timeline";
import type { TimemapEvent } from "./timeline";
import { midiBase64ToMusicXml } from "./midi-import";

type Toolkit = {
  destroy(): void;
  resetOptions(): void;
  resetXmlIdSeed(seed: number): void;
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  loadZipDataBuffer(data: ArrayBuffer): boolean;
  getMEI(options?: Record<string, unknown>): string;
  getLog(): string;
  getPageCount(): number;
  renderToSVG(page: number): string;
  renderToMIDI(): string;
  renderToTimemap(options?: Record<string, unknown>): TimemapEvent[];
  getExpansionIdsForElement(id: string): string[];
};

let modulePromise: Promise<unknown> | null = null;

// Keep horizontal distance tied to elapsed musical time. At 1.0 Verovio uses
// proportional duration spacing; the smaller linear factor keeps the score at
// roughly the same density as the previous, compressed layout.
export const RHYTHMIC_SPACING_OPTIONS = {
  spacingLinear: 0.03,
  spacingNonLinear: 1,
} as const;

async function makeToolkit(): Promise<Toolkit> {
  modulePromise ??= import("verovio/wasm").then((module) => module.default());
  const [verovioModule, toolkitModule] = await Promise.all([modulePromise, import("verovio/esm")]);
  return new toolkitModule.VerovioToolkit(verovioModule) as Toolkit;
}

function xmlDocument(xml: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("Не вдалося прочитати структуру нотного файла.");
  return document;
}

function elements(document: Document | Element, name: string) {
  return Array.from(document.getElementsByTagNameNS("*", name));
}

function setXmlId(element: Element, id: string) {
  element.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:id", id);
}

function getXmlId(element: Element) {
  return element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") ?? element.getAttribute("xml:id") ?? element.getAttribute("id") ?? "";
}

function accidentalValue(value: string | null) {
  const table: Record<string, number> = { s: 1, f: -1, n: 0, ss: 2, x: 2, ff: -2, ts: 3, tf: -3 };
  return table[value ?? ""] ?? 0;
}

function noteFromElement(note: Element, measure: number, chordId?: string): ScoreNote {
  const pname = note.getAttribute("pname")?.toLowerCase() ?? "c";
  const octave = Number(note.getAttribute("oct") ?? 4);
  const accidental = accidentalValue(note.getAttribute("accid.ges") ?? note.getAttribute("accid"));
  const pitchClass: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  return {
    id: getXmlId(note),
    writtenMidi: (octave + 1) * 12 + (pitchClass[pname] ?? 0) + accidental,
    pname,
    octave,
    accidental,
    measure,
    chordId,
  };
}

function assignDeterministicIds(document: Document) {
  elements(document, "measure").forEach((measure, measureIndex) => {
    if (!getXmlId(measure)) setXmlId(measure, `measure-${measureIndex + 1}`);
    let noteIndex = 0;
    elements(measure, "chord").forEach((chord, chordIndex) => {
      if (!getXmlId(chord)) setXmlId(chord, `chord-${measureIndex + 1}-${chordIndex + 1}`);
    });
    elements(measure, "note").forEach((note) => {
      if (!getXmlId(note)) setXmlId(note, `note-${measureIndex + 1}-${++noteIndex}`);
    });
  });
}

function filterVoice(document: Document, selectedVoice: string) {
  const [staffN = "1", layerN = "1"] = selectedVoice.split(":");
  elements(document, "staff").forEach((staff) => {
    if ((staff.getAttribute("n") ?? "1") !== staffN) staff.remove();
  });
  elements(document, "staffDef").forEach((staffDef) => {
    if ((staffDef.getAttribute("n") ?? "1") !== staffN) staffDef.remove();
  });
  elements(document, "layer").forEach((layer) => {
    const parentStaff = layer.closest("staff");
    if (parentStaff && (layer.getAttribute("n") ?? "1") !== layerN) layer.remove();
  });
  elements(document, "staffGrp").forEach((group) => {
    if (!elements(group, "staffDef").length) group.remove();
  });
}

function applySopranoConvention(document: Document, sourceType: Project["source"]["type"]) {
  elements(document, "staffDef").forEach((staffDef) => {
    // MIDI stores sounding pitches. Adding the soprano octave transposition
    // again would render playback one octave too high, so preserve it verbatim.
    if (sourceType === "midi") return;
    const sourceTransposition = Number(staffDef.getAttribute("trans.semi") ?? 0);
    if (Math.abs(sourceTransposition) !== 12) staffDef.setAttribute("trans.semi", "12");
    if (staffDef.getAttribute("clef.dis") !== "8") {
      staffDef.setAttribute("clef.dis", "8");
      staffDef.setAttribute("clef.dis.place", "above");
    }
  });
}

function resolveChords(document: Document, resolutions: Record<string, string>) {
  elements(document, "chord").forEach((chord) => {
    const chordId = getXmlId(chord);
    const resolution = resolutions[chordId];
    const chordNotes = elements(chord, "note");
    if (!resolution || chordNotes.length < 2) return;
    chordNotes.forEach((note) => { if (getXmlId(note) !== resolution) note.remove(); });
  });
}

function extractScore(document: Document) {
  const notes: ScoreNote[] = [];
  const chords: ScoreChord[] = [];
  elements(document, "measure").forEach((measure, measureIndex) => {
    elements(measure, "chord").forEach((chord) => {
      const chordId = getXmlId(chord);
      const chordNotes = elements(chord, "note").map((note) => noteFromElement(note, measureIndex + 1, chordId));
      if (chordNotes.length > 1) chords.push({ id: chordId, measure: measureIndex + 1, notes: chordNotes });
    });
    elements(measure, "note").forEach((note) => notes.push(noteFromElement(note, measureIndex + 1, note.closest("chord") ? getXmlId(note.closest("chord")!) : undefined)));
  });
  return { notes, chords };
}

export function discoverVoices(mei: string): VoiceChoice[] {
  const document = xmlDocument(mei);
  const labels = new Map<string, string>();
  elements(document, "staffDef").forEach((staffDef) => {
    const n = staffDef.getAttribute("n") ?? "1";
    labels.set(n, staffDef.getAttribute("label") ?? staffDef.getAttribute("label.abbr") ?? `Партія ${n}`);
  });
  const choices = new Map<string, VoiceChoice>();
  elements(document, "layer").forEach((layer) => {
    const staff = layer.closest("staff");
    const staffN = staff?.getAttribute("n") ?? "1";
    const layerN = layer.getAttribute("n") ?? "1";
    const id = `${staffN}:${layerN}`;
    choices.set(id, { id, staffN, layerN, label: `${labels.get(staffN) ?? `Партія ${staffN}`} · голос ${layerN}` });
  });
  return [...choices.values()];
}

export function scoreTitle(mei: string, fallback: string) {
  const document = xmlDocument(mei);
  const title = elements(document, "title").map((element) => element.textContent?.trim()).find(Boolean);
  return title || fallback;
}

function base64ToBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function normalizeProjectSource(project: Project) {
  const toolkit = await makeToolkit();
  try {
    const midiImport = project.source.type === "midi" ? midiBase64ToMusicXml(project.source.content, project.source.fileName) : undefined;
    toolkit.resetXmlIdSeed(1000);
    toolkit.setOptions({ inputFrom: project.source.type === "abc" ? "abc" : "xml", breaks: "encoded" });
    const loaded = project.source.type === "mxl" ? toolkit.loadZipDataBuffer(base64ToBuffer(project.source.content)) : toolkit.loadData(midiImport?.musicXml ?? project.source.content);
    if (!loaded) throw new Error(toolkit.getLog() || "Формат не підтримується або файл пошкоджено.");
    const mei = toolkit.getMEI();
    if (!mei) throw new Error(toolkit.getLog() || "У файлі не знайдено нотної партитури.");
    return {
      mei,
      voices: discoverVoices(mei),
      title: scoreTitle(mei, midiImport?.title || project.source.fileName?.replace(/\.[^.]+$/, "") || project.title),
      tempoBpm: midiImport?.tempoBpm,
      trackCount: midiImport?.trackCount,
      voiceCount: midiImport?.voiceCount,
    };
  } finally {
    toolkit.destroy();
  }
}

function prepareMei(project: Project) {
  const document = xmlDocument(project.normalizedMei);
  assignDeterministicIds(document);
  filterVoice(document, project.selectedVoice);
  applySopranoConvention(document, project.source.type);
  resolveChords(document, project.chordResolutions);
  return new XMLSerializer().serializeToString(document);
}

export function sanitizeSvg(svg: string) {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["href", "xlink:href"],
    FORBID_TAGS: ["script", "foreignObject", "image", "a"],
    FORBID_ATTR: ["onload", "onclick"],
  });

  // Verovio draws SMuFL glyphs with <use href="#glyph-id">. Those local
  // references are part of the SVG itself and must survive sanitizing, while
  // every external URL remains forbidden.
  // Do not parse the sanitized output as strict XML again: Verovio metadata
  // can contain browser-safe named entities that an XML parser rejects.
  const template = globalThis.document.createElement("template");
  template.innerHTML = sanitized;
  const root = template.content.querySelector("svg");
  if (!root) throw new Error("Не вдалося очистити SVG партитури.");

  [root, ...root.querySelectorAll("*")].forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "src") element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !/^#[A-Za-z_][\w:.-]*$/.test(value)) {
        element.removeAttribute(attribute.name);
      }
      if (name === "style" && /(?:https?:|data:|javascript:|@import)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  root.querySelectorAll("style").forEach((style) => {
    if (/(?:https?:|data:|javascript:|@import)/i.test(style.textContent ?? "")) style.remove();
  });
  return root.outerHTML;
}

export async function renderProjectScore(project: Project, pageWidth = 1450): Promise<RenderedScore> {
  const toolkit = await makeToolkit();
  try {
    const prepared = prepareMei(project);
    toolkit.resetXmlIdSeed(1000);
    const transpose = scoreTransposition(
      project.tuning,
      project.tuningMode,
      project.octaveShift,
    );
    toolkit.setOptions({
      inputFrom: "mei",
      pageWidth,
      pageHeight: 1900,
      scale: 42,
      breaks: "auto",
      spacingSystem: 12,
      ...RHYTHMIC_SPACING_OPTIONS,
      adjustPageHeight: true,
      pageMarginTop: 35,
      pageMarginBottom: 35,
      pageMarginLeft: 35,
      pageMarginRight: 35,
      header: "none",
      footer: "none",
      ...(transpose ? { transpose } : {}),
    });
    if (!toolkit.loadData(prepared)) throw new Error(toolkit.getLog() || "Не вдалося підготувати партитуру.");
    const effectiveMei = toolkit.getMEI();
    const effectiveDocument = xmlDocument(effectiveMei);
    assignDeterministicIds(effectiveDocument);
    const { notes, chords } = extractScore(effectiveDocument);
    const pages = Array.from({ length: toolkit.getPageCount() }, (_, index) => sanitizeSvg(toolkit.renderToSVG(index + 1)));
    const midiBase64 = toolkit.renderToMIDI();
    const timings = buildPlaybackTimings(
      notes,
      toolkit.renderToTimemap({ includeRests: true }),
      (id) => toolkit.getExpansionIdsForElement(id),
    );
    return { pages, notes, chords, midiBase64, timings, mei: effectiveMei };
  } finally {
    toolkit.destroy();
  }
}
