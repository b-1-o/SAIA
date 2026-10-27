import { config } from "./config.js";
import type { SearchSource } from "./types.js";

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

export async function searchWeb(query: string): Promise<SearchSource[]> {
  if (!config.tavilyApiKey || !query.trim()) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.tavilyApiKey,
      query: query.slice(0, 650),
      search_depth: config.tavilySearchDepth,
      topic: "general",
      max_results: 4,
      include_answer: false,
      include_raw_content: false
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Tavily search failed (" + response.status + "). " + detail.slice(0, 180));
  }
  const payload = await response.json() as TavilyResponse;
  return (payload.results || [])
    .filter((item) => typeof item.url === "string" && /^https?:\/\//i.test(item.url))
    .slice(0, 4)
    .map((item) => ({
      title: String(item.title || item.url),
      url: String(item.url),
      content: String(item.content || "").slice(0, 420)
    }));
}