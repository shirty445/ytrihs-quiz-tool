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

    .sound-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .sound-label {
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
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

      .sound-controls {
        width: 100%;
      }

      .sound-select {
        min-width: 0;
        flex: 1 1 220px;
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
    const correctSoundSelect = document.getElementById("correctSoundSelect");
    const previewSoundButton = document.getElementById("previewSoundButton");

    let currentIndex = 0;
    const answers = new Map();
    let audioCtx;
    let master;
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

    if (correctSoundSelect) {
      correctSoundSelect.value = loadSavedSound() || "zeldaSecret";
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
            const isCorrect = option === question.correctAnswer;
            answers.set(currentIndex, {
              selected: option,
              correct: isCorrect
            });
            if (isCorrect) {
              playSelectedCorrectSound();
            }
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

    renderIndex();
  </script>
</body>
</html>`;
}
