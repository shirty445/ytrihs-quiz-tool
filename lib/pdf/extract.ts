import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import { recognizeTextFromImage } from "@/lib/ocr/recognize";
import type { ExtractedPdf, PdfPageText } from "@/lib/types";

let workerConfigured = false;
const OCR_FALLBACK_THRESHOLD_CHARS = 24;
const OCR_RENDER_SCALE = 2;
const DOCX_IMAGE_PATTERN = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

function ensureWorkerConfigured(): void {
  if (workerConfigured || typeof window === "undefined") {
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  workerConfigured = true;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("PDF processing was cancelled.");
  }
}

function isPdfFile(file: File): boolean {
  return file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isDocxFile(file: File): boolean {
  return (
    file.type.toLowerCase() ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

async function renderPageToCanvas(page: pdfjsLib.PDFPageProxy) {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas rendering is unavailable for OCR.");
  }

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  return canvas;
}

function summarizeSkippedOcr(kind: string, indexes: number[]): string {
  const preview = indexes.slice(0, 5).join(", ");
  const suffix = indexes.length > 5 ? ", ..." : "";

  return `Ignored low-quality OCR output on ${indexes.length} ${kind}${indexes.length === 1 ? "" : "s"}${preview ? ` (${preview}${suffix})` : ""}.`;
}

function mergePageText(textLayerText: string, ocrText: string): string {
  if (!textLayerText) {
    return ocrText;
  }

  if (!ocrText) {
    return textLayerText;
  }

  const normalizedTextLayer = textLayerText.toLowerCase();
  const normalizedOcrText = ocrText.toLowerCase();

  if (
    normalizedTextLayer.includes(normalizedOcrText) ||
    normalizedOcrText.includes(normalizedTextLayer)
  ) {
    return textLayerText.length >= ocrText.length ? textLayerText : ocrText;
  }

  return normalizeExtractedText(`${textLayerText} ${ocrText}`);
}

function xmlElementsByLocalName(parent: Document | Element, localName: string): Element[] {
  return (Array.from(parent.getElementsByTagName("*")) as Element[]).filter(
    (node) => node.localName === localName
  );
}

function extractDocxXmlText(xml: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const paragraphs = xmlElementsByLocalName(document, "p")
    .map((paragraph) =>
      xmlElementsByLocalName(paragraph, "t")
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim()
    )
    .filter((paragraphText) => paragraphText.length > 0);

  if (paragraphs.length > 0) {
    return normalizeExtractedText(paragraphs.join("\n"));
  }

  return normalizeExtractedText(
    xmlElementsByLocalName(document, "t")
      .map((node) => node.textContent ?? "")
      .join(" ")
  );
}

async function extractPdfOnce(
  file: File,
  signal?: AbortSignal,
  enableOcr = true
): Promise<ExtractedPdf> {
  ensureWorkerConfigured();
  assertNotAborted(signal);

  const buffer = await file.arrayBuffer();
  assertNotAborted(signal);

  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    verbosity: 0
  });

  const pdf = await loadingTask.promise;
  const pages: PdfPageText[] = [];
  const warnings: string[] = [];
  let ocrPageCount = 0;
  let ocrAvailable = enableOcr;
  const ignoredOcrPages: number[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      assertNotAborted(signal);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      let pageText = normalizeExtractedText(
        textContent.items
          .map((item) => {
            if ("str" in item) {
              return item.str;
            }
            return "";
          })
          .join(" ")
      );

      if (ocrAvailable && pageText.length < OCR_FALLBACK_THRESHOLD_CHARS) {
        try {
          assertNotAborted(signal);
          const canvas = await renderPageToCanvas(page);
          const ocrResult = await recognizeTextFromImage(canvas);
          assertNotAborted(signal);

          if (ocrResult.usable && ocrResult.text.length > 0) {
            pageText = mergePageText(pageText, ocrResult.text);
            ocrPageCount += 1;
          } else if (ocrResult.warning) {
            ignoredOcrPages.push(pageNumber);
          }
        } catch (error) {
          ocrAvailable = false;
          const message = error instanceof Error ? error.message : "Unknown OCR error";
          warnings.push(`OCR fallback stopped after page ${pageNumber}: ${message}`);
        }
      }

      if (pageText.length > 0) {
        pages.push({ pageNumber, text: pageText });
      }

      page.cleanup();
    }
  } finally {
    pdf.cleanup();
    pdf.destroy();
  }

  if (ignoredOcrPages.length > 0) {
    warnings.push(summarizeSkippedOcr("page", ignoredOcrPages));
  }

  const totalTextLength = pages.reduce((sum, page) => sum + page.text.length, 0);

  return {
    fileName: file.name,
    fileSize: file.size,
    pages,
    totalTextLength,
    warnings,
    ocrPageCount
  };
}

async function extractDocxOnce(
  file: File,
  signal?: AbortSignal,
  enableOcr = true
): Promise<ExtractedPdf> {
  assertNotAborted(signal);

  const buffer = await file.arrayBuffer();
  assertNotAborted(signal);

  const zip = await JSZip.loadAsync(buffer);
  const pages: PdfPageText[] = [];
  const warnings: string[] = [];
  let ocrPageCount = 0;
  const ignoredOcrImages: number[] = [];

  const xmlSources = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"].map((path) =>
    zip.file(path)
  );

  for (const xmlSource of xmlSources) {
    if (!xmlSource) {
      continue;
    }

    const xml = await xmlSource.async("string");
    const text = extractDocxXmlText(xml);
    if (text.length > 0) {
      pages.push({ pageNumber: null, text });
    }
  }

  const mediaFiles = Object.values(zip.files).filter((entry) => {
    return !entry.dir && entry.name.startsWith("word/media/") && DOCX_IMAGE_PATTERN.test(entry.name);
  });

  if (mediaFiles.length > 0 && !enableOcr) {
    warnings.push("Embedded DOCX images were found, but OCR is disabled.");
  }

  if (enableOcr) {
    for (const [index, mediaFile] of mediaFiles.entries()) {
      assertNotAborted(signal);

      try {
        const imageBlob = await mediaFile.async("blob");
        const ocrResult = await recognizeTextFromImage(imageBlob);
        assertNotAborted(signal);

        if (ocrResult.usable && ocrResult.text.length > 0) {
          pages.push({ pageNumber: null, text: ocrResult.text });
          ocrPageCount += 1;
        } else if (ocrResult.warning) {
          ignoredOcrImages.push(index + 1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown OCR error";
        warnings.push(`OCR failed on embedded DOCX image ${index + 1}: ${message}`);
      }
    }
  }

  if (ignoredOcrImages.length > 0) {
    warnings.push(summarizeSkippedOcr("embedded DOCX image", ignoredOcrImages));
  }

  const totalTextLength = pages.reduce((sum, page) => sum + page.text.length, 0);

  return {
    fileName: file.name,
    fileSize: file.size,
    pages,
    totalTextLength,
    warnings,
    ocrPageCount
  };
}

async function extractImageOnce(
  file: File,
  signal?: AbortSignal,
  enableOcr = true
): Promise<ExtractedPdf> {
  assertNotAborted(signal);

  if (!enableOcr) {
    throw new Error(`Image OCR is disabled, so "${file.name}" could not be read.`);
  }

  const ocrResult = await recognizeTextFromImage(file);
  assertNotAborted(signal);

  return {
    fileName: file.name,
    fileSize: file.size,
    pages: ocrResult.usable && ocrResult.text.length > 0 ? [{ pageNumber: 1, text: ocrResult.text }] : [],
    totalTextLength: ocrResult.usable ? ocrResult.text.length : 0,
    warnings: ocrResult.warning ? [ocrResult.warning] : [],
    ocrPageCount: ocrResult.usable && ocrResult.text.length > 0 ? 1 : 0
  };
}

async function extractOnce(
  file: File,
  signal?: AbortSignal,
  enableOcr = true
): Promise<ExtractedPdf> {
  if (isPdfFile(file)) {
    return extractPdfOnce(file, signal, enableOcr);
  }

  if (isDocxFile(file)) {
    return extractDocxOnce(file, signal, enableOcr);
  }

  return extractImageOnce(file, signal, enableOcr);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function extractPdfWithRetry(
  file: File,
  retries = 2,
  signal?: AbortSignal,
  enableOcr = true
): Promise<ExtractedPdf> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await extractOnce(file, signal, enableOcr);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(250 * (attempt + 1));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown extraction error";
  throw new Error(`Failed to process "${file.name}" after ${retries + 1} attempt(s): ${message}`);
}
