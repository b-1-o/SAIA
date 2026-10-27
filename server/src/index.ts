import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { analyze, publicModelConfig } from "./analyzer.js";
import { analyzeQuiz } from "./quiz.js";
import { prepareDocument } from "./documents.js";
import { isOllamaAvailable, listInstalledModels } from "./ollama.js";

const app = express();

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173" || origin.startsWith("chrome-extension://")) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed by the local SAIA API."));
  }
}));
app.use(express.json({ limit: "20mb" }));

const ImageSchema = z.string().max(10_000_000).regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i);
const AnalyzeSchema = z.object({
  title: z.string().max(500).default(""),
  pageUrl: z.string().max(3000).optional(),
  text: z.string().max(30000).default(""),
  images: z.array(ImageSchema).max(2).default([]),
  useSearch: z.boolean().default(false),
  taskType: z.enum(["auto", "math", "visual", "reading", "research", "general"]).default("auto")
});

const QuizSchema = z.object({
  title: z.string().max(500).default(""),
  pageUrl: z.string().max(3000).optional(),
  text: z.string().max(30000).default(""),
  questions: z.array(z.object({
    index: z.number().int().positive(),
    text: z.string().max(5000),
    options: z.array(z.string().max(500)).max(40).default([]),
    images: z.array(z.object({
      alt: z.string().max(300).optional(),
      src: z.string().max(3000).optional(),
      width: z.number().optional(),
      height: z.number().optional()
    })).max(10).default([]),
    inputs: z.array(z.object({
      type: z.string().max(60),
      name: z.string().max(250),
      label: z.string().max(300)
    })).max(30).default([])
  })).max(100),
  images: z.array(ImageSchema).max(6).default([]),
  useSearch: z.boolean().default(false)
});

const DocumentSchema = z.object({
  filename: z.string().min(1).max(250).regex(/^[^\\/]+$/),
  mimeType: z.string().max(150).optional(),
  fileBase64: z.string().min(1).max(11_500_000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
});

app.get("/api/health", async (_request, response) => {
  const ollamaAvailable = await isOllamaAvailable();
  let installedModels: string[] = [];
  if (ollamaAvailable) {
    try { installedModels = (await listInstalledModels()).map((model) => model.name); } catch { /* unavailable */ }
  }
  response.json({
    ok: true,
    version: "0.2.0",
    ollamaAvailable,
    tavilyConfigured: Boolean(config.tavilyApiKey),
    models: publicModelConfig(),
    installedModels,
    features: { courseScan: true, batchQuiz: true, documentDrafts: true, autoQuizSubmit: false },
    host: config.host,
    port: config.port
  });
});

app.post("/api/analyze", async (request, response) => {
  const validation = AnalyzeSchema.safeParse(request.body);
  if (!validation.success) {
    response.status(400).json({
      error: "Invalid analysis request.",
      details: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }
  try {
    response.json(await analyze(validation.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local analysis error.";
    const status = /ollama|model|installed|fetch failed|ECONNREFUSED|connect/i.test(message) ? 503 : 500;
    response.status(status).json({
      error: message,
      hint: status === 503 ? "Check that Ollama is running and the configured model has been pulled." : undefined
    });
  }
});

app.post("/api/analyze-quiz", async (request, response) => {
  const validation = QuizSchema.safeParse(request.body);
  if (!validation.success) {
    response.status(400).json({
      error: "Invalid quiz scan payload.",
      details: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }
  try {
    response.json(await analyzeQuiz({
      title: validation.data.title,
      pageUrl: validation.data.pageUrl,
      pageText: validation.data.text,
      questions: validation.data.questions,
      images: validation.data.images,
      useSearch: validation.data.useSearch
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze quiz questions.";
    response.status(/ollama|model|installed|fetch failed|ECONNREFUSED|connect/i.test(message) ? 503 : 500).json({ error: message });
  }
});

app.post("/api/files/prepare", async (request, response) => {
  const validation = DocumentSchema.safeParse(request.body);
  if (!validation.success) {
    response.status(400).json({
      error: "Invalid file payload. Maximum file size is 8 MB.",
      details: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }
  try {
    const bytes = Buffer.from(validation.data.fileBase64, "base64");
    if (bytes.length > 8 * 1024 * 1024) {
      response.status(413).json({ error: "File is larger than 8 MB. Choose a smaller file." });
      return;
    }
    const result = await prepareDocument({
      filename: validation.data.filename,
      mimeType: validation.data.mimeType,
      bytes
    });
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare document.";
    response.status(/model|ollama|installed|fetch failed|ECONNREFUSED|connect/i.test(message) ? 503 : 500).json({ error: message });
  }
});

app.get("/", (_request, response) => {
  response.json({
    name: "SAIA Local API",
    health: "/api/health",
    analyze: "POST /api/analyze",
    analyzeQuiz: "POST /api/analyze-quiz",
    prepareFile: "POST /api/files/prepare"
  });
});

app.listen(config.port, config.host, () => {
  console.log("SAIA local API listening on http://" + config.host + ":" + config.port);
  console.log("Fast model: " + config.fastModel);
  console.log("Reasoning model: " + config.reasoningModel);
  console.log("Vision model: " + config.visionModel);
  if (!config.tavilyApiKey) console.log("Web search disabled: no TAVILY_API_KEY configured.");
});