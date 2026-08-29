"use client";

import { FingeringDiagram } from "./FingeringDiagram";
import { FINGERING_SOURCE_URL, SOPILKA_PROFILE, validateProfile } from "./instrument";

const PITCH_NAMES = ["До", "До♯", "Ре", "Ре♯", "Мі", "Фа", "Фа♯", "Соль", "Соль♯", "Ля", "Сі♭", "Сі"];

export function ProfileReview({ onClose }: { onClose(): void }) {
  const grouped = new Map<number, typeof SOPILKA_PROFILE.fingerings>();
  SOPILKA_PROFILE.fingerings.forEach((pattern) => grouped.set(pattern.pitchOffsetFromBase, [...(grouped.get(pattern.pitchOffsetFromBase) ?? []), pattern]));
  const errors = validateProfile(SOPILKA_PROFILE);
  return (
    <div className="profile-screen" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header><div><span className="eyebrow">Перевірка джерела</span><h2 id="profile-title">Аплікатури сопрано in C</h2></div><button type="button" onClick={onClose} aria-label="Закрити">×</button></header>
      <div className="profile-status"><span>Очікує ручного звірення</span><p>Схеми оцифровані з <a href={FINGERING_SOURCE_URL} target="_blank" rel="noreferrer">таблиці Sopilka Acropolis</a>. Основні й альтернативні варіанти потрібно звірити перед позначенням профілю як перевіреного.</p></div>
      {errors.length > 0 && <div className="error-banner">{errors.join(" · ")}</div>}
      <div className="profile-grid">
        {[...grouped.entries()].map(([offset, patterns]) => (
          <article key={offset}><div className="profile-note"><strong>{PITCH_NAMES[offset % 12]}</strong><small>{Math.floor(offset / 12) + 1} октава · схема {offset + 1}</small></div><div className="profile-patterns">{patterns.map((pattern) => <div key={pattern.id}><FingeringDiagram pattern={pattern} compact /><span>{pattern.kind === "primary" ? "основна" : pattern.kind === "alternate" ? "варіант" : "квінта"}</span></div>)}</div></article>
        ))}
      </div>
    </div>
  );
}
