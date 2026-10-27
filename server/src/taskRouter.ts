import { config } from "./config.js";
import type { RequestedTaskKind, TaskKind } from "./types.js";

const MATH_PATTERN = /\b(math|mathematics|calculate|compute|solve|equation|evaluate|simplify|factor|derivative|integral|probability|algebra|geometry|perimeter|area|volume|slope|fraction|percent|quadratic|triangle|hypotenuse|ratio|expression|variable|coefficient)\b|(?:\d\s*[+\-*\/=^]\s*\d)/i;
const VISUAL_PATTERN = /\b(diagram|graph|chart|picture|image|figure|illustration|map|photograph|depicted|pictured|shown|label|axis|axes|plot|grid|coordinate plane|bar graph|scatter plot|in the photo|in the image|look at|on the left|on the right|based on the diagram|visual)\b/i;
const RESEARCH_PATTERN = /\b(who|what|when|where|which|why|according to|define|known as|famous for|main idea|primary cause|identify|explain|describe|source says)\b/i;

export type RoutingResult = {
  kind: TaskKind;
  preferredModel: string;
  reason: string;
};

export function classifyTask(text: string, imageCount = 0, requested: RequestedTaskKind = "auto"): RoutingResult {
  if (requested !== "auto") return chooseProfile(requested, "Selected from the task-type override.");

  const value = text.trim();
  // Mathematics has first priority, including mathematics contained in a screenshot's OCR.
  if (MATH_PATTERN.test(value)) return chooseProfile("math", "Math or multi-step reasoning signals were detected.");
  // A screenshot is captured for context, but ordinary prose should not automatically force the heavy model.
  if (imageCount > 0 && (VISUAL_PATTERN.test(value) || value.length < 160)) {
    return chooseProfile("visual", "Diagram, image-dependent wording, or very little readable text suggests visual reasoning.");
  }
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
    .replace(/\b(?:student[ \t]*)?(?:id|number)[ \t]*[:#-]?[ \t]*[A-Za-z0-9-]+\b/gi, " ")
    .replace(/\b(?:name|email|phone|student)[ \t]*:[ \t]*[^\n,;]*/gi, " ")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 650);
}