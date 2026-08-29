import type { FingeringPattern } from "./domain";
import { SOPILKA_PROFILE } from "./instrument";

export function FingeringDiagram({ pattern, compact = false }: { pattern?: FingeringPattern; compact?: boolean }) {
  const width = compact ? 24 : 38;
  const height = compact ? 68 : 108;
  if (!pattern) {
    return <span className="missing-fingering" title="Немає аплікатури" aria-label="Немає аплікатури">!</span>;
  }
  return (
    <svg className="fingering-svg" width={width} height={height} viewBox="0 0 34 96" role="img" aria-label={`Аплікатура: ${pattern.kind === "primary" ? "основна" : pattern.kind === "alternate" ? "альтернативна" : "квінтове передування"}`}>
      <rect x="13" y="4" width="16" height="88" rx="5" fill="#FFFCF7" stroke="currentColor" strokeWidth="1.4" />
      <rect x="12" y="2" width="18" height="7" rx="2" fill="#FFFCF7" stroke="currentColor" strokeWidth="1.4" />
      {SOPILKA_PROFILE.holeLayout.map((hole) => {
        const state = pattern.holes[hole.id];
        return <circle key={hole.id} cx={hole.x} cy={hole.y} r={state === "half" ? 3.2 : 3} fill={state === "closed" ? "currentColor" : "#FFFCF7"} stroke="currentColor" strokeWidth="1.2" className={state === "half" ? "half-hole" : undefined} />;
      })}
      {pattern.kind === "quint-overblow" && <text x="28" y="90" fontSize="8" fontWeight="700" fill="#B3212E">Q</text>}
    </svg>
  );
}
