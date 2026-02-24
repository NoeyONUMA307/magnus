import { useCallback, useEffect, useState } from "react";
import { getSettings, updateSetting, getOllamaModels } from "../lib/api";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ModelOption {
  id: string;
  label: string;
  desc: string;
}

const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "Claude Opus 4.6, Sonnet 4.6, Haiku 4.5",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", desc: "most capable" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", desc: "fast + capable" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", desc: "fastest, cheapest" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "GPT-5.2, GPT-5.1, o4-mini, GPT-4o",
    models: [
      { id: "gpt-5.2", label: "GPT-5.2", desc: "most capable" },
      { id: "gpt-5.1", label: "GPT-5.1", desc: "very capable" },
      { id: "o4-mini", label: "o4-mini", desc: "strong reasoning, low cost" },
      { id: "gpt-4o", label: "GPT-4o", desc: "reliable baseline" },
    ],
  },
  {
    id: "ollama",
    name: "Local (Ollama)",
    desc: "Nothing leaves your machine",
    models: [] as ModelOption[],
  },
];

const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical", desc: "Only critical findings" },
  { value: "high", label: "High", desc: "Critical + high" },
  { value: "medium", label: "Medium", desc: "Critical + high + medium" },
  { value: "low", label: "Low", desc: "Everything except info" },
  { value: "info", label: "Info", desc: "All findings" },
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-opus-4-6");
  const [minSeverity, setMinSeverity] = useState("low");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    getSettings().then((s) => {
      if (s.llm_provider) setProvider(s.llm_provider);
      if (s.llm_model) setModel(s.llm_model);
      if (s.min_severity) setMinSeverity(s.min_severity);
    }).catch(() => {});
  }, [open]);

  // Fetch Ollama models when Ollama is selected
  useEffect(() => {
    if (provider !== "ollama") return;
    setOllamaAvailable(null);
    getOllamaModels()
      .then((data) => {
        setOllamaAvailable(data.available);
        const models = data.models.map((m) => ({
          id: m.id,
          label: m.name,
          desc: m.size,
        }));
        setOllamaModels(models);
        if (models.length > 0 && !models.some((m) => m.id === model)) {
          setModel(models[0]!.id);
        }
      })
      .catch(() => {
        setOllamaAvailable(false);
        setOllamaModels([]);
      });
  }, [provider]);

  const handleProviderChange = useCallback((p: string) => {
    setProvider(p);
    const prov = PROVIDERS.find((x) => x.id === p);
    if (prov && prov.id !== "ollama" && prov.models[0]) {
      setModel(prov.models[0].id);
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSetting("llm_provider", provider);
      await updateSetting("llm_model", model);
      await updateSetting("min_severity", minSeverity);
      setSaved(true);
      setTimeout(() => onClose(), 800);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }, [provider, model, minSeverity, onClose]);

  if (!open) return null;

  const isOllama = provider === "ollama";
  const activeModels = isOllama
    ? ollamaModels
    : (PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]!).models;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="3" x2="11" y2="11" strokeLinecap="round" />
            <line x1="11" y1="3" x2="3" y2="11" strokeLinecap="round" />
          </svg>
        </button>

        <h2 className="modal-title">Settings</h2>
        <p className="modal-sub">Configure the AI model used for security scanning.</p>

        <div className="settings-section">
          <label className="field-label">Provider</label>
          <div className="provider-cards">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`provider-card${provider === p.id ? " selected" : ""}`}
                onClick={() => handleProviderChange(p.id)}
              >
                <span className="provider-card-name">{p.name}</span>
                <span className="provider-card-models">{p.desc}</span>
              </button>
            ))}
          </div>
          {isOllama ? (
            <>
              <p className="settings-privacy-note">Full privacy — nothing leaves your machine.</p>
              <div className="auth-warning" style={{ marginTop: 6 }}>Local models are significantly less capable at security analysis than Claude or GPT. Expect more false positives and shallower findings. Best for testing the pipeline without burning API credits.</div>
            </>
          ) : (
            <p className="settings-privacy-note">AI analysis is routed through your selected provider. Scan results and findings are always stored locally on your machine.</p>
          )}
        </div>

        <div className="settings-section">
          <label className="field-label">Model</label>
          {isOllama && ollamaAvailable === null ? (
            <p className="settings-hint">Checking for Ollama...</p>
          ) : isOllama && ollamaAvailable === false ? (
            <p className="settings-hint">Ollama not detected. Make sure Ollama is running on <code>localhost:11434</code>.</p>
          ) : isOllama && activeModels.length === 0 ? (
            <p className="settings-hint">No models installed. Run <code>ollama pull llama3.2</code> to get started.</p>
          ) : (
            <div className="model-options">
              {activeModels.map((m) => (
                <label
                  key={m.id}
                  className={`model-option${model === m.id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={m.id}
                    checked={model === m.id}
                    onChange={() => setModel(m.id)}
                  />
                  <span className="model-option-label">{m.label}</span>
                  <span className="model-option-desc">{m.desc}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="settings-section">
          <label className="field-label">Severity Threshold</label>
          <div className="model-options">
            {SEVERITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`model-option${minSeverity === opt.value ? " selected" : ""}`}
              >
                <input
                  type="radio"
                  name="min_severity"
                  value={opt.value}
                  checked={minSeverity === opt.value}
                  onChange={() => setMinSeverity(opt.value)}
                />
                <span className="model-option-label">{opt.label}</span>
                <span className="model-option-desc">{opt.desc}</span>
              </label>
            ))}
          </div>
          <p className="settings-privacy-note">
            Findings below this threshold are excluded from CI/CD pass/fail and diff badges. They still appear in the findings table.
          </p>
        </div>

        <div className="modal-hint">
          {isOllama
            ? <>No API key needed — Ollama runs locally.</>
            : <>API keys are read from environment variables: <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code></>
          }
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
