import { totalmem } from "node:os";
import { config } from "./config.js";

export type OllamaModel = { name: string; size?: number };
type OllamaTagsResponse = { models?: OllamaModel[] };
type OllamaChatResponse = { message?: { content?: string }; error?: string };

export async function listInstalledModels(): Promise<OllamaModel[]> {
  const response = await fetch(config.ollamaBaseUrl + "/api/tags", {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("Ollama returned status " + response.status + ".");
  const payload = await response.json() as OllamaTagsResponse;
  return payload.models || [];
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    await listInstalledModels();
    return true;
  } catch {
    return false;
  }
}

export async function resolveModel(preferred: string, options: { allowPreferredOnLowMemory?: boolean } = {}): Promise<{
  model: string;
  fallbackUsed: boolean;
  fallbackReason: "low-memory" | "missing" | null;
  installed: string[];
}> {
  const installedModels = await listInstalledModels();
  const names = installedModels.map((model) => model.name);
  const lowMemorySystem = totalmem() < 10 * 1024 ** 3;
  const fastCandidate = names.find((name) => name === config.fastModel || name.startsWith(config.fastModel + ":"));

  // On systems with less than 10 GiB RAM, prefer the lightweight model to avoid swap storms/OOM.
  if (lowMemorySystem && preferred !== config.fastModel && fastCandidate && !options.allowPreferredOnLowMemory) {
    return { model: fastCandidate, fallbackUsed: true, fallbackReason: "low-memory", installed: names };
  }

  const exact = names.find((name) => name === preferred || name.startsWith(preferred + ":"));
  if (exact) return { model: exact, fallbackUsed: false, fallbackReason: null, installed: names };

  if (fastCandidate) {
    return { model: fastCandidate, fallbackUsed: true, fallbackReason: "missing", installed: names };
  }

  if (names.length > 0) {
    return { model: names[0], fallbackUsed: true, fallbackReason: "missing", installed: names };
  }

  throw new Error("No Ollama models are installed. Run: ollama pull " + preferred);
}
export async function chatWithOllama(args: {
  model: string;
  system: string;
  prompt: string;
  images: string[];
  maxTokens?: number;
  numCtx?: number;
}): Promise<string> {
  const images = args.images.map((image) => image.slice(image.indexOf(",") + 1)).filter(Boolean);
  const userMessage: { role: string; content: string; images?: string[] } = {
    role: "user",
    content: args.prompt
  };
  if (images.length > 0) userMessage.images = images;

  const startedAt = Date.now();
  console.info("[SAIA Ollama] Start model=" + args.model + " promptChars=" + args.prompt.length + " images=" + images.length + ".");
  let response: Response;
  try {
    response = await fetch(config.ollamaBaseUrl + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        userMessage
      ],
      stream: false,
      think: false,
      format: "json",
      keep_alive: config.keepAlive,
      options: { temperature: 0.15, num_ctx: args.numCtx ?? 4096, num_predict: args.maxTokens ?? 768 }
    }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (error) {
    console.error("[SAIA Ollama] Request failed after " + Math.round((Date.now() - startedAt) / 1000) + "s.");
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("The local AI did not finish within 120 seconds. Try a smaller visible-page request or check system memory.");
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Ollama chat failed (" + response.status + "). " + detail.slice(0, 240));
  }
  const payload = await response.json() as OllamaChatResponse;
  if (payload.error) throw new Error(payload.error);
  const content = String(payload.message?.content || "");
  console.info("[SAIA Ollama] Finished in " + Math.round((Date.now() - startedAt) / 1000) + "s; outputChars=" + content.length + ".");
  return content;
}