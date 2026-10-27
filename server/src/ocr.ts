import { createWorker } from "tesseract.js";
import type { OCRLine } from "./types.js";

export type OCRResult = {
  text: string;
  lines: OCRLine[];
  width: number;
  height: number;
  warning?: string;
};

type Box = { x0: number; y0: number; x1: number; y1: number };
type OCRBlockLine = { text?: string; bbox?: Box; words?: Array<{ text?: string }> };
type OCRData = {
  text?: string;
  blocks?: Array<{ paragraphs?: Array<{ lines?: OCRBlockLine[] }> }>;
  imageSize?: { width?: number; height?: number };
};

function getImageBytes(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("Image data must be a supported base64 data URL.");
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

function getImageDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 7 >= bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (startOfFrame.has(marker)) {
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      if (segmentLength < 2) break;
      offset += segmentLength;
    }
  }

  return { width: 0, height: 0 };
}

function warningResult(error: unknown): OCRResult {
  return {
    text: "",
    lines: [],
    width: 0,
    height: 0,
    warning: "OCR could not process this image. The vision model will still try to inspect it. " +
      (error instanceof Error ? error.message : "Unknown OCR error.")
  };
}

function toOCRResult(bytes: Buffer, result: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof createWorker>>["recognize"]>>>): OCRResult {
  const data = result.data as unknown as OCRData;
  const lines: OCRLine[] = (data.blocks || [])
    .flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []))
    .map((line) => {
      const bbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
      return {
        text: String(line.text || (line.words || []).map((word) => word.text || "").join(" ")).trim(),
        bbox: {
          x0: Number(bbox.x0),
          y0: Number(bbox.y0),
          x1: Number(bbox.x1),
          y1: Number(bbox.y1)
        }
      };
    })
    .filter((line) => line.text.length > 0 && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);

  const dimensions = getImageDimensions(bytes);
  const reportedSize = data.imageSize;
  return {
    text: String(data.text || "").trim(),
    lines,
    width: Number(dimensions.width || reportedSize?.width || 0),
    height: Number(dimensions.height || reportedSize?.height || 0)
  };
}

export async function recognizeImages(dataUrls: string[]): Promise<OCRResult[]> {
  if (dataUrls.length === 0) return [];
  const results: OCRResult[] = [];
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    // Reuse one WASM worker for the batch instead of reloading its runtime for every screenshot.
    worker = await createWorker("eng");
    for (const dataUrl of dataUrls) {
      try {
        const bytes = getImageBytes(dataUrl);
        // Tesseract.js v6 requires the blocks output flag for structured text geometry.
        const result = await worker.recognize(bytes, {}, { blocks: true });
        results.push(toOCRResult(bytes, result));
      } catch (error) {
        results.push(warningResult(error));
      }
    }
  } catch (error) {
    while (results.length < dataUrls.length) results.push(warningResult(error));
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* worker may already be stopped */ }
    }
  }

  return results;
}

export async function recognizeImage(dataUrl: string): Promise<OCRResult> {
  return (await recognizeImages([dataUrl]))[0] || warningResult(new Error("No image was provided."));
}
