import "dotenv/config";

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  host: process.env.SAIA_HOST || "127.0.0.1",
  port: numberFromEnv(process.env.SAIA_PORT, 41732),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
  fastModel: process.env.SAIA_MODEL_FAST || "qwen3.5:0.8b",
  reasoningModel: process.env.SAIA_MODEL_REASONING || "qwen3.5:4b",
  visionModel: process.env.SAIA_MODEL_VISION || "qwen3.5:4b",
  keepAlive: process.env.OLLAMA_KEEP_ALIVE ?? "0",
  tavilyApiKey: process.env.TAVILY_API_KEY || "",
  tavilySearchDepth: process.env.TAVILY_SEARCH_DEPTH === "advanced" ? "advanced" : "basic"
} as const;