import { createWorker, PSM, type RecognizeResult } from "tesseract.js";

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type OcrImageInput = Parameters<OcrWorker["recognize"]>[0];
type OcrPage = RecognizeResult["data"];

export interface OcrTextResult {
  text: string;
  confidence: number;
  usable: boolean;
  warning: string | null;
}

interface OcrAttemptResult extends OcrTextResult {
  qualityScore: number;
}

const OCR_TARGET_WIDTH = 1800;
const OCR_MAX_SCALE = 3;
const OCR_MIN_TEXT_LENGTH = 12;
const OCR_SHORT_TEXT_MIN_CONFIDENCE = 68;
const OCR_MIN_PAGE_CONFIDENCE = 42;
const OCR_MIN_AVERAGE_WORD_CONFIDENCE = 45;
const OCR_MIN_ALPHANUMERIC_RATIO = 0.55;
const OCR_MAX_SYMBOL_RATIO = 0.16;
const OCR_MIN_DICTIONARY_WORD_RATIO = 0.18;
const OCR_MIN_CONFIDENT_WORD_RATIO = 0.45;
const OCR_MIN_CLEAN_WORD_RATIO = 0.55;

let workerPromise: Promise<OcrWorker> | null = null;

function normalizeOcrText(text: string): string {
  return text
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function normalizeWord(word: string): string {
  return word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim();
}

function isCanvasElement(value: unknown): value is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement;
}

function isCanvasContext(value: unknown): value is CanvasRenderingContext2D {
  return typeof CanvasRenderingContext2D !== "undefined" && value instanceof CanvasRenderingContext2D;
}

function isImageDataValue(value: unknown): value is ImageData {
  return typeof ImageData !== "undefined" && value instanceof ImageData;
}

function isImageBitmapValue(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;
}

function isImageElement(value: unknown): value is HTMLImageElement {
  return typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement;
}

function isVideoElement(value: unknown): value is HTMLVideoElement {
  return typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement;
}

function isOffscreenCanvasValue(value: unknown): value is OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function getSourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (isImageElement(source)) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height
    };
  }

  if (isVideoElement(source)) {
    return {
      width: source.videoWidth || source.width,
      height: source.videoHeight || source.height
    };
  }

  return {
    width: (source as { width: number }).width,
    height: (source as { height: number }).height
  };
}

function scaleCanvasSource(source: CanvasImageSource): HTMLCanvasElement {
  const { width, height } = getSourceDimensions(source);
  const scale = Math.min(OCR_MAX_SCALE, Math.max(1, OCR_TARGET_WIDTH / Math.max(width, 1)));
  const canvas = createCanvas(width * scale, height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas rendering is unavailable for OCR.");
  }

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function loadBlobImageSource(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };

        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Unable to decode image for OCR."));
        };

        image.src = objectUrl;
      });
    }
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode image for OCR."));
    };

    image.src = objectUrl;
  });
}

async function prepareBaseCanvas(image: OcrImageInput): Promise<HTMLCanvasElement | null> {
  if (isCanvasElement(image)) {
    return scaleCanvasSource(image);
  }

  if (isCanvasContext(image)) {
    return scaleCanvasSource(image.canvas);
  }

  if (isImageDataValue(image)) {
    const sourceCanvas = createCanvas(image.width, image.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });

    if (!sourceContext) {
      throw new Error("Canvas rendering is unavailable for OCR.");
    }

    sourceContext.putImageData(image, 0, 0);
    return scaleCanvasSource(sourceCanvas);
  }

  if (isImageElement(image) || isVideoElement(image) || isImageBitmapValue(image)) {
    return scaleCanvasSource(image);
  }

  if (isOffscreenCanvasValue(image)) {
    return scaleCanvasSource(image);
  }

  if (image instanceof Blob) {
    const source = await loadBlobImageSource(image);
    return scaleCanvasSource(source);
  }

  return null;
}

function findHistogramPercentile(
  histogram: Uint32Array,
  total: number,
  percentile: number
): number {
  const target = total * percentile;
  let running = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    running += histogram[value];
    if (running >= target) {
      return value;
    }
  }

  return histogram.length - 1;
}

function calculateOtsuThreshold(histogram: Uint32Array, totalPixels: number): number {
  let total = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    total += value * histogram[value];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let value = 0; value < histogram.length; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (total - sumBackground) / weightForeground;
    const betweenClassVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (betweenClassVariance > maxVariance) {
      maxVariance = betweenClassVariance;
      threshold = value;
    }
  }

  return threshold;
}

function enhanceCanvasForOcr(baseCanvas: HTMLCanvasElement, thresholded: boolean): HTMLCanvasElement {
  const canvas = createCanvas(baseCanvas.width, baseCanvas.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas rendering is unavailable for OCR.");
  }

  context.drawImage(baseCanvas, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const grayscaleValues = new Uint8ClampedArray(imageData.data.length / 4);
  const histogram = new Uint32Array(256);

  for (let offset = 0, pixelIndex = 0; offset < imageData.data.length; offset += 4, pixelIndex += 1) {
    const grayscale = Math.round(
      imageData.data[offset] * 0.299 +
        imageData.data[offset + 1] * 0.587 +
        imageData.data[offset + 2] * 0.114
    );

    grayscaleValues[pixelIndex] = grayscale;
    histogram[grayscale] += 1;
  }

  const lowerBound = findHistogramPercentile(histogram, grayscaleValues.length, 0.02);
  const upperBound = findHistogramPercentile(histogram, grayscaleValues.length, 0.98);
  const range = Math.max(1, upperBound - lowerBound);
  const normalizedHistogram = new Uint32Array(256);

  for (let pixelIndex = 0; pixelIndex < grayscaleValues.length; pixelIndex += 1) {
    const stretched = Math.max(
      0,
      Math.min(255, Math.round(((grayscaleValues[pixelIndex] - lowerBound) * 255) / range))
    );
    grayscaleValues[pixelIndex] = stretched;
    normalizedHistogram[stretched] += 1;
  }

  const threshold = thresholded
    ? calculateOtsuThreshold(normalizedHistogram, grayscaleValues.length)
    : 0;

  for (let offset = 0, pixelIndex = 0; offset < imageData.data.length; offset += 4, pixelIndex += 1) {
    let outputValue = grayscaleValues[pixelIndex];

    if (thresholded) {
      outputValue = outputValue >= threshold ? 255 : 0;
    } else {
      if (outputValue <= 12) {
        outputValue = 0;
      } else if (outputValue >= 245) {
        outputValue = 255;
      }
    }

    imageData.data[offset] = outputValue;
    imageData.data[offset + 1] = outputValue;
    imageData.data[offset + 2] = outputValue;
    imageData.data[offset + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function evaluateOcrPage(page: OcrPage): OcrAttemptResult {
  const text = normalizeOcrText(page.text);
  const visibleLength = text.replace(/\s+/g, "").length;
  const alphanumericCount = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const supportedPunctuationCount = (text.match(/[.,;:!?'"“”‘’()[\]{}\-–—/%&+=_*]/g) ?? []).length;
  const symbolCount = Math.max(0, visibleLength - alphanumericCount - supportedPunctuationCount);
  const alphaNumericRatio = visibleLength > 0 ? alphanumericCount / visibleLength : 0;
  const symbolRatio = visibleLength > 0 ? symbolCount / visibleLength : 1;
  const words = page.words
    .map((word) => ({
      text: normalizeWord(word.text),
      confidence: word.confidence,
      inDictionary: word.in_dictionary
    }))
    .filter((word) => word.text.length > 0);
  const alphaWords = words.filter((word) => /[A-Za-z]/.test(word.text));
  const cleanWords = words.filter((word) =>
    /^[A-Za-z0-9]+(?:[’'/-][A-Za-z0-9]+)*$/.test(word.text)
  ).length;
  const confidentWords = words.filter((word) => word.confidence >= 55).length;
  const averageWordConfidence =
    words.length > 0
      ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
      : page.confidence;
  const confidentWordRatio = words.length > 0 ? confidentWords / words.length : 0;
  const cleanWordRatio = words.length > 0 ? cleanWords / words.length : 0;
  const dictionaryWordRatio =
    alphaWords.length > 0
      ? alphaWords.filter((word) => word.inDictionary && word.text.length >= 3).length /
        alphaWords.length
      : 0;
  const shortText =
    text.length < OCR_MIN_TEXT_LENGTH ||
    (words.length < 3 && alphaWords.length < 2);
  const shortTextAccepted =
    text.length > 0 &&
    page.confidence >= OCR_SHORT_TEXT_MIN_CONFIDENCE &&
    alphaNumericRatio >= 0.7 &&
    symbolRatio <= 0.08;
  const lexicalSignal =
    dictionaryWordRatio >= OCR_MIN_DICTIONARY_WORD_RATIO &&
    averageWordConfidence >= 38;
  const confidenceSignal =
    page.confidence >= OCR_MIN_PAGE_CONFIDENCE &&
    averageWordConfidence >= OCR_MIN_AVERAGE_WORD_CONFIDENCE &&
    confidentWordRatio >= OCR_MIN_CONFIDENT_WORD_RATIO &&
    cleanWordRatio >= OCR_MIN_CLEAN_WORD_RATIO;
  const usable =
    text.length > 0 &&
    (shortTextAccepted ||
      (!shortText &&
        alphaNumericRatio >= OCR_MIN_ALPHANUMERIC_RATIO &&
        symbolRatio <= OCR_MAX_SYMBOL_RATIO &&
        (lexicalSignal || confidenceSignal)));
  let warning: string | null = null;

  if (!usable) {
    warning =
      text.length === 0
        ? "OCR did not detect readable text."
        : `Ignored low-confidence OCR output (${Math.round(page.confidence)}% confidence).`;
  }

  const qualityScore =
    page.confidence * 0.45 +
    averageWordConfidence * 0.25 +
    confidentWordRatio * 22 +
    cleanWordRatio * 12 +
    dictionaryWordRatio * 16 +
    alphaNumericRatio * 10 -
    symbolRatio * 60 +
    Math.min(text.length, 240) * 0.05 +
    (usable ? 18 : -25);

  return {
    text,
    confidence: page.confidence,
    usable,
    warning,
    qualityScore
  };
}

async function getWorker(): Promise<OcrWorker> {
  if (typeof window === "undefined") {
    throw new Error("OCR is only available in the browser.");
  }

  workerPromise ??= createWorker("eng", 1, {
    logger: () => undefined
  });

  return workerPromise;
}

async function runOcrAttempt(
  worker: OcrWorker,
  image: OcrImageInput,
  psm: PSM
): Promise<OcrAttemptResult> {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: psm,
    user_defined_dpi: "300"
  });

  const { data } = await worker.recognize(image, {
    rotateAuto: true
  });

  return evaluateOcrPage(data);
}

export async function recognizeTextFromImage(image: OcrImageInput): Promise<OcrTextResult> {
  const worker = await getWorker();
  const baseCanvas = await prepareBaseCanvas(image);
  const preparedImage = baseCanvas ?? image;
  const contrastImage = baseCanvas ? enhanceCanvasForOcr(baseCanvas, false) : preparedImage;
  const firstAttempt = await runOcrAttempt(worker, contrastImage, PSM.AUTO);

  if (firstAttempt.usable && firstAttempt.qualityScore >= 90) {
    return firstAttempt;
  }

  const binaryImage = baseCanvas ? enhanceCanvasForOcr(baseCanvas, true) : preparedImage;
  const secondAttempt = await runOcrAttempt(worker, binaryImage, PSM.SINGLE_BLOCK);
  const bestAttempt =
    secondAttempt.qualityScore > firstAttempt.qualityScore ? secondAttempt : firstAttempt;

  return {
    text: bestAttempt.usable ? bestAttempt.text : "",
    confidence: bestAttempt.confidence,
    usable: bestAttempt.usable,
    warning: bestAttempt.warning
  };
}
