import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { analyze, publicModelConfig } from "./analyzer.js";
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
app.use(express.json({ limit: "12mb" }));

const AnalyzeSchema = z.object({
  title: z.string().max(500).default(""),
  pageUrl: z.string().max(3000).optional(),
  text: z.string().max(30000).default(""),
  images: z.array(z.string().max(10000000).regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,/i)).max(2).default([]),
  useSearch: z.boolean().default(false),
  taskType: z.enum(["auto", "math", "visual", "reading", "research", "general"]).default("auto")
});

app.get("/api/health", async (_request, response) => {
  const ollamaAvailable = await isOllamaAvailable();
  let installedModels: string[] = [];
  if (ollamaAvailable) {
    try { installedModels = (await listInstalledModels()).map((model) => model.name); } catch { /* unavailable */ }
  }
  response.json({
    ok: true,
    version: "0.1.0",
    ollamaAvailable,
    tavilyConfigured: Boolean(config.tavilyApiKey),
    models: publicModelConfig(),
    installedModels,
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
    const result = await analyze(validation.data);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local analysis error.";
    const status = /ollama|model|installed|fetch failed|ECONNREFUSED|connect/i.test(message) ? 503 : 500;
    response.status(status).json({
      error: message,
      hint: status === 503 ? "Check that Ollama is running and the configured model has been pulled." : undefined
    });
  }
});

app.get("/", (_request, response) => {
  response.json({ name: "SAIA Local API", health: "/api/health", analyze: "POST /api/analyze" });
});

app.listen(config.port, config.host, () => {
  console.log("SAIA local API listening on http://" + config.host + ":" + config.port);
  console.log("Fast model: " + config.fastModel);
  console.log("Reasoning model: " + config.reasoningModel);
  console.log("Vision model: " + config.visionModel);
  if (!config.tavilyApiKey) console.log("Web search disabled: no TAVILY_API_KEY configured.");
});