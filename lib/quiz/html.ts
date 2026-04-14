import type { QuizPayload } from "@/lib/types";

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

export function quizToHtml(payload: QuizPayload, title = "Interactive Quiz"): string {
  const questionCount = payload.questions.length;
  const escapedTitle = escapeHtml(title);
  const serializedQuiz = safeJson(payload);

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
      justify-content: space-between;
      padding: 16px 18px;
      margin-bottom: 24px;
      background: #000000;
    }

    .toolbar-copy {
      font-size: 0.92rem;
    }

    .toolbar-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
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

    .question-row.correct {
      background: #ffffff;
      color: #000000;
    }

    .question-row.incorrect {
      background: #ffffff;
      color: #000000;
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
    }

    .option-button.incorrect {
      background: #ffffff;
      color: #000000;
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
        <button class="nav-button" id="indexButton" type="button">Question index</button>
        <button class="nav-button" id="restartButton" type="button">Restart from first</button>
      </div>
    </div>

    <section class="view active" id="indexView">
      <div class="card">
        <ul class="stats">
          <li>${questionCount} total question${questionCount === 1 ? "" : "s"}</li>
          <li>4 answer choices each</li>
          <li>Browser-openable HTML</li>
        </ul>
        <div class="question-list" id="questionList"></div>
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
          <p><strong>Explanation:</strong> <span id="explanationText"></span></p>
          <p><strong>Source:</strong> <span id="sourceText"></span></p>
        </div>
        <div class="quiz-actions">
          <button class="nav-button" id="nextButton" type="button">Next question</button>
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
    const quizView = document.getElementById("quizView");
    const toolbarCopy = document.getElementById("toolbarCopy");
    const progressLabel = document.getElementById("progressLabel");
    const sourceLabel = document.getElementById("sourceLabel");
    const questionText = document.getElementById("questionText");
    const options = document.getElementById("options");
    const feedback = document.getElementById("feedback");
    const explanationText = document.getElementById("explanationText");
    const sourceText = document.getElementById("sourceText");
    const nextButton = document.getElementById("nextButton");
    const returnButton = document.getElementById("returnButton");
    const indexButton = document.getElementById("indexButton");
    const restartButton = document.getElementById("restartButton");

    let currentIndex = 0;
    const answers = new Map();

    function showView(view) {
      indexView.classList.toggle("active", view === "index");
      quizView.classList.toggle("active", view === "quiz");
      toolbarCopy.textContent = view === "index" ? "Question index view" : "Quiz mode";
    }

    function answerState(index) {
      const response = answers.get(index);
      if (!response) return "";
      return response.correct ? "correct" : "incorrect";
    }

    function renderIndex() {
      questionList.innerHTML = "";

      payload.questions.forEach((question, index) => {
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const meta = document.createElement("span");

        button.type = "button";
        button.className = "question-row " + answerState(index);
        title.textContent = (index + 1) + ". " + question.question;
        meta.textContent = question.source.file + " | page " + question.source.page + " | " + question.source.chunkId;

        button.appendChild(title);
        button.appendChild(meta);
        button.addEventListener("click", () => {
          currentIndex = index;
          renderQuestion();
          showView("quiz");
        });
        questionList.appendChild(button);
      });
    }

    function renderQuestion() {
      const question = payload.questions[currentIndex];
      const answer = answers.get(currentIndex);

      progressLabel.textContent = "Question " + (currentIndex + 1) + " of " + payload.questions.length;
      sourceLabel.textContent = question.source.file;
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
          if (option === question.correctAnswer) {
            optionButton.classList.add("correct");
          } else if (option === answer.selected) {
            optionButton.classList.add("incorrect");
          }
        } else {
          optionButton.addEventListener("click", () => {
            answers.set(currentIndex, {
              selected: option,
              correct: option === question.correctAnswer
            });
            renderIndex();
            renderQuestion();
          });
        }

        options.appendChild(optionButton);
      });

      feedback.classList.toggle("active", Boolean(answer));
      nextButton.textContent = currentIndex < payload.questions.length - 1 ? "Next question" : "Return to index";
      nextButton.disabled = !answer;
    }

    nextButton.addEventListener("click", () => {
      if (currentIndex < payload.questions.length - 1) {
        currentIndex += 1;
        renderQuestion();
        return;
      }
      showView("index");
    });

    returnButton.addEventListener("click", () => {
      showView("index");
    });

    indexButton.addEventListener("click", () => {
      showView("index");
    });

    restartButton.addEventListener("click", () => {
      answers.clear();
      renderIndex();
      currentIndex = 0;
      renderQuestion();
      showView("quiz");
    });

    renderIndex();
  </script>
</body>
</html>`;
}
