import type { SeverityCounts } from "../types/index";

interface SeverityBarsProps {
  counts: SeverityCounts;
}

interface SevRow {
  label: string;
  key: keyof SeverityCounts;
  color: string;
}

const ROWS: SevRow[] = [
  { label: "Critical", key: "critical", color: "var(--crit)" },
  { label: "High", key: "high", color: "var(--high)" },
  { label: "Medium", key: "medium", color: "var(--med)" },
  { label: "Low", key: "low", color: "var(--low)" },
  { label: "Info", key: "info", color: "var(--text-3)" },
];

export function SeverityBars({ counts }: SeverityBarsProps) {
  const max = Math.max(
    counts.critical,
    counts.high,
    counts.medium,
    counts.low,
    counts.info,
    1
  );

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-label">Severity Distribution</span>
      </div>
      <div className="card-body">
        <div className="sev-bars">
          {ROWS.map((row) => {
            const count = counts[row.key];
            const pct = (count / max) * 100;
            return (
              <div key={row.key} className="sev-row">
                <span className="sev-row-label">{row.label}</span>
                <div className="sev-track">
                  <div
                    className="sev-fill"
                    style={{ width: `${pct}%`, background: row.color }}
                  />
                </div>
                <span className="sev-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
