interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  activeModel?: string;
}

export function AboutModal({ open, onClose, activeModel }: AboutModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-logo">
          <svg width="32" height="32" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 1L2 3.5V7.5C2 10.2 4.2 12.7 7 13.5C9.8 12.7 12 10.2 12 7.5V3.5L7 1Z"
              fill="var(--text)"
              opacity="0.9"
            />
          </svg>
        </div>

        <h2 className="about-title">Magnus</h2>
        <div className="about-version">v1.0.0</div>

        <p className="about-desc">
          AI-powered security scanner for solo developers. Magnus crawls your
          app, identifies misconfigurations and common vulnerabilities, and
          tells you how to fix them. It catches real issues — exposed secrets,
          CORS misconfigs, missing headers, XSS — but it's not a substitute
          for a professional security audit.
        </p>

        <div className="about-divider" />

        <div className="about-specs">
          <div className="about-spec">
            <span className="about-spec-key">Engine</span>
            <span className="about-spec-val">5-phase agent pipeline</span>
          </div>
          <div className="about-spec">
            <span className="about-spec-key">Probes</span>
            <span className="about-spec-val">Read-only + write probes (opt-in)</span>
          </div>
          <div className="about-spec">
            <span className="about-spec-key">Active Model</span>
            <span className="about-spec-val">{activeModel || "—"}</span>
          </div>
          <div className="about-spec">
            <span className="about-spec-key">Data</span>
            <span className="about-spec-val">Local only (SQLite)</span>
          </div>
        </div>

        <div className="about-divider" />

        <div className="about-footer">
          Findings marked "Suspected" are LLM inference, not confirmed exploits.
          Always verify before acting. Not for unauthorized use.
        </div>

        <button className="modal-close" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: "16px", right: "16px" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="2" y1="2" x2="12" y2="12" strokeLinecap="round" />
            <line x1="12" y1="2" x2="2" y2="12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
