# shirty's quiz tool

A Next.js + TypeScript web app that turns uploaded PDFs, DOCX files, or image-based source material into a quiz.

It works two ways:

- **Local AI (one button).** Point it at a model server you run — Ollama, LM Studio, llama.cpp, vLLM, anything OpenAI-compatible — on this machine or across Tailscale, then press **Generate All Questions**. Requests are proxied through the app's own server, so the model server needs no CORS setup.
- **Copy/paste (no API needed).** The original flow: the app builds a prompt queue, you paste each prompt into ChatGPT/Claude/Gemini and paste the JSON back.

No cloud API keys are ever required.

## What It Does

1. Upload one or many PDFs, DOCX files, or images by file picker or drag-and-drop (supports large batches, including 30+ files).
2. Extract text from each file independently, with OCR fallback for scanned PDF pages and embedded DOCX images.
3. Chunk, deduplicate, and score source text into a source packet.
4. Plan a prompt queue that covers every chunk of the source.
5. Either run the whole queue through a local model, or copy/paste each prompt by hand.
6. Validate every response against a strict schema, and feed validation errors back to the model to repair bad JSON automatically.
7. Rebalance correct answer positions so the quiz has no readable answer pattern.
8. Merge and deduplicate the growing quiz bank, catching reworded near-duplicates.
9. Report source coverage, and fill any gaps with a one-click follow-up run.
10. Audit the bank for gameable questions (answer-is-longest, "All of the above", duplicate options, ungrounded citations).
11. Write a **deep review** for each question: why the right answer is right, why each wrong answer is tempting, the facts to memorize, and the trap it sets.
12. Export quiz as JSON, CSV, or a standalone interactive HTML quiz.

## Connecting A Local Model

1. Start your model server. For Ollama:

```bash
ollama serve
ollama pull qwen2.5:7b
```

2. In the app, open **3) Local AI Connection**, enter the base URL, and click **Test Connection**.

| Server | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp / vLLM | `http://localhost:8080/v1` |
| Over Tailscale | `http://your-box.tailnet-name.ts.net:11434` |

The app detects which kind of server it is and lists the models it has. When available, it constrains decoding with a JSON schema (Ollama `format`, OpenAI-compatible `response_format`), falling back to plain JSON mode and then to the repair loop for servers that do not support it.

### Environment Variables

Both are optional.

| Variable | Purpose |
| --- | --- |
| `AI_DEFAULT_BASE_URL` | Base URL prefilled when none is supplied. Defaults to `http://localhost:11434`. |
| `AI_ALLOWED_HOSTS` | Comma-separated hostnames to allow in addition to the built-in local/private/tailnet set. |

### A Note On The Proxy

`/api/ai/*` forwards to a base URL supplied by the browser, so it is restricted to loopback, RFC1918, CGNAT (`100.64.0.0/10`, Tailscale), `*.ts.net`, and `*.local`. Public addresses are refused with a 400 unless listed in `AI_ALLOWED_HOSTS`. Keep it that way if you ever host this app somewhere other than your own machine.

## Tech Stack

- Next.js (App Router) with two server route handlers for the local-AI proxy
- TypeScript
- `pdfjs-dist` for PDF text extraction
- `tesseract.js` for OCR
- `jszip` for DOCX extraction
- `zod` for strict JSON/schema validation

## Project Structure

```text
app/
  api/ai/generate/route.ts   proxy to the model server (SSRF-guarded)
  api/ai/models/route.ts     model discovery + provider detection
  globals.css
  layout.tsx
  page.tsx
components/
  ai-connection-panel.tsx
  audit-panel.tsx
  coverage-panel.tsx
  enrichment-panel.tsx
  file-status-list.tsx
  quiz-builder-app.tsx
  quiz-editor.tsx
  stage-indicator.tsx
lib/
  ai/
    allowlist.ts             which hosts the proxy may reach
    client.ts                browser -> own API routes
    provider.ts              Ollama vs OpenAI-compatible shaping
    run-autofix.ts           rewrite audit-flagged questions
    run-enrichment.ts        deep-review pass
    run-quiz-generation.ts   generation + validate/repair loop
  ocr/
    recognize.ts
  types.ts
  pdf/
    extract.ts
    process-pdfs.ts
  prompt/
    build-master-prompt.ts
    build-review-prompt.ts
    modes.ts
    plan.ts
  quiz/
    audit.ts
    compact.ts
    coverage.ts
    export.ts
    html.ts
    ingest.ts                shared parse -> rebalance -> merge path
    merge.ts
    options.ts
    parse.ts
    quality.ts
    review-parse.ts
    schema.ts
  storage/
    workspace.ts             localStorage autosave/restore
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

## Coverage And Question Quality

**Coverage mode** decides what happens when the source has more material than your question target covers.

- *Coverage first* (default) treats the target as a floor: every source chunk is guaranteed at least one question, and the app tells you the real count before it runs.
- *Target first* never exceeds your count and instead reports which chunks went unused, with a one-click **Generate Questions For Uncovered Content** run.

**Source detail** decides how much of each chunk reaches the model. *Full* sends the raw chunk text and is the default once a local model is connected; *compressed* sends a summary and is the right choice for copy/paste, where prompt length matters.

The **Source Coverage** panel also flags questions citing a `chunkId` that is not in the source packet, which is a direct signal that the model invented its citation.

The **Quality Audit** panel flags gameable questions: the answer being the longest option, duplicate option text, "All of the above", negative stems, absolutes that appear only in distractors, stems copied verbatim from the source, and near-duplicates. With a local model connected, **Auto-Fix Flagged Questions** rewrites them against their source text.

## Deep Answer Reviews

A second pass over the finished bank. For each question it re-reads the **full** source chunk (not the compressed summary the question came from) and writes:

- the principle being tested
- why the correct answer is right
- a rationale per option, including what each wrong answer *would* be the correct answer to
- key facts worth memorizing, plus a memory hook
- the specific trap the question sets
- a verbatim supporting quote from the source

This runs automatically with a local model, or through **Use Copy/Paste Mode** with any external AI. It is stored on the question and baked into the HTML export, so it works offline.

In the exported quiz, getting a question wrong shows your own mistake first, requires an explicit "I have read this" before you can move on, and puts the question into a Leitner drill queue that it only leaves after two correct answers in a row.

## Workspace Autosave

Settings, the AI connection, extracted source chunks, the prompt queue, and the collected quiz are autosaved to `localStorage`, so a refresh part-way through a long unattended run does not cost you the work. Uploaded files themselves are not saved — the chunks extracted from them are, which is what the rest of the pipeline needs.

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

`review` is an optional extra field on a question, produced by the enrichment pass. Quizzes without it still validate and still work.

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
- The local-AI path is optional. Everything still works through copy/paste alone.
- The standalone HTML export opens directly in browsers and includes a front-page question index plus a one-question-at-a-time quiz mode.
- The review editor is collapsed by default so the main workflow stays lighter unless you want to manually revise the merged quiz.
- Correct answer positions are rebalanced after parsing using a balanced shuffle, so the quiz is neither biased toward one letter nor a predictable A,B,C,D cycle.
- `npm run lint` is currently broken: Next 16 removed `next lint`, and the repo still carries an ESLint 8-style `.eslintrc.json`. Use `npm run typecheck` and `npm run build`.

## Optional Test Payload

Use `public/sample-ai-response.json` as a known-valid response example.
