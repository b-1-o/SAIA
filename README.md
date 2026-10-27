# SAIA — Local Study Assistant

SAIA is a local-first browser assistant for reading course pages, understanding visible quiz questions (including text inside screenshots and diagrams), and preparing reviewable explanations. It does **not** automatically select or submit answers.

## Architecture

- **Chromium extension** (React + Vite, Manifest V3): user-triggered capture of the active LAUSD LMS page and visible viewport.
- **Local API** (Node.js + TypeScript): task classification, model routing, local OCR, optional web search, structured results.
- **Ollama**: local small model for routine text; larger multimodal model for mathematics/reasoning and images.
- **Tesseract.js**: offline-capable OCR after its English language data has been cached locally.
- **Tavily**: optional server-side search; unused unless `TAVILY_API_KEY` is configured and search is enabled.

## Requirements

- Node.js 20+
- Ollama installed and running
- Chromium-based browser (Brave/Chrome)
- Recommended starting models for a machine with about 8 GB RAM:
  - `qwen3.5:0.8b` — fast text tasks
  - `qwen3.5:4b` — visual questions and multi-step reasoning

Both are multimodal Qwen 3.5 models. Model files are downloaded once; inference runs locally. The larger model needs more memory and will be slower. SAIA asks Ollama to unload models after each request by default to reduce RAM pressure; change `OLLAMA_KEEP_ALIVE` in `.env` only if your system has enough memory.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy configuration
cp .env.example .env

# 3. Pull local models (one-time download)
ollama pull qwen3.5:0.8b
ollama pull qwen3.5:4b

# 4. Start local API and extension dev server
npm run dev
```

Local API: `http://127.0.0.1:41732`  
Extension dev page: Vite serves the popup at `http://127.0.0.1:5173`.

For actual page capture, build the extension:

```bash
npm run build
```

Then open `brave://extensions` or `chrome://extensions`, enable Developer mode, and choose **Load unpacked** → the generated `dist` folder. After editing, click **Reload** on the extension card.

## Settings

See `.env.example`. Optional Tavily search is kept on the local API; the key is never bundled into the extension. Without a key, the system works without web search. The API binds to loopback only, so it is not exposed to the LAN.

## Image and OCR behavior

The extension captures the **currently visible viewport** on explicit user action, then sends it only to the local API. OCR returns recognized lines and bounding boxes; the multimodal model analyzes visual context (including diagrams, symbols, and question layout). The popup overlays boxes on the screenshot and displays extracted text. Scroll to another part of a long quiz and analyze again.

OCR coordinates and model interpretations can be wrong. Review the extracted text and reasoning before using a result. Network search is not used for mathematical problems by default.

## Current scope

This first version implements current-page text capture, visible-viewport image capture, OCR highlighting, heuristic model routing, optional Tavily source lookup, health/status display, and a result-review UI. File download/edit/upload workflows and full-course task discovery are later modules.

## Safety and privacy

- No school password is requested or stored.
- The extension works from the signed-in browser session and only analyzes when clicked.
- Quiz answers are presented as suggestions with reasoning; SAIA does not click choices or submit schoolwork.
- Do not send names, student IDs, or other private details to web search.
