"use client";

import { useState } from "react";
import type { QuizPayload, QuizQuestion } from "@/lib/types";

interface QuizEditorProps {
  quiz: QuizPayload;
  onChange: (nextQuiz: QuizPayload) => void;
  flaggedIndexes?: number[];
  flaggedOnly?: boolean;
  onFlaggedOnlyChange?: (next: boolean) => void;
}

function updateQuestion(
  quiz: QuizPayload,
  questionIndex: number,
  updater: (question: QuizQuestion) => QuizQuestion
): QuizPayload {
  return {
    questions: quiz.questions.map((question, index) =>
      index === questionIndex ? updater(question) : question
    )
  };
}

export function QuizEditor({
  quiz,
  onChange,
  flaggedIndexes = [],
  flaggedOnly = false,
  onFlaggedOnlyChange
}: QuizEditorProps) {
  const [collapsed, setCollapsed] = useState(true);
  const flagged = new Set(flaggedIndexes);
  const showFlaggedOnly = flaggedOnly && flagged.size > 0;
  const visibleQuestions = quiz.questions
    .map((question, questionIndex) => ({ question, questionIndex }))
    .filter(({ questionIndex }) => !showFlaggedOnly || flagged.has(questionIndex));

  // The editor is collapsed by default, but a request to review flagged
  // questions should open it rather than silently do nothing.
  const isCollapsed = collapsed && !showFlaggedOnly;

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Quiz Review And Edit</h2>
          <p className="muted">
            {isCollapsed
              ? `Collapsed by default. Expand only if you want to manually edit the merged ${quiz.questions.length}-question bank.`
              : "Review every field before exporting. You can edit wording, options, explanation, and source mapping."}
          </p>
        </div>
        <div className="actions-row">
          {flagged.size > 0 && onFlaggedOnlyChange ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onFlaggedOnlyChange(!flaggedOnly);
                if (!flaggedOnly) {
                  setCollapsed(false);
                }
              }}
            >
              {showFlaggedOnly ? `Show All ${quiz.questions.length}` : `Show ${flagged.size} Flagged`}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => setCollapsed((previous) => !previous)}>
            {isCollapsed ? "Expand Review" : "Collapse Review"}
          </button>
        </div>
      </div>

      {isCollapsed ? null : (
        <div className="quiz-cards">
          {visibleQuestions.map(({ question, questionIndex }) => (
            <article
              key={`q-${questionIndex}`}
              className={`quiz-card${flagged.has(questionIndex) ? " is-flagged" : ""}`}
            >
              <h3>
                Question {questionIndex + 1}
                {flagged.has(questionIndex) ? " (flagged)" : ""}
              </h3>

              {!question.options.includes(question.correctAnswer) ? (
                <div className="error-box">
                  The correct answer no longer matches any option, so this question can never be answered
                  correctly. Pick the right option below.
                </div>
              ) : null}
              <label className="field">
                <span>Question</span>
                <textarea
                  value={question.question}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        question: event.target.value
                      }))
                    )
                  }
                  rows={3}
                />
              </label>

              <div className="option-grid">
                {question.options.map((option, optionIndex) => (
                  <label key={`q-${questionIndex}-opt-${optionIndex}`} className="field">
                    <span>Option {String.fromCharCode(65 + optionIndex)}</span>
                    <input
                      type="text"
                      value={option}
                      onChange={(event) =>
                        onChange(
                          updateQuestion(quiz, questionIndex, (current) => {
                            const nextOptions = [...current.options];
                            const previousValue = nextOptions[optionIndex];
                            nextOptions[optionIndex] = event.target.value;

                            return {
                              ...current,
                              options: nextOptions,
                              correctAnswer:
                                current.correctAnswer === previousValue
                                  ? event.target.value
                                  : current.correctAnswer
                            };
                          })
                        )
                      }
                    />
                  </label>
                ))}
              </div>

              <label className="field">
                <span>Correct Answer</span>
                <select
                  value={question.correctAnswer}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        correctAnswer: event.target.value
                      }))
                    )
                  }
                >
                  {question.options.map((option, optionIndex) => (
                    <option key={`q-${questionIndex}-correct-${optionIndex}`} value={option}>
                      {String.fromCharCode(65 + optionIndex)}. {option || "(empty)"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Explanation</span>
                <textarea
                  value={question.explanation}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        explanation: event.target.value
                      }))
                    )
                  }
                  rows={3}
                />
              </label>

              <div className="source-grid">
                <label className="field">
                  <span>Source File</span>
                  <input
                    type="text"
                    value={question.source.file}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            file: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Page</span>
                  <input
                    type="text"
                    value={question.source.page}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            page: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Chunk ID</span>
                  <input
                    type="text"
                    value={question.source.chunkId}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            chunkId: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
