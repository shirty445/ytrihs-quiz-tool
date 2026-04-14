import * as pdfjsLib from "pdfjs-dist";
import type { ExtractedPdf, PdfPageText } from "@/lib/types";

let workerConfigured = false;

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

async function extractOnce(file: File, signal?: AbortSignal): Promise<ExtractedPdf> {
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

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      assertNotAborted(signal);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const pageText = normalizeExtractedText(
        textContent.items
          .map((item) => {
            if ("str" in item) {
              return item.str;
            }
            return "";
          })
          .join(" ")
      );

      if (pageText.length > 0) {
        pages.push({ pageNumber, text: pageText });
      }

      page.cleanup();
    }
  } finally {
    pdf.cleanup();
    pdf.destroy();
  }

  const totalTextLength = pages.reduce((sum, page) => sum + page.text.length, 0);

  return {
    fileName: file.name,
    fileSize: file.size,
    pages,
    totalTextLength
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function extractPdfWithRetry(
  file: File,
  retries = 2,
  signal?: AbortSignal
): Promise<ExtractedPdf> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await extractOnce(file, signal);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(250 * (attempt + 1));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown PDF extraction error";
  throw new Error(`Failed to process "${file.name}" after ${retries + 1} attempt(s): ${message}`);
}
