import { useEffect, useMemo, useState } from "react";

declare const chrome: any;

type OCRLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
type Source = { title: string; url: string; content: string };
type Health = {
  ok: boolean;
  ollamaAvailable: boolean;
  tavilyConfigured: boolean;
  models: { fast: string; reasoning: string; vision: string };
  installedModels: string[];
};
type Analysis = {
  kind: string;
  model: string;
  fallbackUsed: boolean;
  suggestedAnswer: string;
  explanation: string;
  summary: string;
  confidence: number;
  needsReview: boolean;
  ocrText: string;
  ocrLines: OCRLine[];
  imageWidth: number;
  imageHeight: number;
  imageDataUrl: string | null;
  sources: Source[];
  warnings: string[];
};

const API = "http://127.0.0.1:41732";

function messageFromExtension(): Promise<{ ok: boolean; data?: Analysis; error?: string }> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, error: "Load the built extension in Brave/Chrome to capture a Schoology page. The dev preview cannot capture tabs." });
      return;
    }
    chrome.runtime.sendMessage({ type: "SAIA_ANALYZE_CURRENT" }, (response: any) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({ ok: false, error: runtimeError.message || "Extension messaging failed." });
        return;
      }
      resolve(response || { ok: false, error: "No response from the local assistant." });
    });
  });
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [useSearch, setUseSearch] = useState(true);

  async function refreshHealth() {
    try {
      const response = await fetch(API + "/api/health");
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Local API is unavailable.");
      setHealth(value);
      setHealthError("");
    } catch (issue) {
      setHealth(null);
      setHealthError(issue instanceof Error ? issue.message : "Could not connect to local API.");
    }
  }

  useEffect(() => {
    void refreshHealth();
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ useSearch: true }, (value: { useSearch: boolean }) => {
        setUseSearch(Boolean(value.useSearch));
      });
    }
  }, []);

  async function toggleSearch(enabled: boolean) {
    setUseSearch(enabled);
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ useSearch: enabled });
    }
  }

  async function analyzePage() {
    setBusy(true);
    setError("");
    setAnalysis(null);
    const result = await messageFromExtension();
    if (result.ok && result.data) setAnalysis(result.data);
    else setError(result.error || "Analysis failed.");
    setBusy(false);
    void refreshHealth();
  }

  const confidence = useMemo(() => {
    if (!analysis || !Number.isFinite(analysis.confidence)) return null;
    return Math.round(Math.max(0, Math.min(1, analysis.confidence)) * 100);
  }, [analysis]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div className="brand-copy">
          <div className="eyebrow">LOCAL STUDY SYSTEM</div>
          <h1>SAIA <span>assistant</span></h1>
        </div>
        <button className="icon-button" onClick={() => void refreshHealth()} aria-label="Refresh status" title="Refresh status">↻</button>
      </header>

      <section className="status-card">
        <div className="status-row">
          <span className={"status-dot " + (health && health.ollamaAvailable ? "on" : "")} />
          <div className="status-main">
            <strong>{health && health.ollamaAvailable ? "Local AI connected" : "Local AI not ready"}</strong>
            <small>{healthError || (health ? "Requests stay on this computer unless optional search is enabled." : "Start Ollama and the SAIA local API.")}</small>
          </div>
        </div>
        {health && (
          <div className="model-list">
            <div><span>FAST</span><code>{health.models.fast}</code></div>
            <div><span>REASONING</span><code>{health.models.reasoning}</code></div>
            <div><span>VISION</span><code>{health.models.vision}</code></div>
          </div>
        )}
      </section>

      <section className="action-panel">
        <div className="section-title">
          <div>
            <h2>Analyze current page</h2>
            <p>Reads page text and captures the viewport for local OCR + image analysis.</p>
          </div>
          <span className="privacy-pill"><span /> LOCAL</span>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={useSearch} onChange={(event) => void toggleSearch(event.target.checked)} />
          <span className="custom-toggle" />
          <span className="toggle-text">
            <strong>Use web search when useful</strong>
            <small>{health && health.tavilyConfigured ? "Tavily configured; factual questions may use search." : "Optional — add a Tavily key to .env to enable it."}</small>
          </span>
        </label>
        <button className="primary-button" onClick={() => void analyzePage()} disabled={busy || !health || !health.ollamaAvailable}>
          {busy ? <><span className="spinner" /> Analyzing page…</> : <><span>✦</span> Analyze visible page</>}
        </button>
        <p className="microcopy">Scroll to a question first. SAIA suggests and explains; it never clicks quiz choices or submits work.</p>
      </section>

      {error && <div className="error-box"><strong>Could not analyze</strong><p>{error}</p></div>}

      {analysis && (
        <section className="result-panel">
          <div className="result-head">
            <span className="result-icon">✦</span>
            <div className="result-heading">
              <h2>Analysis result</h2>
              <p>{analysis.kind.toUpperCase()} · {analysis.model}{analysis.fallbackUsed ? " · fallback model" : ""}</p>
            </div>
            {confidence !== null && <div className="confidence"><strong>{confidence}%</strong><small>confidence</small></div>}
          </div>
          {analysis.fallbackUsed && <div className="warning-box">Preferred model was not installed, so the router used an available fallback model.</div>}
          {analysis.summary && <p className="summary-text">{analysis.summary}</p>}
          {analysis.suggestedAnswer && (
            <div className="answer-box">
              <span className="label">SUGGESTED RESPONSE</span>
              <p>{analysis.suggestedAnswer}</p>
            </div>
          )}
          {analysis.explanation && (
            <div className="explanation-box">
              <span className="label">REASONING</span>
              <p>{analysis.explanation}</p>
            </div>
          )}

          {analysis.imageDataUrl && (
            <div className="ocr-section">
              <div className="section-title tight">
                <div><h3>Image text detection</h3><p>Outlined regions are OCR-recognized text lines.</p></div>
                <span className="count-pill">{analysis.ocrLines.length} lines</span>
              </div>
              <div className="image-stage">
                <img src={analysis.imageDataUrl} alt="Captured quiz or assignment viewport" />
                {analysis.imageWidth > 0 && analysis.imageHeight > 0 && (
                  <svg className="ocr-overlay" viewBox={"0 0 " + analysis.imageWidth + " " + analysis.imageHeight} preserveAspectRatio="none" aria-label="OCR line highlight overlay">
                    {analysis.ocrLines.map((line, index) => (
                      <g key={index}>
                        <rect x={line.bbox.x0} y={line.bbox.y0} width={Math.max(1, line.bbox.x1 - line.bbox.x0)} height={Math.max(1, line.bbox.y1 - line.bbox.y0)} rx="2" />
                      </g>
                    ))}
                  </svg>
                )}
              </div>
              {analysis.ocrText && <div className="ocr-text"><span className="label">EXTRACTED TEXT</span><pre>{analysis.ocrText}</pre></div>}
            </div>
          )}

          {analysis.sources && analysis.sources.length > 0 && (
            <div className="sources-section">
              <span className="label">SOURCES</span>
              {analysis.sources.map((source, index) => (
                <a className="source-item" href={source.url} target="_blank" rel="noreferrer" key={source.url + index}>
                  <span className="source-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{source.title || source.url}</strong><small>{source.content}</small></span>
                  <span className="source-arrow">↗</span>
                </a>
              ))}
            </div>
          )}
          {analysis.warnings && analysis.warnings.map((warning, index) => <div className="warning-box" key={index}>{warning}</div>)}
          {analysis.needsReview && <div className="review-note"><strong>Review before using.</strong> Check the extracted wording and explanation against your course materials.</div>}
        </section>
      )}

      <footer className="footer">
        <span>SAIA · v0.1.0</span>
        <span>Local-first by design</span>
      </footer>
    </main>
  );
}