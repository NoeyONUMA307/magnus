import type { AttackSurfaceCategory } from "../types/index";

interface AttackSurfaceProps {
  categories: AttackSurfaceCategory[];
}

export function AttackSurface({ categories }: AttackSurfaceProps) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-label">Attack Surface</span>
      </div>
      <div className="card-body">
        {categories.length === 0 ? (
          <div className="empty-state" style={{ padding: "var(--s-24)" }}>
            <div className="empty-state-sub">No attack surface data</div>
          </div>
        ) : (
          <div className="surface-rows">
            {categories.map((cat) => {
              const pct = cat.maxCount > 0 ? (cat.count / cat.maxCount) * 100 : 0;
              return (
                <div key={cat.name} className="surface-row">
                  <span
                    className="surface-dot"
                    style={{ background: cat.color }}
                  />
                  <span className="surface-name">{cat.name}</span>
                  <div className="surface-bar">
                    <div
                      className="surface-bar-fill"
                      style={{ width: `${pct}%`, background: cat.color }}
                    />
                  </div>
                  <span className="surface-count">{cat.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
