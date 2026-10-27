import { config } from "./config.js";
import type { RequestedTaskKind, TaskKind } from "./types.js";

const MATH_PATTERN = /\b(math|mathematics|calculate|compute|solve|equation|evaluate|simplify|factor|derivative|integral|probability|algebra|geometry|perimeter|area|volume|slope|fraction|percent|quadratic|triangle|hypotenuse|ratio|expression|variable|coefficient)\b|(?:\d\s*[+\-*\/=^]\s*\d)/i;
const RESEARCH_PATTERN = /\b(who|what|when|where|which|why|according to|define|known as|famous for|main idea|primary cause|identify|explain|describe|source says)\b/i;

export type RoutingResult = {
  kind: TaskKind;
  preferredModel: string;
  reason: string;
};

export function classifyTask(text: string, imageCount = 0, requested: RequestedTaskKind = "auto"): RoutingResult {
  if (requested !== "auto") return chooseProfile(requested, "Selected from the task-type override.");

  const value = text.trim();
  if (MATH_PATTERN.test(value)) return chooseProfile("math", "Math or multi-step reasoning signals were detected.");
  if (imageCount > 0) return chooseProfile("visual", "A screenshot is available, so the multimodal vision model is preferred.");
  if (value.length > 8500) return chooseProfile("reading", "Long reading content is routed to the stronger model for context handling.");
  if (RESEARCH_PATTERN.test(value) && value.includes("?")) return chooseProfile("research", "The question looks like a factual lookup.");
  return chooseProfile("general", "Routine text is routed to the lightweight model.");
}

function chooseProfile(kind: TaskKind, reason: string): RoutingResult {
  const preferredModel = kind === "math"
    ? config.reasoningModel
    : kind === "visual"
      ? config.visionModel
      : kind === "reading"
        ? config.reasoningModel
        : config.fastModel;
  return { kind, preferredModel, reason };
}

export function shouldSearch(text: string, kind: TaskKind): boolean {
  if (kind === "math") return false;
  return RESEARCH_PATTERN.test(text) && text.trim().length > 10;
}

export function buildSearchQuery(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\b(?:student\s*)?(?:id|number)\s*[:#-]?\s*[A-Za-z0-9-]+\b/gi, " ")
    .replace(/\b(?:name|email|phone|student)\s*:\s*[^\n,;]+/gi, " ")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 650);
}