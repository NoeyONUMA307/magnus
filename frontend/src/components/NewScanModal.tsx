import { useState } from "react";
import yaml from "js-yaml";
import { createScan } from "../lib/api";
import type { Scan } from "../types/index";

interface NewScanModalProps {
  open: boolean;
  activeModel?: string;
  onClose: () => void;
  onCreated: (scan: Scan) => void;
  onOpenSettings: () => void;
}

export function NewScanModal({ open, activeModel, onClose, onCreated, onOpenSettings }: NewScanModalProps) {
  const [url, setUrl] = useState("");
  const [scanType, setScanType] = useState<"blackbox" | "whitebox">("blackbox");
  const [authRaw, setAuthRaw] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [specRaw, setSpecRaw] = useState("");
  const [showSpec, setShowSpec] = useState(false);
  const [writeProbes, setWriteProbes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError("URL is required");
      return;
    }

    // Auto-prepend https:// if missing
    const finalUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

    // Parse auth headers from textarea — continuation lines (no colon) append to previous header
    const authHeaders: Record<string, string> = {};
    if (authRaw.trim()) {
      let lastKey = "";
      for (const line of authRaw.split("\n")) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const colonIdx = trimmedLine.indexOf(":");
        if (colonIdx === -1) {
          if (lastKey) {
            authHeaders[lastKey] += trimmedLine;
          } else {
            setError(`Invalid header format: "${trimmedLine}". Use "Name: Value" format, e.g. Authorization: Bearer eyJ...`);
            return;
          }
          continue;
        }
        const key = trimmedLine.slice(0, colonIdx).trim();
        const value = trimmedLine.slice(colonIdx + 1).trim();
        if (!key) {
          setError(`Empty header name in: "${trimmedLine}"`);
          return;
        }
        authHeaders[key] = value;
        lastKey = key;
      }
    }

    // Parse OpenAPI spec if provided (JSON or YAML)
    let openapi_spec: Record<string, unknown> | undefined;
    if (specRaw.trim()) {
      try {
        const trimmed = specRaw.trim();
        let parsed: unknown;
        if (trimmed.startsWith("{")) {
          parsed = JSON.parse(trimmed);
        } else {
          parsed = yaml.load(trimmed);
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError("API spec must be a JSON or YAML object");
          return;
        }
        const spec = parsed as Record<string, unknown>;
        if (!spec.paths) {
          setError("Spec must have a 'paths' key — paste a full OpenAPI 3.x or Swagger 2.x document");
          return;
        }
        openapi_spec = spec;
      } catch (parseErr) {
        setError(parseErr instanceof SyntaxError ? "API spec is not valid JSON or YAML" : String(parseErr));
        return;
      }
    }

    setLoading(true);
    try {
      const hasAuth = Object.keys(authHeaders).length > 0;
      const scan = await createScan({
        url: finalUrl,
        scan_type: scanType,
        ...(hasAuth ? { auth_headers: authHeaders } : {}),
        ...(openapi_spec ? { openapi_spec } : {}),
        ...(writeProbes ? { write_probes_enabled: true } : {}),
      });
      setUrl("");
      setAuthRaw("");
      setSpecRaw("");
      setWriteProbes(false);
      onCreated(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Scan</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="2" y1="2" x2="12" y2="12" strokeLinecap="round" />
              <line x1="12" y1="2" x2="2" y2="12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label htmlFor="scan-url">Target URL</label>
            <input
              id="scan-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="modal-field">
            <label>Scan Type</label>
            <div className="modal-radio-group">
              <label className={`modal-radio${scanType === "blackbox" ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="scan_type"
                  value="blackbox"
                  checked={scanType === "blackbox"}
                  onChange={() => setScanType("blackbox")}
                  disabled={loading}
                />
                <span className="radio-label">Black-box</span>
                <span className="radio-desc">External reconnaissance only</span>
              </label>
              <label className={`modal-radio${scanType === "whitebox" ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="scan_type"
                  value="whitebox"
                  checked={scanType === "whitebox"}
                  onChange={() => setScanType("whitebox")}
                  disabled={loading}
                />
                <span className="radio-label">White-box</span>
                <span className="radio-desc">Full access, deeper analysis</span>
              </label>
            </div>
          </div>

          <div className="modal-field">
            <button
              type="button"
              className="auth-toggle"
              onClick={() => setShowAuth(!showAuth)}
            >
              <svg
                width="12" height="12" viewBox="0 0 12 12"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                style={{ transform: showAuth ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
              >
                <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Authentication
              {authRaw.trim() && <span className="auth-active-dot" />}
            </button>
            {showAuth && (
              <div className="auth-section">
                <div className="auth-format-hint">One header per line in <code>Name: Value</code> format</div>
                <textarea
                  value={authRaw}
                  onChange={(e) => setAuthRaw(e.target.value)}
                  placeholder={"Cookie: session=abc123\nAuthorization: Bearer eyJ..."}
                  rows={3}
                  disabled={loading}
                  className="auth-textarea"
                />
                <div className="auth-warning">
                  Auth credentials are stored locally. Never use production admin credentials — use a test account.
                </div>
              </div>
            )}
          </div>

          <div className="modal-field">
            <button
              type="button"
              className="auth-toggle"
              onClick={() => setShowSpec(!showSpec)}
            >
              <svg
                width="12" height="12" viewBox="0 0 12 12"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                style={{ transform: showSpec ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
              >
                <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              API Specification
              {specRaw.trim() && <span className="auth-active-dot" />}
            </button>
            {showSpec && (
              <div className="auth-section">
                <div className="auth-format-hint">Paste an OpenAPI 3.x or Swagger 2.x spec (JSON or YAML)</div>
                <textarea
                  value={specRaw}
                  onChange={(e) => setSpecRaw(e.target.value)}
                  placeholder={'{\n  "openapi": "3.0.0",\n  "paths": { ... }\n}'}
                  rows={5}
                  disabled={loading}
                  className="auth-textarea"
                />
                <div className="auth-format-hint">API endpoints from the spec will be included in the scan's attack surface</div>
              </div>
            )}
          </div>

          <div className="modal-field">
            <label className="write-probes-toggle">
              <input
                type="checkbox"
                checked={writeProbes}
                onChange={(e) => setWriteProbes(e.target.checked)}
                disabled={loading}
              />
              <div className="write-probes-label">
                <span className="write-probes-title">Active testing (write probes)</span>
                <span className="write-probes-desc">Send POST/PUT/DELETE requests to test for IDOR, auth bypass, mass assignment, and CSRF</span>
              </div>
            </label>
            {writeProbes && (
              <div className="auth-warning" style={{ marginTop: 8 }}>
                Write probes send non-destructive mutation requests with benign payloads. Only enable for targets you own and control.
              </div>
            )}
          </div>

          {activeModel && (
            <div className="modal-model-info">
              Using <strong>{activeModel}</strong>.{" "}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onClose(); onOpenSettings(); }}
              >
                Change model
              </a>
            </div>
          )}

          {error && <div className="modal-error">{error}</div>}

          <p className="settings-privacy-note">Findings are stored locally. AI analysis goes through your selected provider — change it anytime in Settings.</p>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Starting..." : "Start Scan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
