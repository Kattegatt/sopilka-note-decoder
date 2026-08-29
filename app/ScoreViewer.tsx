"use client";

import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Project, RenderedScore, ScoreNote } from "./domain";
import { ukrainianNoteName } from "./domain";
import { defaultFingering } from "./instrument";
import { FingeringDiagram } from "./FingeringDiagram";

interface Overlay {
  page: number;
  note: ScoreNote;
  left: number;
  top: number;
  staffKey: string;
  staffTop: number;
  staffBottom: number;
}

const NotationSvg = memo(function NotationSvg({ svg }: { svg: string }) {
  return <div className="notation-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
});

export function ScoreViewer({ rendered, project, selectedNoteId, activeNoteId, onSelectNote, onSeekNote, loading }: {
  rendered?: RenderedScore;
  project: Project;
  selectedNoteId?: string;
  activeNoteId?: string;
  onSelectNote(id: string): void;
  onSeekNote(id: string): void;
  loading: boolean;
}) {
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);

  const positionOverlays = useCallback(() => {
    if (!rendered) return setOverlays([]);
    const found: Overlay[] = [];
    pageRefs.current.forEach((page, pageIndex) => {
      if (!page) return;
      const pageBounds = page.getBoundingClientRect();
      rendered.notes.forEach((note) => {
        const element = page.querySelector<SVGGElement>(`g.note#${CSS.escape(note.id)}`);
        if (!element) return;
        const noteBounds = element.getBoundingClientRect();
        const staff = element.closest<SVGGElement>("g.staff");
        const staffBounds = staff?.getBoundingClientRect() ?? noteBounds;
        found.push({
          page: pageIndex,
          note,
          left: noteBounds.left - pageBounds.left + noteBounds.width / 2,
          top: staffBounds.bottom - pageBounds.top + 11,
          staffKey: staff?.id || `staff-${pageIndex}-${Math.round(staffBounds.top)}`,
          staffTop: staffBounds.top - pageBounds.top - 18,
          staffBottom: staffBounds.bottom - pageBounds.top + 18,
        });
      });
    });
    setOverlays(found);
  }, [rendered]);

  const seekFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>, pageIndex: number) => {
    if (!rendered) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const exactNote = target?.closest<SVGGElement>("g.note");
    if (exactNote?.id && rendered.notes.some((note) => note.id === exactNote.id)) {
      onSeekNote(exactNote.id);
      return;
    }

    const page = pageRefs.current[pageIndex];
    if (!page) return;
    const pageBounds = page.getBoundingClientRect();
    const pointerX = event.clientX - pageBounds.left;
    const pointerY = event.clientY - pageBounds.top;
    const candidates = overlays.filter((overlay) =>
      overlay.page === pageIndex && pointerY >= overlay.staffTop && pointerY <= overlay.staffBottom,
    );
    if (!candidates.length) return;
    const closestStaff = candidates.reduce((closest, candidate) =>
      Math.abs((candidate.staffTop + candidate.staffBottom) / 2 - pointerY) < Math.abs((closest.staffTop + closest.staffBottom) / 2 - pointerY) ? candidate : closest,
    ).staffKey;
    const nearest = candidates.filter((candidate) => candidate.staffKey === closestStaff).reduce((closest, candidate) =>
      Math.abs(candidate.left - pointerX) < Math.abs(closest.left - pointerX) ? candidate : closest,
    );
    onSeekNote(nearest.note.id);
  }, [onSeekNote, overlays, rendered]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(positionOverlays);
    const observer = new ResizeObserver(positionOverlays);
    pageRefs.current.forEach((page) => page && observer.observe(page));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [positionOverlays]);

  useLayoutEffect(() => {
    pageRefs.current.forEach((page) => {
      page?.querySelectorAll("g.note").forEach((note) => note.classList.toggle("current-note", note.id === activeNoteId));
    });
  }, [activeNoteId]);

  if (!rendered) {
    return <div className="score-empty" role="status"><div className="loader-ring" /><h3>{loading ? "Готуємо партитуру…" : "Додайте нотний матеріал"}</h3><p>ABC, MusicXML або MIDI буде оброблено лише на цьому пристрої.</p></div>;
  }

  return (
    <div className={`score-pages ${loading ? "is-updating" : ""}`} aria-busy={loading}>
      {rendered.pages.map((svg, pageIndex) => (
        <div
          className="score-page"
          key={pageIndex}
          ref={(element) => { pageRefs.current[pageIndex] = element; }}
          style={{ minHeight: overlays.filter((overlay) => overlay.page === pageIndex).reduce((height, overlay) => Math.max(height, overlay.top + 88), 0) || undefined }}
          onPointerDown={(event) => seekFromPointer(event, pageIndex)}
        >
          <NotationSvg svg={svg} />
          {overlays.filter((overlay) => overlay.page === pageIndex).map(({ note, left, top }) => {
            const pattern = defaultFingering(note, project.tuning, project.fingeringOverrides[note.id]);
            return (
              <button
                type="button"
                key={note.id}
                data-note-id={note.id}
                className={`note-fingering ${selectedNoteId === note.id ? "selected" : ""} ${activeNoteId === note.id ? "current" : ""} ${pattern ? "" : "unavailable"}`}
                style={{ left, top }}
                onPointerDown={(event) => { event.stopPropagation(); onSelectNote(note.id); }}
                aria-label={`${ukrainianNoteName(note)}. ${pattern ? "Відкрити варіанти аплікатури" : "Аплікатура недоступна"}`}
              >
                {project.display.showNoteNames && <span>{ukrainianNoteName(note)}</span>}
                {project.display.showFingerings && <FingeringDiagram pattern={pattern} compact />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
