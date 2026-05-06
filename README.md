# shirty's quiz tool (No Direct AI API Integration)

This is a Next.js + TypeScript MVP web app that turns uploaded PDFs, DOCX files, or image-based source material into **one master prompt** for external AI tools (ChatGPT, Claude, Gemini, etc.), then validates/parses returned JSON into a usable editable quiz.

The app does **not** require OpenAI keys and does **not** call any LLM API directly.

## What It Does

1. Upload one or many PDFs, DOCX files, or images by file picker or drag-and-drop (supports large batches, including 30+ files).
2. Extract text from each file independently, with OCR fallback for scanned PDF pages and embedded DOCX images.
3. Chunk, deduplicate, and compress source text into a prompt-safe source packet.
4. Generate strict external-AI prompts from the processed source packet.
5. Split larger jobs into multiple prompt-safe batches when needed.
6. Let user choose prompt density, questions per prompt, 4 or 5 answer choices, optional compact response mode, and extra prompt instructions.
7. Let user paste each AI JSON batch output back into the app.
8. Auto-rebalance correct answer positions so the final quiz is not stuck on one option slot.
9. Merge, deduplicate, and validate the growing quiz bank.
10. Export quiz as JSON, CSV, or standalone HTML.

## Tech Stack

- Next.js (App Router)
- TypeScript
- `pdfjs-dist` for PDF text extraction
- `tesseract.js` for OCR
- `jszip` for DOCX extraction
- `zod` for strict JSON/schema validation

## Project Structure

```text
app/
  globals.css
  layout.tsx
  page.tsx
components/
  file-status-list.tsx
  quiz-builder-app.tsx
  quiz-editor.tsx
  stage-indicator.tsx
lib/
  ocr/
    recognize.ts
  types.ts
  pdf/
    extract.ts
    process-pdfs.ts
  prompt/
    build-master-prompt.ts
  quiz/
    export.ts
    html.ts
    options.ts
    parse.ts
    schema.ts
  text/
    chunking.ts
    compression.ts
public/
  sample-ai-response.json
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

## External-AI Workflow

Inside the app:

1. Upload PDFs, DOCX files, or images and set difficulty/topic focus.
2. Choose a target question count.
3. Choose prompt mode, questions per prompt, answer choice count, OCR behavior, and optional compact response format.
4. Click **Generate Prompt Queue**.
5. Copy or edit the current prompt batch.
6. Paste it into your preferred AI model.
7. Paste that batch response into this app and parse it.
8. If the model returns too few or too many questions, the app advises moving to a lighter mode.
9. Repeat until the queue is complete.
10. Edit questions if needed.
11. Export JSON, CSV, or standalone HTML.

## Required AI JSON Shape

The parser expects this strict format, with either 4 or 5 options depending on your selected setting:

```json
{
  "questions": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "string",
      "explanation": "string",
      "source": {
        "file": "string",
        "page": "string",
        "chunkId": "string"
      }
    }
  ]
}
```

Validation rules:

- At least 1 question.
- Exactly 4 or 5 options per question, matching the current batch setting.
- `correctAnswer` must match one of that question's options.
- `explanation` required.
- `source.file`, `source.page`, `source.chunkId` required.
- If page is unknown, it should be `"unknown"` but chunkId must still exist.

The app now uses a prompt queue for larger runs. Each batch prompt requests a bounded number of questions so the AI response does not get cut off by output limits.

Compact response mode, 5-choice mode, and extra prompt instructions are implemented as isolated parser/prompt features so they can be adjusted without rewriting the main quiz data model.

## Reliability and Scale Strategy

- Per-file independent extraction so one bad PDF/DOCX/image does not crash the run.
- Retries for extraction failures.
- Warning for low/no extractable text.
- OCR fallback for scanned PDF pages and embedded DOCX images.
- Chunking with overlap for large sources.
- Heuristic compression and scoring.
- Dedupe within file and globally.
- Prompt-safe caps (chunk and character budgets) to avoid giant unusable prompts.
- Coverage-first chunk selection so multiple files stay represented.

## Notes

- This app is strongest on normal text PDFs and DOCX files, with OCR fallback when the source content is image-based.
- OCR is browser-side, so scanned PDFs and embedded DOCX images may take longer to process than text-native documents.
- No direct LLM integration is present by design.
- The standalone HTML export opens directly in browsers and includes a front-page question index plus a one-question-at-a-time quiz mode.
- The review editor is collapsed by default so the main workflow stays lighter unless you want to manually revise the merged quiz.
- Correct answer positions are rebalanced after parsing so the final quiz is not overly biased toward one option letter, including 5-choice batches.

## Optional Test Payload

Use `public/sample-ai-response.json` as a known-valid response example.
