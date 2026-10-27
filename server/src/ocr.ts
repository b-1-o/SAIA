import { createWorker } from "tesseract.js";
import type { OCRLine } from "./types.js";

export type OCRResult = {
  text: string;
  lines: OCRLine[];
  width: number;
  height: number;
  warning?: string;
};

function getImageBytes(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("Image data must be a supported base64 data URL.");
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

export async function recognizeImage(dataUrl: string): Promise<OCRResult> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker("eng");
    const result = await worker.recognize(getImageBytes(dataUrl));
    const lines: OCRLine[] = result.data.lines
      .map((line) => ({
        text: String(line.text || "").trim(),
        bbox: {
          x0: Number(line.bbox.x0),
          y0: Number(line.bbox.y0),
          x1: Number(line.bbox.x1),
          y1: Number(line.bbox.y1)
        }
      }))
      .filter((line) => line.text.length > 0 && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);

    const size = (result.data as typeof result.data & { imageSize?: { width?: number; height?: number } }).imageSize;
    return {
      text: String(result.data.text || "").trim(),
      lines,
      width: Number(size?.width || 0),
      height: Number(size?.height || 0)
    };
  } catch (error) {
    return {
      text: "",
      lines: [],
      width: 0,
      height: 0,
      warning: "OCR could not process this image. The vision model will still try to inspect it. " +
        (error instanceof Error ? error.message : "Unknown OCR error.")
    };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* worker may already be stopped */ }
    }
  }
}