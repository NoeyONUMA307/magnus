import { useCallback, useEffect, useState } from "react";
import { getSettings, updateSetting, testWebhook, testGithub, getScans } from "../lib/api";
import type { Scan } from "../types/index";

const API_URL = import.meta.env.VITE_API_URL || "";

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function Integrations() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [scannedUrls, setScannedUrls] = useState<string[]>([]);
  const [copiedBadge, setCopiedBadge] = useState<string | null>(null);

  const [githubToken, setGithubToken] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [savingGh, setSavingGh] = useState(false);
  const [testingGh, setTestingGh] = useState(false);
  const [ghTestResult, setGhTestResult] = useState<"ok" | "error" | null>(null);
  const [ghLogin, setGhLogin] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      const url = s.webhook_url ?? "";
      setWebhookUrl(url);
      setSavedUrl(url);
      const token = s.github_token ?? "";
      setGithubToken(token);
      setSavedToken(token);
    }).catch(() => {});

    getScans().then((scans: Scan[]) => {
      const urls = new Set<string>();
      for (const s of scans) {
        if (s.status === "complete") urls.add(s.url);
      }
      setScannedUrls(Array.from(urls));
    }).catch(() => {});
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleSave = useCallback(async () => {
    if (!webhookUrl.trim()) {
      showToast("Add a webhook URL first, then click Save.");
      return;
    }
    setSaving(true);
    try {
      await updateSetting("webhook_url", webhookUrl);
      setSavedUrl(webhookUrl);
    } catch {
      showToast("Failed to save webhook URL.");
    } finally {
      setSaving(false);
    }
  }, [webhookUrl, showToast]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testWebhook();
      setTestResult("ok");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  }, []);

  const handleClear = useCallback(async () => {
    setSaving(true);
    try {
      await updateSetting("webhook_url", "");
      setWebhookUrl("");
      setSavedUrl("");
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSaveGh = useCallback(async () => {
    if (!githubToken.trim()) {
      showToast("Add a GitHub token first, then click Save.");
      return;
    }
    setSavingGh(true);
    try {
      await updateSetting("github_token", githubToken);
      setSavedToken(githubToken);
    } catch {
      showToast("Failed to save token. Must start with ghp_ or github_pat_.");
    } finally {
      setSavingGh(false);
    }
  }, [githubToken, showToast]);

  const handleTestGh = useCallback(async () => {
    setTestingGh(true);
    setGhTestResult(null);
    try {
      const result = await testGithub();
      setGhTestResult("ok");
      setGhLogin(result.login);
    } catch {
      setGhTestResult("error");
    } finally {
      setTestingGh(false);
      setTimeout(() => setGhTestResult(null), 4000);
    }
  }, []);

  const handleClearGh = useCallback(async () => {
    setSavingGh(true);
    try {
      await updateSetting("github_token", "");
      setGithubToken("");
      setSavedToken("");
      setGhLogin(null);
    } catch {
      // silently fail
    } finally {
      setSavingGh(false);
    }
  }, []);

  const copyBadge = useCallback((url: string) => {
    const badgeUrl = `${window.location.origin}/api/badge/${encodeURIComponent(url)}`;
    const markdown = `![Magnus Security](${badgeUrl})`;
    navigator.clipboard.writeText(markdown).then(() => {
      setCopiedBadge(url);
      setTimeout(() => setCopiedBadge(null), 2000);
    }).catch(() => {});
  }, []);

  const isDirty = webhookUrl !== savedUrl;
  const isGhDirty = githubToken !== savedToken;

  return (
    <div className="page-integrations">
      {toast && (
        <div className="integrations-toast">{toast}</div>
      )}

      <div className="integrations-header">
        <h1 className="integrations-title">Integrations</h1>
        <p className="integrations-sub">Connect Magnus to external services for notifications, PR comments, and badges.</p>
      </div>

      <div className="integration-card">
        <div className="integration-card-header">
          <div className="integration-card-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 13l5-5 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 5h4v4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="integration-card-name">Webhook Notifications</div>
            <div className="integration-card-desc">Get notified on Slack or Discord when scans complete.</div>
          </div>
          {savedUrl && (
            <span className="integration-status-pill active">Active</span>
          )}
        </div>

        <div className="integration-card-body">
          <label className="field-label">Webhook URL</label>
          <div className="webhook-input-row">
            <input
              type="url"
              className="webhook-input"
              placeholder="https://hooks.slack.com/services/... or Discord webhook URL"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              autoComplete="off"
            />
          </div>
          <p className="integration-hint">
            Slack: <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer">Create an incoming webhook</a> · Discord: Server Settings → Integrations → Webhooks
          </p>

          <div className="integration-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || (!isDirty && !!savedUrl)}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {savedUrl && (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? "Sending..." : testResult === "ok" ? "Sent!" : testResult === "error" ? "Failed" : "Test"}
                </button>
                <button className="btn btn-ghost" onClick={handleClear} disabled={saving}>
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="integration-card">
        <div className="integration-card-header">
          <div className="integration-card-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <path d="M9 0C4.03 0 0 4.03 0 9c0 3.98 2.58 7.35 6.16 8.54.45.08.62-.2.62-.43v-1.5c-2.51.55-3.04-1.21-3.04-1.21-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.06 1.38.93 1.38.93.8 1.37 2.1.97 2.61.74.08-.58.31-.97.57-1.2-2-.23-4.1-1-4.1-4.46 0-.98.35-1.79.93-2.42-.09-.23-.4-1.15.09-2.39 0 0 .76-.24 2.48.93a8.63 8.63 0 014.52 0c1.72-1.17 2.48-.93 2.48-.93.49 1.24.18 2.16.09 2.39.58.63.93 1.44.93 2.42 0 3.47-2.11 4.23-4.12 4.45.32.28.61.83.61 1.67v2.48c0 .24.16.52.62.43C15.42 16.35 18 12.98 18 9c0-4.97-4.03-9-9-9z"/>
            </svg>
          </div>
          <div>
            <div className="integration-card-name">GitHub PR Comments</div>
            <div className="integration-card-desc">Post scan summaries as PR comments when triggered via CI/CD.</div>
          </div>
          {savedToken && (
            <span className="integration-status-pill active">Active</span>
          )}
        </div>

        <div className="integration-card-body">
          <label className="field-label">Personal Access Token</label>
          <div className="webhook-input-row">
            <input
              type="password"
              className="webhook-input"
              placeholder="ghp_... or github_pat_..."
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <p className="integration-hint">
            <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">Create a token</a> with <code>repo</code> scope (classic) or <strong>Issues: Read &amp; Write</strong> (fine-grained).
            {ghLogin && ghTestResult === "ok" && ` Connected as @${ghLogin}.`}
          </p>

          <div className="integration-actions">
            <button
              className="btn btn-primary"
              onClick={handleSaveGh}
              disabled={savingGh || (!isGhDirty && !!savedToken)}
            >
              {savingGh ? "Saving..." : "Save"}
            </button>
            {savedToken && (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={handleTestGh}
                  disabled={testingGh}
                >
                  {testingGh ? "Testing..." : ghTestResult === "ok" ? `Connected!` : ghTestResult === "error" ? "Failed" : "Test"}
                </button>
                <button className="btn btn-ghost" onClick={handleClearGh} disabled={savingGh}>
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="integration-card">
        <div className="integration-card-header">
          <div className="integration-card-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="5" width="16" height="8" rx="2" />
              <line x1="9" y1="5" x2="9" y2="13" />
              <circle cx="5" cy="9" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="integration-card-name">Security Badge</div>
            <div className="integration-card-desc">Embed a live risk score badge in your README.</div>
          </div>
        </div>

        <div className="integration-card-body">
          {scannedUrls.length === 0 ? (
            <p className="integration-hint">Run a scan to generate badge URLs for your targets.</p>
          ) : (
            <div className="badge-list">
              {scannedUrls.map((url) => (
                <div key={url} className="badge-row">
                  <div className="badge-preview">
                    <img
                      src={`${API_URL}/api/badge/${encodeURIComponent(url)}`}
                      alt={`Badge for ${hostname(url)}`}
                    />
                  </div>
                  <span className="badge-url">{hostname(url)}</span>
                  <button
                    className="btn btn-ghost"
                    onClick={() => copyBadge(url)}
                  >
                    {copiedBadge === url ? "Copied!" : "Copy Markdown"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
