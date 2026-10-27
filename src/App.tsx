import { useEffect, useMemo, useState } from "react";

declare const chrome: any;

type OCRLine = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type Source = { title: string; url: string; content: string };
type Health = {
  ok: boolean; ollamaAvailable: boolean; tavilyConfigured: boolean;
  models: { fast: string; reasoning: string; vision: string }; installedModels: string[];
};
type Analysis = {
  kind: string; model: string; fallbackUsed: boolean; suggestedAnswer: string; explanation: string;
  summary: string; confidence: number; needsReview: boolean; ocrText: string; ocrLines: OCRLine[];
  imageWidth: number; imageHeight: number; imageDataUrl: string | null; sources: Source[]; warnings: string[];
};
type Assignment = {
  title: string; url: string; context?: string; status: string; course?: string;
  courseUrl?: string; scanError?: string;
};
type ScanResult = { assignments: Assignment[]; coursesScanned: number; scanUrl: string; warnings: string[] };
type QuizSuggestion = {
  index: number; question: string; options: string[]; suggestedResponse: string;
  explanation: string; confidence: number; needsReview: boolean;
};
type QuizResult = {
  title: string; kind: string; model: string; fallbackUsed: boolean;
  questionsFound: number; analyzedQuestions: number; screenshotsCaptured?: number; suggestions: QuizSuggestion[]; sources: Source[]; warnings: string[];
};
type FileDraft = {
  filename: string; mimeType: string; sourceType: string; extractedText: string;
  suggestedItems: Array<{ question: string; suggestedAnswer: string; explanation: string; confidence: number }>;
  draftBase64: string; draftFilename: string; model: string; warnings: string[];
};
type Attachment = { title: string; url: string; filename: string };

const API = "http://127.0.0.1:41732";

function extensionMessage<T>(type: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, error: "This action requires the built extension loaded in Brave/Chrome." });
      return;
    }
    chrome.runtime.sendMessage({ type, ...payload }, (response: any) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({ ok: false, error: runtimeError.message || "Extension messaging failed." });
        return;
      }
      resolve(response || { ok: false, error: "No response from the local assistant." });
    });
  });
}

function saveBase64File(base64: string, filename: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quiz, setQuiz] = useState<QuizResult | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [useSearch, setUseSearch] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDraft, setFileDraft] = useState<FileDraft | null>(null);

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
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get({ useSearch: true, saiaAssignments: [], saiaScanMeta: null }, (value: any) => {
        setUseSearch(Boolean(value.useSearch));
        if (Array.isArray(value.saiaAssignments) && value.saiaAssignments.length) {
          setScan({
            assignments: value.saiaAssignments,
            coursesScanned: Number(value.saiaScanMeta?.courses || 0),
            scanUrl: String(value.saiaScanMeta?.sourceUrl || ""),
            warnings: ["Loaded the last locally saved scan. Run Scan courses to refresh it."]
          });
        }
      });
    }
  }, []);

  async function toggleSearch(enabled: boolean) {
    setUseSearch(enabled);
    if (typeof chrome !== "undefined" && chrome.storage?.local) chrome.storage.local.set({ useSearch: enabled });
  }

  async function runExtensionAction<T>(type: string, label: string): Promise<T | null> {
    setBusy(true);
    setBusyLabel(label);
    setError("");
    setNotice("");
    try {
      const result = await extensionMessage<T>(type);
      if (!result.ok || !result.data) throw new Error(result.error || "The action did not return a result.");
      return result.data;
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Action failed.");
      return null;
    } finally {
      setBusy(false);
      setBusyLabel("");
      void refreshHealth();
    }
  }

  async function analyzePage() {
    setAnalysis(null);
    setQuiz(null);
    const result = await runExtensionAction<Analysis>("SAIA_ANALYZE_CURRENT", "Analyzing page and image…");
    if (result) setAnalysis(result);
  }

  async function analyzeWholeQuiz() {
    setAnalysis(null);
    setQuiz(null);
    const result = await runExtensionAction<QuizResult>("SAIA_ANALYZE_QUIZ", "Collecting and analyzing questions…");
    if (result) setQuiz(result);
  }

  async function scanCourses() {
    const result = await runExtensionAction<ScanResult>("SAIA_SCAN_COURSES", "Scanning courses in temporary tabs…");
    if (result) {
      setScan(result);
      const incomplete = result.assignments.filter((item) => item.status === "incomplete").length;
      setNotice("Scan finished: " + result.assignments.length + " task links found; " + incomplete + " marked incomplete. Unknown statuses need checking.");
    }
  }

  async function listAttachments() {
    const result = await runExtensionAction<{ attachments: Attachment[] }>("SAIA_LIST_ATTACHMENTS", "Finding file attachments…");
    if (result) {
      setAttachments(result.attachments || []);
      if (!(result.attachments || []).length) setNotice("No direct PDF/DOCX/XLSX-style file links were found on this page.");
    }
  }

  async function prepareFile() {
    if (!selectedFile) {
      setError("Choose a file downloaded from the assignment first.");
      return;
    }
    if (selectedFile.size > 8 * 1024 * 1024) {
      setError("Choose a file smaller than 8 MB.");
      return;
    }
    setBusy(true);
    setBusyLabel("Reading file and preparing a draft…");
    setError("");
    setNotice("");
    setFileDraft(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read file."));
        reader.onerror = () => reject(new Error("Could not read file."));
        reader.readAsDataURL(selectedFile);
      });
      const response = await fetch(API + "/api/files/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.name,
          mimeType: selectedFile.type || "application/octet-stream",
          fileBase64: dataUrl.split(",")[1] || ""
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Document preparation failed.");
      setFileDraft(payload as FileDraft);
      setNotice("Draft prepared. Review the extracted questions and explanations before using the file.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Document preparation failed.");
    } finally {
      setBusy(false);
      setBusyLabel("");
      void refreshHealth();
    }
  }

  async function attachDraftWithPayload() {
    if (!fileDraft) return;
    const accepted = window.confirm(
      "Attach " + fileDraft.draftFilename + " to the file input on the currently active Schoology page?\n\nThis does not submit the assignment. Review it and use Schoology's own Submit button only if it is correct."
    );
    if (!accepted) return;
    setBusy(true);
    setBusyLabel("Attaching reviewed draft…");
    setError("");
    setNotice("");
    try {
      const result = await new Promise<{ ok: boolean; data?: { filename: string; note: string }; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({
          type: "SAIA_ATTACH_DRAFT",
          draft: {
            filename: fileDraft.draftFilename,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            base64: fileDraft.draftBase64
          }
        }, (response: any) => {
          const runtimeError = chrome.runtime.lastError;
          resolve(runtimeError ? { ok: false, error: runtimeError.message } : (response || { ok: false, error: "No response." }));
        });
      });
      if (!result.ok || !result.data) throw new Error(result.error || "Could not attach the draft.");
      setNotice(result.data.note || ("Attached " + result.data.filename + ". The assignment has not been submitted."));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not attach the draft.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  const confidence = useMemo(() => {
    if (!analysis || !Number.isFinite(analysis.confidence)) return null;
    return Math.round(Math.max(0, Math.min(1, analysis.confidence)) * 100);
  }, [analysis]);
  const incompleteCount = scan?.assignments.filter((item) => item.status === "incomplete").length || 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div className="brand-copy"><div className="eyebrow">LOCAL STUDY SYSTEM</div><h1>SAIA <span>assistant</span></h1></div>
        <button className="icon-button" onClick={() => void refreshHealth()} aria-label="Refresh status" title="Refresh status">↻</button>
      </header>

      <section className="status-card">
        <div className="status-row">
          <span className={"status-dot " + (health?.ollamaAvailable ? "on" : "")} />
          <div className="status-main">
            <strong>{health?.ollamaAvailable ? "Local AI connected" : "Local AI not ready"}</strong>
            <small>{healthError || (health ? "Requests stay local unless optional web search is used." : "Start Ollama and the SAIA local API.")}</small>
          </div>
        </div>
        {health && <div className="model-list">
          <div><span>FAST</span><code>{health.models.fast}</code></div>
          <div><span>REASONING</span><code>{health.models.reasoning}</code></div>
          <div><span>VISION</span><code>{health.models.vision}</code></div>
        </div>}
      </section>

      <section className="action-panel">
        <div className="section-title"><div><h2>Coursework tools</h2><p>Run from an open LAUSD LMS / Schoology page.</p></div><span className="privacy-pill"><span /> LOCAL</span></div>
        <label className="toggle-row">
          <input type="checkbox" checked={useSearch} onChange={(event) => void toggleSearch(event.target.checked)} />
          <span className="custom-toggle" />
          <span className="toggle-text"><strong>Use web search when useful</strong><small>{health?.tavilyConfigured ? "Tavily configured." : "Optional — add a Tavily key to .env."}</small></span>
        </label>
        <button className="primary-button" onClick={() => void scanCourses()} disabled={busy}>
          {busy && busyLabel.startsWith("Scanning") ? <><span className="spinner" /> {busyLabel}</> : <><span>◎</span> Scan courses and assignments</>}
        </button>
        <button className="secondary-button" onClick={() => void analyzeWholeQuiz()} disabled={busy || !health?.ollamaAvailable}>
          {busy && busyLabel.startsWith("Collecting") ? <><span className="spinner" /> {busyLabel}</> : <><span>▤</span> Analyze whole quiz</>}
        </button>
        <button className="secondary-button" onClick={() => void analyzePage()} disabled={busy || !health?.ollamaAvailable}>
          {busy && busyLabel.startsWith("Analyzing") ? <><span className="spinner" /> {busyLabel}</> : <><span>✦</span> Analyze visible page</>}
        </button>
        <button className="text-button" onClick={() => void listAttachments()} disabled={busy}><span>↳</span> Find downloadable attachments</button>
        <p className="microcopy">SAIA suggests and explains. It does not select quiz options or press Submit for you.</p>
      </section>

      {error && <div className="error-box"><strong>Could not complete action</strong><p>{error}</p></div>}
      {notice && <div className="notice-box">{notice}</div>}

      {scan && <section className="result-panel">
        <div className="section-title"><div><h2>Assignment scan</h2><p>{scan.coursesScanned} course pages visited · {scan.assignments.length} task links</p></div><span className="count-pill">{incompleteCount} incomplete*</span></div>
        <p className="microcopy">*Only visible incomplete labels count here. Unknown status is not proof that an assignment is missing.</p>
        {scan.warnings.map((warning, index) => <div className="warning-box" key={index}>{warning}</div>)}
        <div className="assignment-list">
          {scan.assignments.slice(0, 70).map((item, index) => <div className="assignment-item" key={(item.url || item.title) + index}>
            <div className="assignment-item-main">
              <span className={"task-status " + item.status}>{item.status === "incomplete" ? "INCOMPLETE" : item.status === "possibly-complete" ? "MAYBE DONE" : "CHECK"}</span>
              <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title || "Untitled task"}</strong></a>
              <small>{item.course || "Course not identified"}{item.context ? " · " + item.context.slice(0, 150) : ""}</small>
              {item.scanError && <small className="error-inline">{item.scanError}</small>}
            </div>
          </div>)}
        </div>
        {scan.assignments.length > 70 && <p className="microcopy">Showing first 70 items; the full scan is saved locally.</p>}
      </section>}

      {quiz && <section className="result-panel">
        <div className="result-head"><span className="result-icon">▤</span><div className="result-heading"><h2>Quiz review</h2><p>{quiz.analyzedQuestions}/{quiz.questionsFound} question groups · {quiz.screenshotsCaptured || 0} screenshots · {quiz.kind.toUpperCase()} · {quiz.model}</p></div></div>
        {quiz.fallbackUsed && <div className="warning-box">The preferred model was not installed; a fallback was used.</div>}
        <div className="review-note">Suggestions are drafts with explanations. Check the original question, image, and course rules before using them.</div>
        {quiz.suggestions.map((item) => <article className="question-result" key={item.index}>
          <div className="question-top"><span className="question-number">Q{item.index}</span><span className="confidence-mini">{Math.round(item.confidence * 100)}% model estimate</span></div>
          <p className="question-prompt">{item.question}</p>
          {item.options.length > 0 && <div className="option-list">{item.options.map((option, index) => <div key={index}><span>{String.fromCharCode(65 + index)}</span>{option}</div>)}</div>}
          {item.suggestedResponse && <div className="answer-box"><span className="label">SUGGESTED RESPONSE</span><p>{item.suggestedResponse}</p></div>}
          {item.explanation && <div className="explanation-box"><span className="label">WHY / EVIDENCE</span><p>{item.explanation}</p></div>}
          {item.needsReview && <small className="error-inline">Review this question carefully.</small>}
        </article>)}
        {quiz.warnings.map((warning, index) => <div className="warning-box" key={index}>{warning}</div>)}
        {quiz.sources?.length > 0 && <div className="sources-section"><span className="label">FACTUAL SOURCES</span>
          {quiz.sources.map((source, index) => <a className="source-item" href={source.url} target="_blank" rel="noreferrer" key={source.url + index}>
            <span className="source-index">{String(index + 1).padStart(2, "0")}</span>
            <span><strong>{source.title || source.url}</strong><small>{source.content}</small></span><span className="source-arrow">↗</span>
          </a>)}
        </div>}
      </section>}

      {analysis && <section className="result-panel">
        <div className="result-head"><span className="result-icon">✦</span><div className="result-heading"><h2>Page analysis</h2><p>{analysis.kind.toUpperCase()} · {analysis.model}{analysis.fallbackUsed ? " · fallback model" : ""}</p></div>
          {confidence !== null && <div className="confidence"><strong>{confidence}%</strong><small>confidence</small></div>}
        </div>
        {analysis.summary && <p className="summary-text">{analysis.summary}</p>}
        {analysis.suggestedAnswer && <div className="answer-box"><span className="label">SUGGESTED RESPONSE</span><p>{analysis.suggestedAnswer}</p></div>}
        {analysis.explanation && <div className="explanation-box"><span className="label">REASONING</span><p>{analysis.explanation}</p></div>}
        {analysis.imageDataUrl && <div className="ocr-section">
          <div className="section-title tight"><div><h3>Image text detection</h3><p>Outlined regions are OCR-recognized text lines.</p></div><span className="count-pill">{analysis.ocrLines.length} lines</span></div>
          <div className="image-stage"><img src={analysis.imageDataUrl} alt="Captured assignment viewport" />
            {analysis.imageWidth > 0 && analysis.imageHeight > 0 && <svg className="ocr-overlay" viewBox={"0 0 " + analysis.imageWidth + " " + analysis.imageHeight} preserveAspectRatio="none" aria-label="OCR line highlight overlay">
              {analysis.ocrLines.map((line, index) => <rect key={index} x={line.bbox.x0} y={line.bbox.y0} width={Math.max(1, line.bbox.x1 - line.bbox.x0)} height={Math.max(1, line.bbox.y1 - line.bbox.y0)} rx="2" />)}
            </svg>}
          </div>
          {analysis.ocrText && <div className="ocr-text"><span className="label">EXTRACTED TEXT</span><pre>{analysis.ocrText}</pre></div>}
        </div>}
        {analysis.sources.length > 0 && <div className="sources-section"><span className="label">SOURCES</span>
          {analysis.sources.map((source, index) => <a className="source-item" href={source.url} target="_blank" rel="noreferrer" key={source.url + index}>
            <span className="source-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{source.title || source.url}</strong><small>{source.content}</small></span><span className="source-arrow">↗</span>
          </a>)}
        </div>}
        {analysis.warnings.map((warning, index) => <div className="warning-box" key={index}>{warning}</div>)}
        {analysis.needsReview && <div className="review-note"><strong>Review before using.</strong> Verify the extracted wording and explanation.</div>}
      </section>}

      {attachments.length > 0 && <section className="result-panel">
        <div className="section-title"><div><h2>Downloadable attachments</h2><p>Open a file from Schoology, then select it below.</p></div></div>
        {attachments.map((item, index) => <a className="source-item" href={item.url} target="_blank" rel="noreferrer" key={item.url + index}>
          <span className="source-index">FILE</span><span><strong>{item.title || item.filename}</strong><small>{item.filename}</small></span><span className="source-arrow">↓</span>
        </a>)}
      </section>}

      <section className="action-panel">
        <div className="section-title"><div><h2>Worksheet file assistant</h2><p>Select a downloaded assignment to extract text and prepare a DOCX review copy.</p></div></div>
        <input className="file-input" type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp" onChange={(event) => { setSelectedFile(event.target.files?.[0] || null); setFileDraft(null); }} />
        <small className="file-help">PDF, DOCX, XLSX, CSV, TXT, RTF, PNG, JPG or WEBP · up to 8 MB</small>
        <button className="primary-button" onClick={() => void prepareFile()} disabled={busy || !selectedFile || !health?.ollamaAvailable}>
          {busy && busyLabel.startsWith("Reading") ? <><span className="spinner" /> {busyLabel}</> : <><span>▧</span> Prepare review draft</>}
        </button>
        {fileDraft && <div className="file-draft">
          <div className="draft-ready"><span className="draft-check">✓</span><div><strong>{fileDraft.draftFilename}</strong><small>{fileDraft.sourceType} · {fileDraft.suggestedItems.length} items · {fileDraft.model}</small></div></div>
          <p className="microcopy">This is a new review copy, not the original worksheet. Check every suggestion before using it.</p>
          <button className="secondary-button" onClick={() => saveBase64File(fileDraft.draftBase64, fileDraft.draftFilename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}>Download prepared DOCX</button>
          <button className="secondary-button" onClick={() => void attachDraftWithPayload()} disabled={busy}>Attach draft to active LMS file field…</button>
          {fileDraft.warnings.map((warning, index) => <div className="warning-box" key={index}>{warning}</div>)}
          <div className="draft-preview">
            {fileDraft.suggestedItems.slice(0, 5).map((item, index) => <div className="draft-item" key={index}>
              <strong>{index + 1}. {item.question.slice(0, 160)}</strong><p>{item.suggestedAnswer}</p>{item.explanation && <small>{item.explanation}</small>}
            </div>)}
            {fileDraft.suggestedItems.length > 5 && <small>Showing 5 items; all detected items are in the downloaded DOCX.</small>}
          </div>
        </div>}
      </section>

      <footer className="footer"><span>SAIA · v0.2.0</span><span>Local-first by design</span></footer>
    </main>
  );
}