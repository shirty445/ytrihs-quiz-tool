import type { QuizPayload } from "@/lib/types";
import { describeAnswerChoiceCounts } from "@/lib/quiz/options";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(payload: QuizPayload): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Identity of a quiz for progress-storage purposes.
 *
 * Hashing the whole payload meant that fixing one typo, or attaching deep
 * reviews, silently orphaned every saved answer. Stems alone, sorted, keep
 * progress attached across edits that do not change what is being asked.
 */
function quizIdentity(payload: QuizPayload): string {
  return payload.questions
    .map((question) =>
      question.question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .sort()
    .join("|");
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function quizToHtml(payload: QuizPayload, title = "Interactive Quiz"): string {
  const questionCount = payload.questions.length;
  const escapedTitle = escapeHtml(title);
  const serializedQuiz = safeJson(payload);
  const answerChoiceCopy = escapeHtml(describeAnswerChoiceCounts(payload));
  const quizStateStorageKey = `quiz-export-state-${hashString(`${title}|${quizIdentity(payload)}`)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      --bg: #000000;
      --text: #ffffff;
      --line: #ffffff;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: "Times New Roman", Times, serif;
    }

    .shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 56px;
    }

    .hero {
      text-align: center;
      padding: 52px 22px 26px;
    }

    .eyebrow {
      margin: 0 0 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.72rem;
    }

    h1, h2, h3 {
      margin: 0;
      font-family: "Times New Roman", Times, serif;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    h1 {
      font-size: clamp(3rem, 10vw, 5.5rem);
      line-height: 0.9;
    }

    .hero-copy {
      width: min(620px, 100%);
      margin: 18px auto 0;
      line-height: 1.7;
      font-size: 0.98rem;
    }

    .toolbar,
    .card,
    .question-row,
    .option-button,
    .nav-button {
      border: 1px solid var(--line);
    }

    .toolbar {
      display: flex;
      gap: 14px;
      align-items: center;
      justify-content: flex-start;
      flex-wrap: nowrap;
      padding: 16px 18px;
      margin-bottom: 24px;
      background: #000000;
      overflow-x: auto;
    }

    .toolbar-copy {
      font-size: 0.92rem;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .toolbar-actions {
      display: flex;
      gap: 10px;
      flex-wrap: nowrap;
      align-items: center;
      margin-left: auto;
      flex: 0 0 auto;
    }

    .toolbar-group {
      display: flex;
      gap: 10px;
      flex-wrap: nowrap;
      flex: 0 0 auto;
    }

    .sound-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: nowrap;
      flex: 0 0 auto;
    }

    .sound-label {
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .sound-select {
      appearance: none;
      background: #000000;
      color: var(--text);
      border: 1px solid var(--line);
      padding: 10px 14px;
      font: inherit;
      min-width: 220px;
    }

    button {
      appearance: none;
      background: #000000;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      transition: none;
    }

    button:hover {
      background: #ffffff;
      color: #000000;
    }

    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      background: #000000;
      color: #ffffff;
    }

    .nav-button {
      padding: 10px 16px;
    }

    .view {
      display: none;
    }

    .view.active {
      display: block;
    }

    .card {
      padding: 24px;
      background: #000000;
    }

    .stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin: 0 0 22px;
      padding: 0;
      list-style: none;
    }

    .stats li {
      padding: 10px 14px;
      border: 1px solid var(--line);
      font-size: 0.85rem;
    }

    .question-list {
      display: grid;
      gap: 14px;
    }

    .question-row {
      width: 100%;
      background: #000000;
      padding: 18px;
      text-align: left;
    }

    .question-row strong {
      display: block;
      font-size: 1rem;
      line-height: 1.5;
      margin-bottom: 8px;
    }

    .question-row span {
      font-size: 0.84rem;
    }

    .question-row em {
      display: block;
      margin-bottom: 8px;
      font-size: 0.82rem;
      font-style: normal;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .question-row.correct {
      background: #ffffff;
      color: #000000;
    }

    .question-row.incorrect {
      background: #000000;
      color: #ffffff;
      border-left: 6px solid #ffffff;
    }

    .quiz-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
      font-size: 0.88rem;
    }

    .quiz-title {
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1;
      margin-bottom: 14px;
    }

    .options {
      display: grid;
      gap: 12px;
      margin: 20px 0 0;
    }

    .option-button {
      padding: 16px;
      text-align: left;
      line-height: 1.5;
    }

    .option-button.is-selected {
      background: #000000;
    }

    .option-button.correct {
      background: #ffffff;
      color: #000000;
      font-weight: 700;
    }

    /*
     * These two used to be byte-identical, so after a wrong answer the learner
     * could not tell which white button was their pick and which was the
     * answer. Correct is solid; incorrect is inverted with a heavy rule.
     */
    .option-button.incorrect {
      background: #000000;
      color: #ffffff;
      border-left: 6px solid #ffffff;
      text-decoration: line-through;
    }

    .option-mark {
      display: inline-block;
      min-width: 1.6em;
      font-weight: 700;
    }

    .feedback {
      display: none;
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }

    .feedback.active {
      display: block;
    }

    .feedback p {
      line-height: 1.75;
      margin: 0 0 10px;
    }

    .verdict {
      display: block;
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 10px 14px;
      margin-bottom: 16px;
      border: 1px solid var(--line);
    }

    .verdict.is-correct {
      background: #ffffff;
      color: #000000;
    }

    .verdict.is-incorrect {
      background: #000000;
      color: #ffffff;
      border-width: 3px;
    }

    .review {
      margin-top: 18px;
      border-top: 1px solid var(--line);
      padding-top: 16px;
    }

    .review[hidden] {
      display: none;
    }

    .review-section {
      margin-bottom: 18px;
    }

    .review-section h3 {
      font-size: 0.82rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 8px;
    }

    .review-section p {
      margin: 0 0 8px;
      line-height: 1.75;
    }

    .review-your-pick {
      border: 3px solid var(--line);
      padding: 14px;
      margin-bottom: 18px;
    }

    .review-list {
      margin: 0;
      padding-left: 20px;
      line-height: 1.75;
    }

    .review-list li {
      margin-bottom: 6px;
    }

    .review-option {
      border-left: 3px solid var(--line);
      padding-left: 12px;
      margin-bottom: 12px;
      line-height: 1.7;
    }

    .review-option strong {
      display: block;
      margin-bottom: 4px;
    }

    .review-quote {
      border-left: 3px solid var(--line);
      padding-left: 12px;
      margin: 0 0 8px;
      line-height: 1.7;
      font-style: italic;
    }

    .review-toggle {
      margin-bottom: 14px;
    }

    .ack-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 16px;
    }

    .ack-note {
      font-size: 0.86rem;
    }

    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .results-tile {
      border: 1px solid var(--line);
      padding: 16px;
    }

    .results-tile strong {
      display: block;
      font-size: 2.2rem;
      line-height: 1;
      margin-bottom: 6px;
    }

    .results-tile span {
      font-size: 0.84rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .quiz-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 20px;
    }

    .footer-note {
      margin-top: 14px;
      font-size: 0.82rem;
    }

    .miss-mark-panel {
      display: none;
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }

    .miss-mark-panel.active {
      display: block;
    }

    .miss-mark-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .miss-mark-title {
      margin: 0 0 6px;
      font-size: 0.86rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .miss-mark-copy {
      margin: 0;
      line-height: 1.65;
      font-size: 0.88rem;
    }

    .miss-mark-list {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    .miss-mark-chip {
      min-width: 44px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .empty-state {
      margin: 0;
      line-height: 1.7;
    }

    @media (max-width: 720px) {
      .shell {
        width: min(100% - 20px, 1080px);
        padding-top: 18px;
      }

      .card {
        padding: 18px;
      }

      .toolbar {
        padding: 14px;
      }

      .sound-controls {
        width: auto;
      }

      .sound-select {
        min-width: 0;
        flex: 0 0 220px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <p class="eyebrow">Standalone quiz export</p>
      <h1>${escapedTitle}</h1>
      <p class="hero-copy">Open this file in any browser. Start from any question in the index, answer one multiple-choice question at a time, and move forward through the full quiz.</p>
    </header>

    <div class="toolbar">
      <div class="toolbar-copy" id="toolbarCopy">Question index view</div>
      <div class="toolbar-actions">
        <div class="sound-controls">
          <label class="sound-label" for="correctSoundSelect">Correct sound</label>
          <select class="sound-select" id="correctSoundSelect">
            <option value="marioCoin">Mario-style Coin</option>
            <option value="sonicRing">Sonic-style Ring</option>
            <option value="zeldaSecret">Zelda-style Secret</option>
            <option value="oofSound">Oof</option>
          </select>
          <button class="nav-button" id="previewSoundButton" type="button">Preview sound</button>
        </div>
        <div class="toolbar-group">
          <button class="nav-button" id="indexButton" type="button">Question index</button>
          <button class="nav-button" id="missedButton" type="button">Missed questions (0)</button>
          <button class="nav-button" id="restartButton" type="button">Restart from first</button>
        </div>
      </div>
    </div>

    <section class="view active" id="indexView">
      <div class="card">
        <ul class="stats">
          <li>${questionCount} total question${questionCount === 1 ? "" : "s"}</li>
          <li>${answerChoiceCopy}</li>
          <li>Browser-openable HTML</li>
        </ul>
        <div class="question-list" id="questionList"></div>
      </div>
    </section>

    <section class="view" id="missedView">
      <div class="card">
        <ul class="stats">
          <li id="missedTotalStat">0 missed questions recorded</li>
          <li id="missedPendingStat">0 still need retry</li>
          <li id="missedCorrectedStat">0 corrected after retry</li>
        </ul>
        <p class="empty-state" id="missedEmpty">Questions you get wrong will appear here so you can revisit them later.</p>
        <div class="question-list" id="missedQuestionList"></div>
      </div>
    </section>

    <section class="view" id="resultsView">
      <div class="card">
        <h2 class="quiz-title">Session results</h2>
        <div class="results-grid">
          <div class="results-tile"><strong id="resultScore">0%</strong><span>Accuracy</span></div>
          <div class="results-tile"><strong id="resultCorrect">0</strong><span>First-try correct</span></div>
          <div class="results-tile"><strong id="resultMissed">0</strong><span>Missed at least once</span></div>
          <div class="results-tile"><strong id="resultMastered">0</strong><span>Mastered</span></div>
        </div>
        <p id="resultSummary"></p>
        <h3 id="resultBreakdownHeading">By source file</h3>
        <div class="question-list" id="resultBreakdown"></div>
        <div class="quiz-actions">
          <button class="nav-button" id="resultDrillButton" type="button">Drill the ones you missed</button>
          <button class="nav-button" id="resultIndexButton" type="button">Back to index</button>
        </div>
      </div>
    </section>

    <section class="view" id="quizView">
      <div class="card">
        <div class="quiz-meta">
          <span id="progressLabel"></span>
          <span id="sourceLabel"></span>
        </div>
        <h2 class="quiz-title" id="questionText"></h2>
        <div class="options" id="options"></div>
        <div class="feedback" id="feedback">
          <span class="verdict" id="verdict"></span>
          <p><strong>Explanation:</strong> <span id="explanationText"></span></p>
          <p><strong>Source:</strong> <span id="sourceText"></span></p>

          <button class="nav-button review-toggle" id="reviewToggle" type="button">Hide deep review</button>

          <div class="review" id="reviewPanel">
            <div class="review-your-pick" id="reviewYourPick" hidden>
              <h3 id="reviewYourPickHeading">Why your answer was wrong</h3>
              <p id="reviewYourPickText"></p>
            </div>

            <div class="review-section" id="reviewCoreIdeaSection">
              <h3>The idea being tested</h3>
              <p id="reviewCoreIdea"></p>
            </div>

            <div class="review-section" id="reviewWhyCorrectSection">
              <h3 id="reviewWhyCorrectHeading">Why the correct answer is right</h3>
              <p id="reviewWhyCorrect"></p>
            </div>

            <div class="review-section" id="reviewOptionsSection">
              <h3>Every option, one by one</h3>
              <div id="reviewOptions"></div>
            </div>

            <div class="review-section" id="reviewFactsSection">
              <h3>Remember this</h3>
              <ul class="review-list" id="reviewFacts"></ul>
              <p id="reviewMemoryHook"></p>
            </div>

            <div class="review-section" id="reviewTrapSection">
              <h3>The trap</h3>
              <p id="reviewTrap"></p>
            </div>

            <div class="review-section" id="reviewQuoteSection">
              <h3>From the source</h3>
              <blockquote class="review-quote" id="reviewQuote"></blockquote>
            </div>
          </div>

          <div class="ack-row" id="ackRow" hidden>
            <button class="nav-button" id="ackButton" type="button">I have read this</button>
            <span class="ack-note" id="ackNote">Read the breakdown before moving on. This question comes back later.</span>
          </div>
        </div>
        <div class="miss-mark-panel" id="missMarkPanel">
          <div class="miss-mark-header">
            <div>
              <p class="miss-mark-title">Miss marks</p>
              <p class="miss-mark-copy" id="missMarkCopy">Each wrong answer leaves an X. Click any X to remove it.</p>
            </div>
            <button class="nav-button" id="clearMarksButton" type="button">Clear all Xs</button>
          </div>
          <div class="miss-mark-list" id="missMarkList"></div>
        </div>
        <div class="quiz-actions">
          <button class="nav-button" id="nextButton" type="button">Next question</button>
          <button class="nav-button" id="retryButton" type="button">Retry question</button>
          <button class="nav-button" id="returnButton" type="button">Back to index</button>
        </div>
        <p class="footer-note">This quiz file was generated from structured JSON and works offline once opened.</p>
      </div>
    </section>
  </div>

  <script id="quiz-data" type="application/json">${serializedQuiz}</script>
  <script>
    const payload = JSON.parse(document.getElementById("quiz-data").textContent || '{"questions":[]}');
    const questionList = document.getElementById("questionList");
    const indexView = document.getElementById("indexView");
    const missedView = document.getElementById("missedView");
    const resultsView = document.getElementById("resultsView");
    const quizView = document.getElementById("quizView");
    const toolbarCopy = document.getElementById("toolbarCopy");
    const progressLabel = document.getElementById("progressLabel");
    const sourceLabel = document.getElementById("sourceLabel");
    const questionText = document.getElementById("questionText");
    const options = document.getElementById("options");
    const feedback = document.getElementById("feedback");
    const verdict = document.getElementById("verdict");
    const reviewPanel = document.getElementById("reviewPanel");
    const reviewToggle = document.getElementById("reviewToggle");
    const reviewYourPick = document.getElementById("reviewYourPick");
    const reviewYourPickHeading = document.getElementById("reviewYourPickHeading");
    const reviewYourPickText = document.getElementById("reviewYourPickText");
    const reviewCoreIdea = document.getElementById("reviewCoreIdea");
    const reviewCoreIdeaSection = document.getElementById("reviewCoreIdeaSection");
    const reviewWhyCorrect = document.getElementById("reviewWhyCorrect");
    const reviewWhyCorrectHeading = document.getElementById("reviewWhyCorrectHeading");
    const reviewWhyCorrectSection = document.getElementById("reviewWhyCorrectSection");
    const reviewOptions = document.getElementById("reviewOptions");
    const reviewOptionsSection = document.getElementById("reviewOptionsSection");
    const reviewFacts = document.getElementById("reviewFacts");
    const reviewFactsSection = document.getElementById("reviewFactsSection");
    const reviewMemoryHook = document.getElementById("reviewMemoryHook");
    const reviewTrap = document.getElementById("reviewTrap");
    const reviewTrapSection = document.getElementById("reviewTrapSection");
    const reviewQuote = document.getElementById("reviewQuote");
    const reviewQuoteSection = document.getElementById("reviewQuoteSection");
    const ackRow = document.getElementById("ackRow");
    const ackButton = document.getElementById("ackButton");
    const resultScore = document.getElementById("resultScore");
    const resultCorrect = document.getElementById("resultCorrect");
    const resultMissed = document.getElementById("resultMissed");
    const resultMastered = document.getElementById("resultMastered");
    const resultSummary = document.getElementById("resultSummary");
    const resultBreakdown = document.getElementById("resultBreakdown");
    const resultDrillButton = document.getElementById("resultDrillButton");
    const resultIndexButton = document.getElementById("resultIndexButton");
    const explanationText = document.getElementById("explanationText");
    const sourceText = document.getElementById("sourceText");
    const missMarkPanel = document.getElementById("missMarkPanel");
    const missMarkCopy = document.getElementById("missMarkCopy");
    const missMarkList = document.getElementById("missMarkList");
    const clearMarksButton = document.getElementById("clearMarksButton");
    const nextButton = document.getElementById("nextButton");
    const retryButton = document.getElementById("retryButton");
    const returnButton = document.getElementById("returnButton");
    const indexButton = document.getElementById("indexButton");
    const missedButton = document.getElementById("missedButton");
    const restartButton = document.getElementById("restartButton");
    const missedQuestionList = document.getElementById("missedQuestionList");
    const missedEmpty = document.getElementById("missedEmpty");
    const missedTotalStat = document.getElementById("missedTotalStat");
    const missedPendingStat = document.getElementById("missedPendingStat");
    const missedCorrectedStat = document.getElementById("missedCorrectedStat");
    const correctSoundSelect = document.getElementById("correctSoundSelect");
    const previewSoundButton = document.getElementById("previewSoundButton");

    let currentIndex = 0;
    const answers = new Map();
    const missMarks = new Map();
    const retryQueue = new Set();
    /*
     * Leitner-style mastery. A question enters the drill queue on any wrong
     * answer and only leaves after two consecutive corrects, so "I got it right
     * on the second guess" is not treated as learned.
     */
    const boxes = new Map();
    const acknowledged = new Set();
    let reviewCollapsed = false;

    function getBox(index) {
      const box = boxes.get(index);
      return typeof box === "number" ? box : 0;
    }

    function recordBox(index, isCorrect) {
      boxes.set(index, isCorrect ? Math.min(getBox(index) + 1, 2) : 0);
    }

    function isMastered(index) {
      const answer = answers.get(index);
      if (!answer) {
        return false;
      }
      if (getMissMarkCount(index) === 0) {
        return Boolean(answer.correct);
      }
      return getBox(index) >= 2;
    }

    function drillIndexes() {
      const pending = [];
      for (let index = 0; index < payload.questions.length; index += 1) {
        if (answers.has(index) && !isMastered(index)) {
          pending.push(index);
        }
      }
      return pending;
    }
    let navigationMode = "all";
    let audioCtx;
    let master;
    const QUIZ_STATE_STORAGE_KEY = "${quizStateStorageKey}";
    const SOUND_STORAGE_KEY = "quiz-export-correct-sound";

    function loadSavedSound() {
      try {
        return window.localStorage.getItem(SOUND_STORAGE_KEY);
      } catch (error) {
        return null;
      }
    }

    function saveSoundSelection(value) {
      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, value);
      } catch (error) {
        return;
      }
    }

    function saveQuizState() {
      try {
        window.localStorage.setItem(
          QUIZ_STATE_STORAGE_KEY,
          JSON.stringify({
            answers: Array.from(answers.entries()),
            missMarks: Array.from(missMarks.entries()),
            boxes: Array.from(boxes.entries()),
            acknowledged: Array.from(acknowledged)
          })
        );
      } catch (error) {
        return;
      }
    }

    function loadQuizState() {
      try {
        const raw = window.localStorage.getItem(QUIZ_STATE_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw);
        answers.clear();
        missMarks.clear();
        boxes.clear();
        acknowledged.clear();

        if (parsed && Array.isArray(parsed.answers)) {
          parsed.answers.forEach((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2) {
              return;
            }

            const index = Number(entry[0]);
            const value = entry[1];

            if (!Number.isInteger(index) || index < 0 || index >= payload.questions.length) {
              return;
            }

            if (!value || typeof value !== "object") {
              return;
            }

            const selected = typeof value.selected === "string" ? value.selected : "";
            const correct = Boolean(value.correct);
            const attempts = Number.isFinite(value.attempts)
              ? Math.max(1, Math.round(value.attempts))
              : 1;

            if (!payload.questions[index].options.includes(selected)) {
              return;
            }

            answers.set(index, {
              selected,
              correct,
              attempts
            });
          });
        }

        if (parsed && Array.isArray(parsed.missMarks)) {
          parsed.missMarks.forEach((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2) {
              return;
            }

            const index = Number(entry[0]);
            const count = Number(entry[1]);

            if (!Number.isInteger(index) || index < 0 || index >= payload.questions.length) {
              return;
            }

            const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
            if (normalizedCount > 0) {
              missMarks.set(index, normalizedCount);
            }
          });
        }

        if (parsed && Array.isArray(parsed.boxes)) {
          parsed.boxes.forEach((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2) {
              return;
            }
            const index = Number(entry[0]);
            const box = Number(entry[1]);
            if (!Number.isInteger(index) || index < 0 || index >= payload.questions.length) {
              return;
            }
            if (Number.isFinite(box)) {
              boxes.set(index, Math.max(0, Math.min(2, Math.round(box))));
            }
          });
        }

        if (parsed && Array.isArray(parsed.acknowledged)) {
          parsed.acknowledged.forEach((value) => {
            const index = Number(value);
            if (Number.isInteger(index) && index >= 0 && index < payload.questions.length) {
              acknowledged.add(index);
            }
          });
        }
      } catch (error) {
        return;
      }
    }

    if (correctSoundSelect) {
      correctSoundSelect.value = loadSavedSound() || "zeldaSecret";
    }

    function getMissMarkCount(index) {
      return missMarks.get(index) || 0;
    }

    function incrementMissMark(index) {
      missMarks.set(index, getMissMarkCount(index) + 1);
    }

    function removeMissMark(index) {
      const nextCount = getMissMarkCount(index) - 1;

      if (nextCount > 0) {
        missMarks.set(index, nextCount);
        return;
      }

      missMarks.delete(index);
    }

    function clearMissMarks(index) {
      missMarks.delete(index);
    }

    function missMarkPreview(count) {
      const visibleCount = Math.min(count, 6);
      const visibleMarks = Array.from({ length: visibleCount }, () => "X").join(" ");
      return count > 6 ? visibleMarks + " +" + (count - 6) : visibleMarks;
    }

    function getAudio() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        master = audioCtx.createGain();
        master.gain.value = 0.75;

        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 20;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;

        master.connect(compressor);
        compressor.connect(audioCtx.destination);
      }

      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      return audioCtx;
    }

    function tone(freq, start, duration, config) {
      const ctx = getAudio();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const options = config || {};
      const type = options.type || "sine";
      const volume = options.volume === undefined ? 0.18 : options.volume;
      const attack = options.attack === undefined ? 0.008 : options.attack;
      const endFreq = options.endFreq;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);

      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + start + duration);
      }

      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(volume, now + start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gain);
      gain.connect(master);

      osc.start(now + start);
      osc.stop(now + start + duration + 0.02);
    }

    function bell(freq, start, duration, volume) {
      const baseVolume = volume === undefined ? 0.13 : volume;

      tone(freq, start, duration, {
        type: "sine",
        volume: baseVolume
      });

      tone(freq * 2.01, start, duration * 0.65, {
        type: "sine",
        volume: baseVolume * 0.35
      });

      tone(freq * 3.02, start + 0.005, duration * 0.45, {
        type: "sine",
        volume: baseVolume * 0.18
      });
    }

    function noiseBurst(start, duration, volume, filterFreq) {
      const ctx = getAudio();
      const now = ctx.currentTime;
      const peakVolume = volume === undefined ? 0.08 : volume;
      const cutoff = filterFreq === undefined ? 3000 : filterFreq;
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let index = 0; index < bufferSize; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = cutoff;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(peakVolume, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(master);

      noise.start(now + start);
      noise.stop(now + start + duration);
    }

    function marioCoin() {
      getAudio();

      tone(987.77, 0.0, 0.07, {
        type: "square",
        volume: 0.13
      });

      tone(1318.51, 0.06, 0.13, {
        type: "square",
        volume: 0.15
      });

      tone(2637.02, 0.13, 0.07, {
        type: "sine",
        volume: 0.045
      });
    }

    function sonicRing() {
      getAudio();

      bell(1567.98, 0.0, 0.2, 0.11);
      bell(2093.0, 0.025, 0.18, 0.075);

      tone(1200, 0.0, 0.16, {
        type: "triangle",
        volume: 0.08,
        endFreq: 2100
      });

      noiseBurst(0.035, 0.06, 0.035, 4500);
    }

    function zeldaSecret() {
      getAudio();

      bell(523.25, 0.0, 0.22, 0.09);
      bell(659.25, 0.13, 0.22, 0.09);
      bell(783.99, 0.26, 0.24, 0.095);
      bell(1046.5, 0.42, 0.38, 0.12);

      tone(1318.51, 0.58, 0.22, {
        type: "sine",
        volume: 0.055
      });

      tone(1567.98, 0.66, 0.24, {
        type: "sine",
        volume: 0.045
      });

      noiseBurst(0.5, 0.2, 0.025, 5000);
    }

    function oofSound() {
      const ctx = getAudio();
      const now = ctx.currentTime;

      tone(95, 0.0, 0.24, {
        type: "sine",
        volume: 0.24,
        endFreq: 48
      });

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(125, now);
      osc.frequency.exponentialRampToValueAtTime(72, now + 0.32);

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

      const formant1 = ctx.createBiquadFilter();
      formant1.type = "bandpass";
      formant1.frequency.value = 430;
      formant1.Q.value = 5;

      const formant2 = ctx.createBiquadFilter();
      formant2.type = "bandpass";
      formant2.frequency.value = 900;
      formant2.Q.value = 4;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1400;

      const g1 = ctx.createGain();
      g1.gain.value = 0.9;

      const g2 = ctx.createGain();
      g2.gain.value = 0.35;

      osc.connect(amp);
      amp.connect(formant1);
      amp.connect(formant2);
      amp.connect(lowpass);
      formant1.connect(g1);
      formant2.connect(g2);
      g1.connect(master);
      g2.connect(master);
      lowpass.connect(master);

      osc.start(now);
      osc.stop(now + 0.36);

      noiseBurst(0.22, 0.12, 0.025, 1000);
    }

    const correctSounds = {
      marioCoin,
      sonicRing,
      zeldaSecret,
      oofSound
    };

    function playSelectedCorrectSound() {
      const soundKey = correctSoundSelect ? correctSoundSelect.value : "marioCoin";
      const selectedSound = correctSounds[soundKey] || marioCoin;
      selectedSound();
    }

    function showView(view) {
      indexView.classList.toggle("active", view === "index");
      missedView.classList.toggle("active", view === "missed");
      resultsView.classList.toggle("active", view === "results");
      quizView.classList.toggle("active", view === "quiz");
      toolbarCopy.textContent =
        view === "index"
          ? "Question index view"
          : view === "missed"
            ? "Missed questions review"
            : view === "results"
              ? "Session results"
              : navigationMode === "missed"
                ? "Missed-question quiz mode"
                : "Quiz mode";
    }

    function enterRetryMode(index) {
      retryQueue.add(index);
    }

    function exitRetryMode(index) {
      retryQueue.delete(index);
    }

    function isRetryMode(index) {
      return retryQueue.has(index);
    }

    function answerState(index) {
      const response = answers.get(index);
      if (!response) return "";
      return response.correct ? "correct" : "incorrect";
    }

    /*
     * A question is "missed" if it carries X marks or its latest answer was
     * wrong. Deriving this from missMarks alone meant clearing the Xs quietly
     * dropped a still-wrong question out of review.
     */
    function missedQuestionIndexes() {
      const indexes = new Set();

      missMarks.forEach((count, index) => {
        if (count > 0) {
          indexes.add(index);
        }
      });

      answers.forEach((answer, index) => {
        if (!answer.correct) {
          indexes.add(index);
        }
      });

      return Array.from(indexes).sort((left, right) => left - right);
    }

    function missedQuestionStatus(index) {
      const response = answers.get(index);
      if (!response) {
        return "Queued for retry";
      }
      if (!response.correct) {
        return "Still incorrect";
      }
      return isMastered(index)
        ? "Learned (correct twice in a row)"
        : "Correct once — needs one more to leave the drill queue";
    }

    function questionStatusText(index) {
      const markCount = getMissMarkCount(index);

      if (markCount > 0) {
        return "Miss marks: " + missMarkPreview(markCount) + " • " + missedQuestionStatus(index);
      }

      return answerState(index) === "correct"
        ? "Answered correctly"
        : answerState(index) === "incorrect"
          ? "Answered incorrectly"
          : "Not answered yet";
    }

    function updateMissedControls() {
      const totalMissed = missedQuestionIndexes().length;
      const stillLearning = drillIndexes().length;
      const learned = missedQuestionIndexes().filter((index) => isMastered(index)).length;

      missedButton.textContent = "Missed questions (" + totalMissed + ")";
      missedButton.disabled = totalMissed === 0;
      missedTotalStat.textContent = totalMissed + " missed question" + (totalMissed === 1 ? "" : "s") + " recorded";
      missedPendingStat.textContent = stillLearning + " still in the drill queue";
      missedCorrectedStat.textContent = learned + " learned (correct twice in a row)";
    }

    function renderIndex() {
      questionList.innerHTML = "";

      payload.questions.forEach((question, index) => {
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const status = document.createElement("em");
        const meta = document.createElement("span");

        button.type = "button";
        button.className = "question-row " + answerState(index);
        status.textContent = questionStatusText(index);
        title.textContent = (index + 1) + ". " + question.question;
        meta.textContent = question.source.file + " | page " + question.source.page + " | " + question.source.chunkId;

        button.appendChild(status);
        button.appendChild(title);
        button.appendChild(meta);
        button.addEventListener("click", () => {
          navigationMode = "all";
          exitRetryMode(index);
          currentIndex = index;
          renderQuestion();
          showView("quiz");
        });
        questionList.appendChild(button);
      });
    }

    function renderMissedQuestions() {
      const missedIndexes = missedQuestionIndexes();
      missedQuestionList.innerHTML = "";
      missedEmpty.style.display = missedIndexes.length === 0 ? "block" : "none";

      missedIndexes.forEach((index) => {
        const question = payload.questions[index];
        const button = document.createElement("button");
        const status = document.createElement("em");
        const title = document.createElement("strong");
        const meta = document.createElement("span");

        button.type = "button";
        button.className = "question-row " + answerState(index);
        status.textContent = questionStatusText(index);
        title.textContent = (index + 1) + ". " + question.question;
        meta.textContent = question.source.file + " | page " + question.source.page + " | " + question.source.chunkId;

        button.appendChild(status);
        button.appendChild(title);
        button.appendChild(meta);
        button.addEventListener("click", () => {
          navigationMode = "missed";
          enterRetryMode(index);
          currentIndex = index;
          renderQuestion();
          showView("quiz");
        });
        missedQuestionList.appendChild(button);
      });
    }

    function renderMissMarks() {
      const markCount = getMissMarkCount(currentIndex);
      missMarkList.innerHTML = "";

      if (markCount <= 0) {
        missMarkPanel.classList.remove("active");
        return;
      }

      missMarkPanel.classList.add("active");
      missMarkCopy.textContent =
        "This question has " +
        markCount +
        " X mark" +
        (markCount === 1 ? "" : "s") +
        ". Click any X to remove it.";

      for (let index = 0; index < markCount; index += 1) {
        const markButton = document.createElement("button");
        markButton.type = "button";
        markButton.className = "miss-mark-chip";
        markButton.textContent = "X";
        markButton.title = "Remove this X";
        markButton.addEventListener("click", () => {
          removeMissMark(currentIndex);
          saveQuizState();
          updateMissedControls();
          renderIndex();
          renderMissedQuestions();
          renderQuestion();
        });
        missMarkList.appendChild(markButton);
      }
    }

    function setSectionText(section, node, value) {
      const text = typeof value === "string" ? value.trim() : "";
      node.textContent = text;
      section.hidden = text.length === 0;
      return text.length > 0;
    }

    function renderReview(question, answer) {
      const review = question.review;
      const hasReview = Boolean(review) && Array.isArray(review.optionRationales);
      const selectedIndex = answer ? question.options.indexOf(answer.selected) : -1;
      const isWrong = Boolean(answer) && !answer.correct;

      reviewToggle.hidden = !answer;
      reviewPanel.hidden = !answer || reviewCollapsed;
      reviewToggle.textContent = reviewCollapsed ? "Show deep review" : "Hide deep review";

      if (!answer) {
        return;
      }

      // Highest-value line first: the learner's own mistake, named.
      const yourPickText =
        hasReview && selectedIndex >= 0 ? review.optionRationales[selectedIndex] : "";
      if (isWrong && yourPickText) {
        reviewYourPickHeading.textContent = 'Why "' + answer.selected + '" is wrong';
        reviewYourPickText.textContent = yourPickText;
        reviewYourPick.hidden = false;
      } else if (isWrong) {
        reviewYourPickHeading.textContent = 'Why "' + answer.selected + '" is wrong';
        reviewYourPickText.textContent =
          'The correct answer is "' + question.correctAnswer + '". ' + question.explanation;
        reviewYourPick.hidden = false;
      } else {
        reviewYourPick.hidden = true;
      }

      if (!hasReview) {
        reviewCoreIdeaSection.hidden = true;
        reviewWhyCorrectSection.hidden = true;
        reviewOptionsSection.hidden = true;
        reviewFactsSection.hidden = true;
        reviewTrapSection.hidden = true;
        reviewQuoteSection.hidden = true;
        return;
      }

      setSectionText(reviewCoreIdeaSection, reviewCoreIdea, review.coreIdea);

      reviewWhyCorrectHeading.textContent = 'Why "' + question.correctAnswer + '" is right';
      setSectionText(reviewWhyCorrectSection, reviewWhyCorrect, review.whyCorrect);

      reviewOptions.innerHTML = "";
      let renderedOptions = 0;
      question.options.forEach((option, index) => {
        const rationale = review.optionRationales[index];
        if (!rationale || (isWrong && index === selectedIndex)) {
          return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "review-option";

        const label = document.createElement("strong");
        label.textContent =
          option +
          (option === question.correctAnswer ? " — correct" : "") +
          (!isWrong && index === selectedIndex ? " — your answer" : "");

        const body = document.createElement("p");
        body.style.margin = "0";
        body.textContent = rationale;

        wrapper.appendChild(label);
        wrapper.appendChild(body);
        reviewOptions.appendChild(wrapper);
        renderedOptions += 1;
      });
      reviewOptionsSection.hidden = renderedOptions === 0;

      reviewFacts.innerHTML = "";
      const facts = Array.isArray(review.keyFacts) ? review.keyFacts : [];
      facts.forEach((fact) => {
        if (!fact) {
          return;
        }
        const item = document.createElement("li");
        item.textContent = fact;
        reviewFacts.appendChild(item);
      });
      reviewMemoryHook.textContent = review.memoryHook || "";
      reviewFactsSection.hidden = facts.length === 0 && !review.memoryHook;

      setSectionText(reviewTrapSection, reviewTrap, review.commonConfusion);
      setSectionText(reviewQuoteSection, reviewQuote, review.sourceQuote);
    }

    function renderResults() {
      const total = payload.questions.length;
      const answered = [];
      for (let index = 0; index < total; index += 1) {
        if (answers.has(index)) {
          answered.push(index);
        }
      }

      const firstTryCorrect = answered.filter(
        (index) => answers.get(index).correct && getMissMarkCount(index) === 0
      ).length;
      const missed = answered.filter((index) => getMissMarkCount(index) > 0).length;
      const mastered = answered.filter((index) => isMastered(index)).length;
      const accuracy = answered.length === 0 ? 0 : Math.round((firstTryCorrect / answered.length) * 100);

      resultScore.textContent = accuracy + "%";
      resultCorrect.textContent = String(firstTryCorrect);
      resultMissed.textContent = String(missed);
      resultMastered.textContent = String(mastered);

      const remaining = drillIndexes().length;
      resultSummary.textContent =
        "Answered " +
        answered.length +
        " of " +
        total +
        " questions. " +
        (remaining === 0
          ? "Nothing left in the drill queue — every question you missed has been answered correctly twice in a row."
          : remaining +
            " question" +
            (remaining === 1 ? "" : "s") +
            " still need" +
            (remaining === 1 ? "s" : "") +
            " two correct answers in a row before counting as learned.");

      const byFile = new Map();
      for (let index = 0; index < total; index += 1) {
        const file = payload.questions[index].source.file || "Unknown source";
        const bucket = byFile.get(file) || { correct: 0, answered: 0, total: 0 };
        bucket.total += 1;
        if (answers.has(index)) {
          bucket.answered += 1;
          if (answers.get(index).correct && getMissMarkCount(index) === 0) {
            bucket.correct += 1;
          }
        }
        byFile.set(file, bucket);
      }

      resultBreakdown.innerHTML = "";
      byFile.forEach((bucket, file) => {
        const row = document.createElement("div");
        row.className = "question-row";
        const heading = document.createElement("em");
        heading.textContent = file;
        const body = document.createElement("span");
        body.textContent =
          bucket.correct +
          " first-try correct of " +
          bucket.answered +
          " answered (" +
          bucket.total +
          " total)";
        row.appendChild(heading);
        row.appendChild(body);
        resultBreakdown.appendChild(row);
      });

      resultDrillButton.disabled = remaining === 0;
      resultDrillButton.textContent =
        remaining === 0 ? "Nothing left to drill" : "Drill the " + remaining + " you missed";
    }

    function renderQuestion() {
      const question = payload.questions[currentIndex];
      const storedAnswer = answers.get(currentIndex);
      const missedIndexes = missedQuestionIndexes();
      const missedPosition = missedIndexes.indexOf(currentIndex);
      const isMissedReview = navigationMode === "missed" && missedPosition >= 0;
      const answer = isRetryMode(currentIndex) ? null : storedAnswer;

      progressLabel.textContent = isMissedReview
        ? "Missed question " + (missedPosition + 1) + " of " + missedIndexes.length
        : "Question " + (currentIndex + 1) + " of " + payload.questions.length;
      sourceLabel.textContent =
        question.source.file +
        (getMissMarkCount(currentIndex) > 0
          ? storedAnswer && storedAnswer.correct
            ? " | corrected review"
            : " | missed question"
          : "");
      questionText.textContent = question.question;
      sourceText.textContent = question.source.file + " | page " + question.source.page + " | " + question.source.chunkId;
      explanationText.textContent = question.explanation;
      options.innerHTML = "";

      question.options.forEach((option) => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "option-button";
        optionButton.textContent = option;

        if (answer) {
          optionButton.disabled = true;
          optionButton.classList.add("is-selected");

          const mark = document.createElement("span");
          mark.className = "option-mark";

          if (option === question.correctAnswer) {
            optionButton.classList.add("correct");
            mark.textContent = "\u2713 ";
            optionButton.textContent = "";
            optionButton.appendChild(mark);
            optionButton.appendChild(document.createTextNode(option));
          } else if (option === answer.selected) {
            optionButton.classList.add("incorrect");
            mark.textContent = "\u2717 ";
            optionButton.textContent = "";
            optionButton.appendChild(mark);
            optionButton.appendChild(document.createTextNode(option));
          }
        } else {
          optionButton.addEventListener("click", () => {
            const isCorrect = option === question.correctAnswer;
            const previousAnswer = answers.get(currentIndex);
            exitRetryMode(currentIndex);
            answers.set(currentIndex, {
              selected: option,
              correct: isCorrect,
              attempts: previousAnswer && typeof previousAnswer.attempts === "number" ? previousAnswer.attempts + 1 : 1
            });
            recordBox(currentIndex, isCorrect);
            if (!isCorrect) {
              incrementMissMark(currentIndex);
              acknowledged.delete(currentIndex);
            }
            if (isCorrect) {
              playSelectedCorrectSound();
            }
            reviewCollapsed = isCorrect;
            saveQuizState();
            updateMissedControls();
            renderIndex();
            renderMissedQuestions();
            renderQuestion();
          });
        }

        options.appendChild(optionButton);
      });

      feedback.classList.toggle("active", Boolean(answer));

      if (answer) {
        verdict.textContent = answer.correct
          ? "Correct"
          : 'Not quite \u2014 you chose "' + answer.selected + '"';
        verdict.classList.toggle("is-correct", answer.correct);
        verdict.classList.toggle("is-incorrect", !answer.correct);
      } else {
        verdict.textContent = "";
        verdict.classList.remove("is-correct", "is-incorrect");
      }

      renderReview(question, answer);

      // A wrong answer has to be acknowledged before moving on. It is a small
      // forced beat, and it is what stops the reflexive click through to the
      // next question without reading why the answer was wrong.
      const needsAck = Boolean(answer) && !answer.correct && !acknowledged.has(currentIndex);
      ackRow.hidden = !needsAck;

      renderMissMarks();
      nextButton.textContent = isMissedReview
        ? missedPosition < missedIndexes.length - 1
          ? "Next missed question"
          : "Return to missed questions"
        : currentIndex < payload.questions.length - 1
          ? "Next question"
          : "See results";
      nextButton.disabled = !answer || needsAck;
      retryButton.style.display = answer && !answer.correct ? "inline-block" : "none";
      returnButton.textContent = isMissedReview ? "Back to missed questions" : "Back to index";
    }

    ackButton.addEventListener("click", () => {
      acknowledged.add(currentIndex);
      saveQuizState();
      renderQuestion();
    });

    reviewToggle.addEventListener("click", () => {
      reviewCollapsed = !reviewCollapsed;
      renderQuestion();
    });

    resultIndexButton.addEventListener("click", () => {
      navigationMode = "all";
      showView("index");
    });

    resultDrillButton.addEventListener("click", () => {
      const pending = drillIndexes();
      if (pending.length === 0) {
        return;
      }
      navigationMode = "missed";
      currentIndex = pending[0];
      enterRetryMode(currentIndex);
      renderQuestion();
      showView("quiz");
    });

    nextButton.addEventListener("click", () => {
      if (navigationMode === "missed") {
        const missedIndexes = missedQuestionIndexes();
        const currentMissedPosition = missedIndexes.indexOf(currentIndex);
        if (currentMissedPosition >= 0 && currentMissedPosition < missedIndexes.length - 1) {
          currentIndex = missedIndexes[currentMissedPosition + 1];
          enterRetryMode(currentIndex);
          renderQuestion();
          return;
        }
        showView("missed");
        return;
      }

      if (currentIndex < payload.questions.length - 1) {
        currentIndex += 1;
        renderQuestion();
        return;
      }

      renderResults();
      showView("results");
    });

    retryButton.addEventListener("click", () => {
      enterRetryMode(currentIndex);
      renderQuestion();
    });

    clearMarksButton.addEventListener("click", () => {
      clearMissMarks(currentIndex);
      saveQuizState();
      updateMissedControls();
      renderIndex();
      renderMissedQuestions();
      renderQuestion();
    });

    returnButton.addEventListener("click", () => {
      showView(navigationMode === "missed" ? "missed" : "index");
    });

    indexButton.addEventListener("click", () => {
      navigationMode = "all";
      showView("index");
    });

    missedButton.addEventListener("click", () => {
      navigationMode = "missed";
      renderMissedQuestions();
      showView("missed");
    });

    restartButton.addEventListener("click", () => {
      answers.clear();
      missMarks.clear();
      retryQueue.clear();
      boxes.clear();
      acknowledged.clear();
      reviewCollapsed = false;
      navigationMode = "all";
      saveQuizState();
      updateMissedControls();
      renderIndex();
      renderMissedQuestions();
      currentIndex = 0;
      renderQuestion();
      showView("quiz");
    });

    if (correctSoundSelect) {
      correctSoundSelect.addEventListener("change", () => {
        saveSoundSelection(correctSoundSelect.value);
      });
    }

    if (previewSoundButton) {
      previewSoundButton.addEventListener("click", () => {
        playSelectedCorrectSound();
      });
    }

    loadQuizState();
    updateMissedControls();
    renderIndex();
    renderMissedQuestions();
  </script>
</body>
</html>`;
}
