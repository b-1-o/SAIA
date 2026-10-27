export type TaskKind = "math" | "visual" | "reading" | "research" | "general";
export type RequestedTaskKind = "auto" | TaskKind;

export type OCRLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type SearchSource = {
  title: string;
  url: string;
  content: string;
};

export type AnalyzeInput = {
  title: string;
  pageUrl?: string;
  text: string;
  images: string[];
  useSearch: boolean;
  taskType: RequestedTaskKind;
};

export type AnalysisResponse = {
  kind: TaskKind;
  model: string;
  fallbackUsed: boolean;
  summary: string;
  suggestedAnswer: string;
  explanation: string;
  confidence: number;
  needsReview: boolean;
  ocrText: string;
  ocrLines: OCRLine[];
  imageWidth: number;
  imageHeight: number;
  imageDataUrl: string | null;
  sources: SearchSource[];
  warnings: string[];
};