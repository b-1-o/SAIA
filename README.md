# SAIA — Local Study Assistant

SAIA is a local-first browser extension and local Node.js service for reviewing coursework in the signed-in LAUSD LMS / Schoology session.

## Architecture

- **Browser extension** (React + Vite + Manifest V3): reads the active LMS page, visible quiz inputs and links; can scan discovered course pages in temporary inactive tabs.
- **Local API** (Node.js + TypeScript): task classification, batch quiz review, OCR, local model routing, file parsing and DOCX draft generation.
- **Ollama**: all language-model inference runs locally.
- **Tesseract.js**: offline OCR after English language data is cached locally.
- **Tavily**: optional factual web search; the API key stays in the local server `.env`.

## What is implemented in v0.2.0

1. **Course and assignment scan** — extracts available course and assignment links, nearby status labels and due/context text from rendered LMS pages. It follows up to 20 discovered course links in temporary inactive tabs, merges links and saves the results in `chrome.storage.local`. The LMS interface varies; status is marked unknown unless the page provides recognizable completion text. This is best-effort, not an authoritative gradebook report.
2. **Quiz batch review** — scrapes question text/options, then analyzes up to 6 question groups per request to keep inference responsive on CPU-only systems. Text-first questions skip screenshot/OCR work; a single screenshot is attached only when a question appears to depend on a diagram. Results include concise suggestions and explanations. It does not click answer choices or submit a quiz.
3. **Worksheet file assistant** — accepts a user-selected local PDF, DOCX, XLS/XLSX/CSV, TXT/MD, RTF or PNG/JPG/WEBP (up to 8 MB). It extracts available text, prepares suggested responses with explanations and creates a new DOCX review copy. It does not overwrite the original. Sparse/scanned PDF pages are rendered locally and OCRed for up to 3 pages per file; the rendered page images are also passed to the multimodal model.
4. **Attach reviewed draft** — on an explicit click and confirmation, attempts to attach the generated DOCX to a single file input on the active LMS page. It intentionally does not press the LMS Submit button; review the file and submit through Schoology yourself.
5. **Visual question support** — the live-page analyzer sends a screenshot directly to the local vision model when a diagram or other visual appears necessary. Tesseract OCR remains available for worksheet-file extraction, but is skipped on live LMS pages to avoid redundant setup and processing delays.
6. **Automatic model routing** — lightweight model for routine prose; heavier profile for math, long text or visual-dependent content. This is heuristic routing, not a self-training model.

## Requirements

- Node.js 20+
- Ollama installed and running
- Brave or Chrome
- On systems with less than 10 GiB RAM, SAIA automatically routes reasoning/vision requests to the lightweight model to avoid exhausting memory; verify results carefully because this model is less capable. Quiz OCR reuses one worker and processes at most 3 viewport screenshots per batch.

Default local models:
- `qwen3.5:0.8b` — lightweight profile
- `qwen3.5:4b` — math/reasoning and vision profile

Model size and speed depend on the model quantization and hardware. Ollama may download several gigabytes per model. SAIA sets `OLLAMA_KEEP_ALIVE=0` by default to unload models after each request and reduce memory pressure.

## Setup

```bash
git clone https://github.com/b-1-o/SAIA.git
cd SAIA
npm install
cp .env.example .env

ollama pull qwen3.5:0.8b
ollama pull qwen3.5:4b

npm run build
npm run dev
```

The local API runs at `http://127.0.0.1:41732`; the popup development server runs at `http://127.0.0.1:5173`. For the browser extension, open `brave://extensions` or `chrome://extensions`, enable Developer mode and choose **Load unpacked** → the project's `dist` folder. Keep `npm run dev` running while you use the extension.

## Optional search

1. Create or sign in to a Tavily account at https://app.tavily.com/home and copy the API key from the dashboard. The key is a secret credential; see Tavily's [API key safety guidance](https://help.tavily.com/articles/6594896502-best-practices-for-tavily-api-key-safety).
2. Open the `.env` file in the **SAIA project root** and set `TAVILY_API_KEY=tvly-your-real-key` (replace the example value with your key).
3. Restart `npm run dev`. SAIA reads the key when the local API starts; the UI should then show **Tavily configured**.

Keep the key in the local `.env` only. Never paste it into browser code or commit it to GitHub. Without a key, SAIA still works locally. Quiz batches search at most a small number of factual questions to conserve quota; math-only tasks may not trigger web search. Search queries are cleaned of common email/name/phone/student-ID patterns, but always inspect queries before using a third-party API; no cleaning heuristic can guarantee removal of all personal data.

## Saved result history

The extension's **Saved results** view keeps the latest 40 quiz batches, page analyses, course scans, and attachment searches in `chrome.storage.local`. The history stays on this browser when the popup closes or the browser restarts. Use **Export JSON** to save a backup or **Clear history** to delete the saved records. Existing results from before history was added cannot be reconstructed unless they are run again.

## Limitations

- Discovery depends on links and status labels rendered by the current LMS pages; dynamic layouts, closed courses, paginated content and external tools may be missed.
- Quiz collection is best-effort, especially for iframe-based content or custom controls. A quiz batch analyzes at most 6 detected questions per request; use the Previous 6 / Analyze next 6 controls to move through the quiz in smaller batches. A single screenshot is used only when visual content is detected.
- OCR and local models can misread text or diagrams. The local model request times out after 120 seconds, and the terminal logs the stages/timing; confidence is a model estimate, not a calibrated probability.
- PDF image-only pages do not yet get rendered to images for OCR.
- File attachments can be opened or downloaded through the browser Save dialog, then prepared as new review copies; complex original formatting may not be preserved.
- The attach action fills a file picker when the active page exposes one supported control. It does not submit work.
- No school password is requested or stored. The API binds to loopback only; optional search sends cleaned query text to Tavily.

## Safety and privacy

SAIA does not attempt to bypass access controls, access hidden answer keys, auto-click quiz options, or automatically submit graded quizzes. Suggestions and generated documents must be reviewed against course materials and teacher instructions.
